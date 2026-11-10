// =============================================================================
// TRIADE — `calendly-webhook`: os agendamentos do Calendly na Agenda (10/11/2026)
//
// Só da Imova: é publicada só no projeto dela. Quando alguém marca, cancela ou
// remarca pelo link do Calendly da Imova, o Calendly faz um POST aqui:
//
//   POST https://kkqadgxvmzulcamuakzk.supabase.co/functions/v1/calendly-webhook
//   Calendly-Webhook-Signature: t=<segundos>,v1=<hex>
//   { "event": "invitee.created" | "invitee.canceled", "payload": { ... } }
//
// A assinatura do webhook é criada pela API do Calendly (não há tela para isso)
// com `scripts/calendly-assinar.mjs`, que escolhe a chave, grava a chave aqui e
// assina só os dois eventos. Passo a passo em `docs/operacao/calendly.md`.
//
// A CHAVE
// -----------------------------------------------------------------------------
// Mora em CALENDLY_WEBHOOK_SIGNING_KEY (Secrets das Edge Functions) ou no Vault
// como `calendly_webhook_signing_key` — nunca em arquivo versionado. Na troca,
// a velha fica em CALENDLY_WEBHOOK_SIGNING_KEY_ANTERIOR até a assinatura nova
// estar no ar. Como confere: `assinatura.ts`.
//
// AS RESPOSTAS
// -----------------------------------------------------------------------------
//   200  recebido, repetido ou ignorado (evento que não é agendamento)
//   401  assinatura ausente, errada ou velha, com a mesma frase para todo motivo
//   400  corpo que não é JSON, ou agendamento sem URI ou sem horário
//   405  método que não é POST          413  corpo acima de 256 KB
//   500  o banco falhou: o Calendly tenta de novo, e a idempotência (a URI do
//        convidado) impede que o reenvio duplique
//   503  a chave não está configurada: recusa fechada, nunca aceita sem conferir
//
// A ORDEM É A SEGURANÇA, a mesma de `grupozap-lead`: corpo cru com teto →
// assinatura → JSON → Postgres. Nada do corpo é lido antes da assinatura.
//
// O QUE NÃO ACONTECE AQUI: achar a ficha, escolher a agenda, ver conflito,
// avisar a pessoa. É tudo de `public.calendly_receber`, numa transação. No log
// entram só o fim da URI do convidado, o evento, a natureza e o status — nunca
// nome, e-mail, telefone ou resposta.
// =============================================================================

import { erro, exigirMetodo, json, registrar } from '../_compartilhado/http.ts';
import { rpcServico } from '../_compartilhado/postgrest.ts';
import { SegredoAusente, segredo } from '../_compartilhado/segredos.ts';
import { conferirAssinatura } from './assinatura.ts';
import { lerCorpo, resumir, resumoParaLog } from './evento.ts';

/** 256 KB. Um aviso do Calendly tem poucos KB, mesmo com muitas respostas. */
const TAMANHO_MAXIMO = 256 * 1024;

/** A frase única de recusa. Sondar a porta não pode render informação. */
const RECUSA = 'Chamada recusada: assinatura ausente ou inválida.';

const FUNCAO = 'calendly-webhook';

/** O que `public.calendly_receber` devolve. */
type Recebido = {
  ok?: boolean;
  motivo?: string;
  duplicado?: boolean;
  ignorado?: boolean;
  situacao?: string;
  ficha?: string;
  conflitos?: number;
};

// A chave anterior é opcional. `segredo()` não guarda a ausência, e sem esta
// memória cada chamada custaria uma ida ao Vault. Mesmo prazo do cache dele.
const AUSENCIA_MS = 5 * 60 * 1000;
let anteriorAusenteAte = 0;

