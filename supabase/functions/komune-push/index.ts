// =============================================================================
// TRIADE — `komune-push`  (RF-PRE-01; PRD §7.6 e §9.4; ADR-02, ADR-04, ADR-11)
//
// A ÚNICA porta de escrita do Triade na plataforma Komune. Não fala com o
// banco da Komune: monta o payload do contrato mínimo v0, assina com HMAC e
// faz POST na Edge Function `crm-pre-registration` do lado de lá, com
// `Idempotency-Key`. O contrato está em docs/operacao/contrato-precadastro.md.
//
// Quem chama: `pg_cron` a cada 5 min (app.komune_push_disparar), ou uma pessoa
// pedindo reenvio. Nunca alguém de fora: exige a chave de service_role.
//
// O que NÃO faz
//   * Não decide se pode enviar. Quem decide é o Postgres: a fila só devolve
//     item se `integracao.komune.push_ativo` estiver ligado, se houver
//     autorização vigente em `consent_events` e se o alvo não estiver
//     suprimido. A função é braço, não cabeça (ADR-03).
//   * Não manda token de reivindicação em claro. O payload leva o hash.
// =============================================================================

import { erro, exigirMetodo, json, preflight, registrar } from '../_compartilhado/http.ts';
import { rpcServico } from '../_compartilhado/postgrest.ts';
import { SegredoAusente, segredo } from '../_compartilhado/segredos.ts';
import { cabecalhosAssinados, iguaisEmTempoConstante } from '../_compartilhado/assinatura.ts';

interface ItemDaFila {
  msg_id: number;
  outbox_id: string;
  idempotency_key: string;
  tentativas: number;
  payload: Record<string, unknown>;
}

interface Lote {
  ativo: boolean;
  itens?: ItemDaFila[];
  motivo?: string;
}

const CHAVE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TIMEOUT_MS = 15_000;

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = preflight(req);
  if (cors) return cors;
  const metodo = exigirMetodo(req, ['POST']);
  if (metodo) return metodo;

  // Porta fechada por padrão: só a chave de service_role entra, e a comparação
  // é em tempo constante como qualquer outra comparação de credencial.
  const autorizacao = req.headers.get('authorization') ?? '';
  if (
    CHAVE_SERVICO.length === 0 ||
    !iguaisEmTempoConstante(autorizacao, `Bearer ${CHAVE_SERVICO}`)
  ) {
    return erro(
      401,
      'nao_autorizado',
      'Esta função é interna. Chame com a chave de serviço do projeto.',
    );
  }

  let destino: string;
  let chaveHmac: string;
  try {
    destino = await segredo('komune_push_url');
    chaveHmac = await segredo('komune_push_secret');
  } catch (e) {
    if (e instanceof SegredoAusente) {
      return erro(
        503,
        'integracao_nao_configurada',
        'A integração com a Komune ainda não tem endereço e segredo. Grave-os no Vault (app.gravar_segredo) antes de ligar o envio.',
        e,
        { segredo_faltando: e.nome },
      );
    }
    return erro(
      500,
      'falha_ao_ler_segredo',
      'Não consegui ler a configuração da integração. Tente de novo em alguns minutos.',
      e,
    );
  }

  let lote: Lote;
  try {
    lote = await rpcServico<Lote>('komune_push_lote', { p_qty: 10 });
  } catch (e) {
    return erro(
      500,
      'fila_indisponivel',
      'Não consegui ler a fila de envio. Tente de novo em alguns minutos.',
      e,
    );
  }

  if (!lote.ativo) {
    registrar('info', { funcao: 'komune-push', resultado: 'desligado', motivo: lote.motivo });
    return json({ ok: true, ativo: false, motivo: lote.motivo, enviados: 0, falhas: 0 });
  }

  const itens = lote.itens ?? [];
  let enviados = 0;
  let falhas = 0;

  for (const item of itens) {
    const corpoCru = JSON.stringify(item.payload);
    try {
      const cabecalhos = await cabecalhosAssinados({
        segredo: chaveHmac,
        corpoCru,
        chaveIdempotencia: item.idempotency_key,
        prefixo: 'X-Triade',
      });

      const controle = new AbortController();
      const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);
      let resposta: Response;
      try {
        resposta = await fetch(destino, {
          method: 'POST',
          headers: cabecalhos,
          body: corpoCru,
          signal: controle.signal,
        });
      } finally {
        clearTimeout(relogio);
      }

      const texto = await resposta.text();

      if (resposta.ok) {
        let idDoFornecedor: string | null = null;
        try {
          const corpo = texto.length > 0 ? JSON.parse(texto) : {};
          const bruto = corpo?.komune_supplier_id ?? corpo?.supplier_id ?? null;
          idDoFornecedor = typeof bruto === 'string' ? bruto : null;
        } catch {
          // Resposta 2xx sem JSON é aceita: o efeito do lado de lá aconteceu.
          idDoFornecedor = null;
        }
        await rpcServico('komune_push_ok', {
          p_msg_id: item.msg_id,
          p_outbox_id: item.outbox_id,
          p_http_status: resposta.status,
          p_komune_supplier_id: idDoFornecedor,
        });
        enviados += 1;
        registrar('info', {
          funcao: 'komune-push',
          outbox_id: item.outbox_id,
          http: resposta.status,
          resultado: 'enviado',
        });
      } else {
        // 4xx que não seja 408/429 é defeito de contrato: reenviar não conserta,
        // mas quem decide desistir é o Postgres, pelo teto de tentativas.
        await rpcServico('komune_push_erro', {
          p_msg_id: item.msg_id,
          p_outbox_id: item.outbox_id,
          p_erro: `HTTP ${resposta.status}: ${texto.slice(0, 300)}`,
          p_http_status: resposta.status,
        });
        falhas += 1;
        registrar('erro', {
          funcao: 'komune-push',
          outbox_id: item.outbox_id,
          http: resposta.status,
          resultado: 'recusado',
        });
      }
    } catch (e) {
      const descricao = e instanceof Error ? `${e.name}: ${e.message}` : 'erro desconhecido';
      await rpcServico('komune_push_erro', {
        p_msg_id: item.msg_id,
        p_outbox_id: item.outbox_id,
        p_erro: descricao.slice(0, 300),
        p_http_status: null,
      }).catch(() => undefined);
      falhas += 1;
      registrar('erro', {
        funcao: 'komune-push',
        outbox_id: item.outbox_id,
        resultado: 'excecao',
        interno: descricao,
      });
    }
  }

  return json({ ok: true, ativo: true, lidos: itens.length, enviados, falhas });
});
