// =============================================================================
// TRIADE — `wa-webhook` (RF-CON-03; PRD §9.4; anexo R04 §3 item 7; ADR-04)
//
// A porta de entrada da Cloud API da Meta. Recebe mensagem recebida, recibo de
// entrega e eco do Coexistence, e não faz mais nada além de enfileirar: o
// processamento é do worker, na máquina dedicada, quando ela estiver ligada
// (ADR-04 — "recepção em nuvem, processamento local").
//
// A ORDEM É A SEGURANÇA, e é a mesma de `komune-webhook`:
//   1. lê o corpo CRU, com teto (nunca reserializa: JSON.parse + stringify
//      reordena chaves e o HMAC deixa de bater sem nada estar errado)
//   2. confere a assinatura `X-Hub-Signature-256` em tempo constante
//   3. confere o carimbo que veio DENTRO do corpo assinado (a Meta não manda
//      cabeçalho de carimbo; ver `assinatura-meta.ts`)
//   4. só então lê o JSON e traduz o formato da Meta (`extrair.ts`)
//   5. entrega ao Postgres, que grava a entrega e enfileira em uma transação
//
// GET é o handshake de verificação da Meta (`hub.mode=subscribe`), e o token é
// comparado em tempo constante como qualquer outro segredo.
//
// SEM SEGREDO, RECUSA FECHADA. Aceitar sem conferir transformaria a porta em
// buraco: qualquer um poderia injetar "mensagem recebida" no CRM — e mensagem
// recebida abre a janela de 24 h, que é justamente a permissão de enviar.
//
// O QUE NÃO ACONTECE AQUI: nada é decidido. Opt-out, supressão, janela, teto,
// classificação e envio são do banco e do worker. Esta função não sabe o que é
// um opt-out, e é isso que a mantém pequena o bastante para ser conferida de
// uma olhada.
// =============================================================================

import { erro, exigirMetodo, json, registrar } from '../_compartilhado/http.ts';
import { rpcServico } from '../_compartilhado/postgrest.ts';
import { SegredoAusente, segredo } from '../_compartilhado/segredos.ts';
import { iguaisEmTempoConstante } from '../_compartilhado/assinatura.ts';
import { JANELA_PADRAO_SEGUNDOS, verificarDaMeta } from './assinatura-meta.ts';
import { extrairDaMeta } from './extrair.ts';

/**
 * 1 MB. Um lote de webhook da Meta é de alguns kilobytes; o teto existe para
 * que "ler o corpo antes de decidir" — que é obrigatório, porque a assinatura é
 * sobre ele — não vire um jeito de consumir memória sem credencial nenhuma.
 */
const TAMANHO_MAXIMO = 1024 * 1024;

const JANELA_SEGUNDOS = (() => {
  const bruto = Deno.env.get('WA_WEBHOOK_JANELA_SEGUNDOS');
  const n = bruto ? Number(bruto) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : JANELA_PADRAO_SEGUNDOS;
})();

/** A frase única de recusa. Sondar a porta não pode render informação. */
const RECUSA = 'Chamada recusada: assinatura ausente, inválida ou fora da janela de aceitação.';

