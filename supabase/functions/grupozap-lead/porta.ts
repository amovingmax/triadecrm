// =============================================================================
// TRIADE — a porta dos leads: o CRM anota quando alguém bate (12/11/2026)
//
// Até aqui, a única prova de que o Grupo OLX chamou `grupozap-lead` era o log
// do Supabase, que ninguém da Imova vê. Agora cada chamada vira +1 numa linha
// por dia, resultado e "veio com o user-agent do Grupo OLX"
// (`public.grupozap_lead_chamadas`, pela RPC `grupozap_lead_anotar_chamada`,
// com a service_role, migração 20261113131000). É isso que o passo "Os leads
// vêm para o CRM", no alto de Anúncios, lê.
//
// O QUE É ANOTADO: o resultado, o status HTTP e se o user-agent é o do Grupo
// OLX. Nada da pessoa — nem nome, telefone, e-mail, mensagem, nem o corpo — e
// nem o user-agent inteiro.
//
//   recebido             200, lead novo gravado
//   repetido             200, o mesmo lead de novo (a idempotência)
//   teste                200, NÃO gravado: chave de teste ou lead de exemplo
//   recusado_credencial  401
//   erro                 todo o resto: 400, 405, 413, 500, 503
//
// MELHOR ESFORÇO. Anotar nunca muda a resposta ao Grupo OLX nem a atrasa: a
// tarefa sai depois que a resposta está pronta, entregue ao runtime por
// `EdgeRuntime.waitUntil` (o Supabase segura o worker até ela terminar, sem
// segurar a resposta). Falhou, demorou mais que o prazo ou lançou: fica um
// aviso no log, e só.
// =============================================================================

import { registrar } from '../_compartilhado/http.ts';

export type Resultado = 'recebido' | 'repetido' | 'teste' | 'recusado_credencial' | 'erro';

/** O user-agent com que o Grupo OLX entrega os leads (documentação de leads). */
export const USER_AGENT_DO_GRUPO_OLX = 'grupozap-notification-api';

/** Quanto a anotação pode levar antes de ser abandonada (a resposta já saiu). */
export const PRAZO_PARA_ANOTAR_MS = 3000;

/** O que vai ao banco. Só isto: nenhum dado da pessoa nem do corpo. */
export type Chamada = { resultado: Resultado; status: number; doGrupoOlx: boolean };

/** `public.grupozap_lead_anotar_chamada`; o que ela devolve não importa à resposta. */
export type Anotar = (chamada: Chamada) => Promise<unknown>;

/** Entrega ao runtime uma tarefa que roda depois da resposta. */
export type Adiar = (tarefa: Promise<unknown>) => void;

const FUNCAO = 'grupozap-lead';

/**
 * O user-agent é o do Grupo OLX? Sem diferenciar maiúsculas, e aceitando versão
 * ou outro texto em volta. Lê só o começo do cabeçalho.
 */
export function ehDoGrupoOlx(userAgent: string | null): boolean {
  return (userAgent ?? '').slice(0, 300).toLowerCase().includes(USER_AGENT_DO_GRUPO_OLX);
}

/**
 * `EdgeRuntime.waitUntil` quando o runtime do Supabase oferece; fora dele (o
 * Deno puro do contêiner local, os testes), a tarefa já está rodando e o
 * processo não termina com a resposta: não há o que fazer.
 */
export function adiarNoRuntime(tarefa: Promise<unknown>): void {
  const runtime = (
    globalThis as { EdgeRuntime?: { waitUntil?: (promessa: Promise<unknown>) => void } }
  ).EdgeRuntime;
  if (typeof runtime?.waitUntil === 'function') runtime.waitUntil(tarefa);
}

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Anota a chamada sem esperar e sem falhar. Nada daqui chega a quem chamou:
 * `anotar` que lança, que rejeita, que devolve `ok: false` ou que não termina
 * no prazo vira um aviso no log; `adiar` que lança também. A tarefa entregue ao
 * runtime nunca rejeita e termina, no máximo, no prazo.
 */
export function anotarSemEsperar(
  chamada: Chamada,
  anotar: Anotar,
  adiar: Adiar,
  prazoMs: number = PRAZO_PARA_ANOTAR_MS,
): void {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<'prazo'>((resolver) => {
    relogio = setTimeout(() => resolver('prazo'), prazoMs);
  });
  const anotacao = Promise.resolve().then(() => anotar(chamada));

  const tarefa = Promise.race([anotacao, prazo])
    .then((r) => {
      if (r === 'prazo') {
        registrar('aviso', { funcao: FUNCAO, evento: 'chamada_nao_anotada', motivo: 'prazo' });
      } else if ((r as { ok?: unknown } | null)?.ok === false) {
        registrar('aviso', {
          funcao: FUNCAO,
          evento: 'chamada_nao_anotada',
          motivo: String((r as { motivo?: unknown }).motivo ?? 'ok_falso').slice(0, 80),
        });
      }
    })
    .catch((e) => {
      registrar('aviso', {
        funcao: FUNCAO,
        evento: 'chamada_nao_anotada',
        interno: mensagemDe(e).slice(0, 300),
      });
    })
    .finally(() => clearTimeout(relogio));

  try {
    adiar(tarefa);
  } catch (e) {
    registrar('aviso', {
      funcao: FUNCAO,
      evento: 'chamada_nao_adiada',
      interno: mensagemDe(e).slice(0, 300),
    });
  }
}