async function chaveAnterior(): Promise<string | null> {
  if (anteriorAusenteAte > Date.now()) return null;
  try {
    return await segredo('calendly_webhook_signing_key_anterior');
  } catch (e) {
    if (!(e instanceof SegredoAusente)) throw e;
    anteriorAusenteAte = Date.now() + AUSENCIA_MS;
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  // 1. Só POST.
  const metodo = exigirMetodo(req, ['POST']);
  if (metodo) return metodo;

  // 2. O corpo cru, com teto.
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declarado) && declarado > TAMANHO_MAXIMO) {
    return erro(413, 'corpo_grande_demais', 'O aviso enviado é grande demais.');
  }
  let corpoCru: string;
  try {
    corpoCru = await req.text();
  } catch (e) {
    return erro(400, 'corpo_ilegivel', 'Não consegui ler o corpo da chamada. Reenvie o aviso.', e);
  }
  if (corpoCru.length > TAMANHO_MAXIMO) {
    return erro(413, 'corpo_grande_demais', 'O aviso enviado é grande demais.');
  }

  // 3. A chave. Sem ela, recusa fechada: aceitar sem conferir deixaria
  //    qualquer um pôr compromissos na agenda da Imova.
  let chave: string;
  let anterior: string | null;
  try {
    chave = await segredo('calendly_webhook_signing_key');
    anterior = await chaveAnterior();
  } catch (e) {
    if (e instanceof SegredoAusente) {
      return erro(
        503,
        'integracao_nao_configurada',
        'O recebimento do Calendly ainda não está configurado. Rode scripts/calendly-assinar.mjs, que grava CALENDLY_WEBHOOK_SIGNING_KEY.',
        e,
        { funcao: FUNCAO, segredo_faltando: e.nome },
      );
    }
    return erro(500, 'falha_ao_ler_segredo', 'Não consegui conferir a chamada agora.', e, {
      funcao: FUNCAO,
    });
  }

  // 4. A assinatura, antes de qualquer leitura do corpo.
  const conferencia = await conferirAssinatura({
    cabecalho: req.headers.get('calendly-webhook-signature'),
    corpoCru,
    chave,
    chaveAnterior: anterior,
  });
  if (!conferencia.ok) {
    registrar('erro', { funcao: FUNCAO, recusa: conferencia.motivo, status: 401 });
    return json({ ok: false, codigo: 'assinatura_invalida', mensagem: RECUSA }, 401);
  }
  if (conferencia.chave === 'anterior') {
    registrar('aviso', { funcao: FUNCAO, evento: 'chave_anterior_em_uso' });
  }

  // 5. Agora, e só agora, o JSON.
  const lido = lerCorpo(corpoCru);
  if (!lido.ok) {
    return erro(400, 'json_invalido', 'O corpo não é um objeto JSON válido.', lido.motivo, {
      funcao: FUNCAO,
    });
  }
  const leitura = resumir(lido.corpo);
  const resumo = resumoParaLog(leitura);
  if (leitura.tipo === 'ignorar') {
    // Outro evento do Calendly (não comparecimento, formulário de roteamento):
    // a assinatura só pede os dois, mas recusar faria o Calendly insistir.
    registrar('info', { funcao: FUNCAO, ignorado: leitura.evento, status: 200 });
    return json({ ok: true, ignorado: true });
  }
  if (leitura.tipo === 'invalido') {
    return erro(
      400,
      'aviso_incompleto',
      'O aviso não traz o convidado ou o horário.',
      leitura.motivo,
      {
        funcao: FUNCAO,
      },
    );
  }

  // 6. O Postgres grava.
  let recebido: Recebido;
  try {
    recebido = (await rpcServico<Recebido>('calendly_receber', { p_evento: leitura.resumo })) ?? {};
  } catch (e) {
    // 500 é o certo: o Calendly reenvia, e a URI do convidado impede duplicar.
    return erro(500, 'falha_ao_gravar', 'Recebi o aviso mas não consegui gravá-lo.', e, {
      funcao: FUNCAO,
      ...resumo,
    });
  }
  if (recebido.ok !== true) {
    // Os passos 4 e 5 impedem isso; se acontecer, 2xx perderia o agendamento
    // em silêncio, e o 500 faz o Calendly reenviar enquanto o log diz por quê.
    return erro(
      500,
      'aviso_nao_gravado',
      'Recebi o aviso mas não consegui gravá-lo.',
      recebido.motivo ?? 'resposta_sem_ok',
      {
        funcao: FUNCAO,
        ...resumo,
      },
    );
  }

  registrar('info', {
    funcao: FUNCAO,
    ...resumo,
    duplicado: recebido.duplicado === true,
    situacao: recebido.situacao,
    ficha: recebido.ficha,
    conflitos: recebido.conflitos,
    status: 200,
  });
  return json({ ok: true, duplicado: recebido.duplicado === true, situacao: recebido.situacao });
});