Deno.serve(async (req: Request): Promise<Response> => {
  // ---------------------------------------------------------------------
  // GET — o handshake de verificação da Meta.
  // ---------------------------------------------------------------------
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const modo = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const desafio = url.searchParams.get('hub.challenge');

    let esperado: string;
    try {
      esperado = await segredo('meta_wa_verify_token');
    } catch (e) {
      return erro(
        503,
        'integracao_nao_configurada',
        'O recebimento de webhooks do WhatsApp ainda não está configurado. Grave meta_wa_verify_token no Vault antes de apontar o webhook para cá.',
        e,
      );
    }
    if (modo !== 'subscribe' || token === null || !iguaisEmTempoConstante(token, esperado)) {
      registrar('erro', { funcao: 'wa-webhook', recusa: 'handshake', modo });
      return json({ ok: false, codigo: 'handshake_invalido', mensagem: RECUSA }, 401);
    }
    registrar('info', { funcao: 'wa-webhook', evento: 'handshake_aceito' });
    return new Response(desafio ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const metodo = exigirMetodo(req, ['GET', 'POST']);
  if (metodo) return metodo;

  // ---------------------------------------------------------------------
  // 1. O corpo cru, com teto.
  // ---------------------------------------------------------------------
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declarado) && declarado > TAMANHO_MAXIMO) {
    return erro(413, 'corpo_grande_demais', 'O lote enviado é grande demais.');
  }
  let corpoCru: string;
  try {
    corpoCru = await req.text();
  } catch (e) {
    return erro(400, 'corpo_ilegivel', 'Não consegui ler o corpo da chamada. Reenvie o lote.', e);
  }
  if (corpoCru.length > TAMANHO_MAXIMO) {
    return erro(413, 'corpo_grande_demais', 'O lote enviado é grande demais.');
  }

  // ---------------------------------------------------------------------
  // 2 e 3. A assinatura e o carimbo, antes de tudo.
  // ---------------------------------------------------------------------
  let chave: string;
  try {
    chave = await segredo('meta_wa_app_secret');
  } catch (e) {
    if (e instanceof SegredoAusente) {
      return erro(
        503,
        'integracao_nao_configurada',
        'O recebimento de webhooks do WhatsApp ainda não está configurado. Grave meta_wa_app_secret no Vault antes de apontar o webhook para cá.',
        e,
        { segredo_faltando: e.nome },
      );
    }
    return erro(
      500,
      'falha_ao_ler_segredo',
      'Não consegui conferir a chamada agora. Reenvie em alguns minutos.',
      e,
    );
  }

  const assinatura = req.headers.get('x-hub-signature-256');
  const conferencia = await verificarDaMeta({
    segredo: chave,
    corpoCru,
    assinaturaRecebida: assinatura,
    janelaSegundos: JANELA_SEGUNDOS,
  });

  if (!conferencia.ok) {
    // Uma frase só para todos os motivos. O detalhe fica no log, que é nosso.
    registrar('erro', {
      funcao: 'wa-webhook',
      recusa: conferencia.codigo,
      detalhe: conferencia.detalhe,
    });
    return json(
      {
        ok: false,
        codigo:
          conferencia.codigo === 'carimbo_ausente' ? 'carimbo_ausente' : 'assinatura_invalida',
        mensagem: RECUSA,
      },
      conferencia.codigo === 'carimbo_ausente' ? 400 : 401,
    );
  }

  // ---------------------------------------------------------------------
  // 4. Agora, e só agora, o JSON.
  // ---------------------------------------------------------------------
  let corpo: unknown;
  try {
    corpo = JSON.parse(corpoCru);
  } catch (e) {
    return erro(400, 'json_invalido', 'O corpo assinado não é um JSON válido.', e);
  }

  const { itens, ignorados } = extrairDaMeta(corpo);

  // A identidade da entrega é a própria assinatura: ela é função determinística
  // do corpo e do segredo, então corpos iguais têm assinatura igual e a
  // reentrega da Meta cai na mesma linha de `webhook_deliveries`. A Meta não
  // manda um id de entrega — inventar um com `crypto.randomUUID()` faria toda
  // reentrega parecer nova, que é o oposto de idempotência.
  const entrega = conferencia.ok ? (assinatura as string).slice('sha256='.length) : '';

  // ---------------------------------------------------------------------
  // 5. O Postgres grava e enfileira em UMA transação.
  // ---------------------------------------------------------------------
  try {
    const resultado = await rpcServico<Record<string, unknown>>('wa_webhook_receber', {
      p_delivery_id: entrega,
      p_payload: corpo,
      p_itens: itens,
    });
    registrar('info', {
      funcao: 'wa-webhook',
      entrega: entrega.slice(0, 12),
      itens: itens.length,
      tipos: itens.map((i) => i.tipo),
      ignorados,
      duplicado: resultado?.duplicado === true,
      enfileirados: resultado?.enfileirados ?? 0,
    });
    return json({ ok: true, ...resultado });
  } catch (e) {
    // 500 é o certo: a Meta reentrega, e a idempotência garante que reentregar
    // não duplica nada. Devolver 200 aqui perderia a mensagem para sempre.
    return erro(
      500,
      'falha_ao_enfileirar',
      'Recebi o lote mas não consegui enfileirá-lo. Reenvie em alguns minutos.',
      e,
      { entrega: entrega.slice(0, 12), itens: itens.length },
    );
  }
});
