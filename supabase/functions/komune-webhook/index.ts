// =============================================================================
// TRIADE — `komune-webhook`  (RF-PRE-13; PRD §7.6 e §9.4)
//
// Recebe os avisos de status da plataforma Komune: reivindicou, publicou,
// completou o perfil, primeiro lead, primeiro negócio.
//
// A ORDEM É A SEGURANÇA. Nada acontece antes da assinatura conferir:
//   1. lê o corpo CRU (nunca reserializa: JSON.parse + stringify quebra o HMAC)
//   2. confere assinatura e carimbo — recusa ausente, malformada, velha, falsa
//   3. só então lê o JSON
//   4. exige `delivery_id` — sem ele não há como garantir efeito único
//   5. entrega ao Postgres, que é quem aplica e quem deduplica
//
// Reentrega da mesma `delivery_id` devolve 200 com `duplicado: true`. Isso é
// deliberado: webhook que recebe 500 numa duplicata entra em loop de retry.
//
// Nenhum caminho aqui confia no corpo antes da assinatura, e nenhum caminho
// devolve detalhe interno para quem falhou a assinatura — quem sonda a porta
// recebe sempre a mesma frase.
// =============================================================================

import { erro, exigirMetodo, json, preflight, registrar } from '../_compartilhado/http.ts';
import { rpcServico } from '../_compartilhado/postgrest.ts';
import { SegredoAusente, segredo } from '../_compartilhado/segredos.ts';
import { JANELA_REPLAY_PADRAO, verificar } from '../_compartilhado/assinatura.ts';

const TAMANHO_MAXIMO = 256 * 1024; // 256 KB: aviso de status é pequeno.

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = preflight(req);
  if (cors) return cors;
  const metodo = exigirMetodo(req, ['POST']);
  if (metodo) return metodo;

  // 1. O corpo cru, com teto. Ler antes de qualquer decisão é necessário —
  //    a assinatura é sobre ele —, mas o teto impede que "ler antes" vire
  //    um jeito de consumir memória sem credencial nenhuma.
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declarado) && declarado > TAMANHO_MAXIMO) {
    return erro(
      413,
      'corpo_grande_demais',
      'O aviso enviado é grande demais. Envie um evento por chamada.',
    );
  }
  let corpoCru: string;
  try {
    corpoCru = await req.text();
  } catch (e) {
    return erro(400, 'corpo_ilegivel', 'Não consegui ler o corpo da chamada. Reenvie o aviso.', e);
  }
  if (corpoCru.length > TAMANHO_MAXIMO) {
    return erro(
      413,
      'corpo_grande_demais',
      'O aviso enviado é grande demais. Envie um evento por chamada.',
    );
  }

  // 2. A assinatura, antes de tudo.
  let chave: string;
  try {
    chave = await segredo('komune_webhook_secret');
  } catch (e) {
    if (e instanceof SegredoAusente) {
      // Sem segredo não dá para conferir. Recusa fechada, sempre: aceitar sem
      // conferir seria transformar a porta em buraco.
      return erro(
        503,
        'integracao_nao_configurada',
        'O recebimento de avisos da Komune ainda não está configurado. Grave o segredo no Vault antes de apontar o webhook para cá.',
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

  const conferencia = await verificar({
    segredo: chave,
    corpoCru,
    assinaturaRecebida: req.headers.get('x-komune-signature'),
    carimboRecebido: req.headers.get('x-komune-timestamp'),
    janelaSegundos: JANELA_REPLAY_PADRAO,
  });

  if (!conferencia.ok) {
    // Uma frase só para todos os motivos: assinatura ausente, malformada,
    // carimbo velho e HMAC errado saem iguais. O detalhe fica no log.
    registrar('erro', {
      funcao: 'komune-webhook',
      recusa: conferencia.codigo,
      detalhe: conferencia.detalhe,
      entrega: req.headers.get('x-komune-delivery'),
    });
    return json(
      {
        ok: false,
        codigo: 'assinatura_invalida',
        mensagem:
          'Chamada recusada: assinatura ausente, expirada ou inválida. Confira o segredo compartilhado e o carimbo (janela de 5 minutos).',
      },
      401,
    );
  }

  // 3. Agora, e só agora, o JSON.
  let corpo: Record<string, unknown>;
  try {
    corpo = JSON.parse(corpoCru);
    if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
      throw new Error('corpo não é objeto');
    }
  } catch (e) {
    return erro(
      400,
      'json_invalido',
      'O corpo assinado não é um objeto JSON válido. Confira o formato do aviso.',
      e,
    );
  }

  // 4. Idempotência: cabeçalho tem precedência; o campo do corpo serve de reserva.
  const entrega = (
    req.headers.get('x-komune-delivery') ??
    (corpo.delivery_id as string | undefined) ??
    ''
  ).trim();
  if (entrega.length === 0) {
    return erro(
      400,
      'entrega_sem_id',
      'Faltou o identificador da entrega. Envie o cabeçalho X-Komune-Delivery (ou o campo delivery_id) com um valor único por aviso.',
    );
  }
  if (typeof corpo.event !== 'string' || corpo.event.trim().length === 0) {
    return erro(
      400,
      'evento_ausente',
      'Faltou o campo "event". Envie o nome do evento conforme o contrato.',
    );
  }

  // 5. O Postgres aplica. Idempotência, permissão e regra moram lá.
  try {
    const resultado = await rpcServico<Record<string, unknown>>('komune_webhook_aplicar', {
      p_delivery_id: entrega,
      p_payload: corpo,
    });
    registrar('info', {
      funcao: 'komune-webhook',
      entrega,
      evento: corpo.event,
      resultado: resultado?.aplicado === true ? 'aplicado' : (resultado?.motivo ?? 'duplicado'),
    });
    return json({ ok: true, ...resultado });
  } catch (e) {
    // 500 aqui é correto: a Komune deve reenviar. A idempotência garante que
    // reenviar não duplica efeito.
    return erro(
      500,
      'falha_ao_aplicar',
      'Recebi o aviso mas não consegui aplicá-lo. Reenvie a mesma entrega em alguns minutos.',
      e,
      {
        entrega,
        evento: corpo.event,
      },
    );
  }
});
