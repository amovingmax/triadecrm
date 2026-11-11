/**
 * Uma passada da agenda do Calendly no worker-wa (10/11/2026).
 *
 * O banco decide (ADR-03); aqui só se executa e se responde:
 *
 *   1. `calendly_cancelamentos_pendentes` → cancela no Calendly o agendamento
 *      que chegou em horário ocupado e o que a equipe desmarcou pelo CRM →
 *      `calendly_cancelamento_feito` / `_falhou`;
 *   2. `agenda_espelho_pendencias` → grava e apaga os blocos "Ocupado" no
 *      Google Agenda que o Calendly confere → `agenda_espelho_gravado` /
 *      `_apagado` / `_falhou`.
 *
 * Roda no worker-wa, como o e-mail de reunião: é o processo da Imova que já
 * está sempre ligado no Fly (`imova-worker-wa`). Cada parte só existe com a
 * sua chave (CALENDLY_TOKEN, GOOGLE_AGENDA_CREDENCIAL); sem nenhuma — como no
 * worker da KOMUNE —, a passada não faz nada e não vai ao banco.
 *
 * NADA AQUI DERRUBA O LAÇO DO WHATSAPP: erro num item vira `_falhou` (o banco
 * espera e tenta de novo), e erro da passada inteira vira log.
 *
 * O ESPELHO NÃO FICA MAIS EM SILÊNCIO (11/11/2026): sem `google_agenda_id` no
 * banco ele saía sem dizer nada, e o log da partida dizia "google: true". Agora
 * o estado do espelho vira UMA linha de log quando muda (desligado → ligado e
 * de volta), e não uma a cada 15 s; o mesmo estado aparece ao admin na Agenda
 * (`public.agenda_espelho_estado`). O feriado (`tipo = 'feriado'`) vai ao
 * Google como dia inteiro.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { cancelarNoCalendly } from './calendly';
import { ClienteDoGoogleAgenda, lerCredencial } from './google-agenda';
import type { Logger } from '../lib/log';

/** Quantos itens de cada lista por passada. O espelho não tem SLA de segundos. */
const LOTE_DO_CALENDLY = 10;
const LOTE_DO_GOOGLE = 20;
/** Banco sem as funções (a KOMUNE, ou a migração ainda não publicada): espera antes de perguntar de novo. */
const ESPERA_SEM_FUNCOES_MS = 30 * 60_000;

export interface ResumoDaAgenda {
  canceladosNoCalendly: number;
  gravadosNoGoogle: number;
  apagadosNoGoogle: number;
  falhas: number;
}

type Item = Record<string, unknown>;

function lista(valor: unknown): Item[] {
  return Array.isArray(valor)
    ? valor.filter((v): v is Item => typeof v === 'object' && v !== null)
    : [];
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

function semFuncao(mensagem: string): boolean {
  return /could not find the function|function .* does not exist|PGRST202/i.test(mensagem);
}

export interface SincronizacaoDaAgenda {
  /** Uma passada. Nunca lança. */
  rodar(): Promise<ResumoDaAgenda>;
  /** Há alguma chave? Sem nenhuma, `rodar` não faz nada. */
  readonly ligada: boolean;
  /** Há o token do Calendly: cancela lá o que o CRM pede. */
  readonly cancelaNoCalendly: boolean;
  /**
   * A chave do Google foi LIDA. Não quer dizer que o espelho está ligado: ele
   * depende também de `google_agenda_id` no banco, e a primeira passada diz.
   */
  readonly credencialDoGoogle: boolean;
}

/** As frases do log do espelho, uma vez a cada mudança. */
export const LOG_ESPELHO_DESLIGADO =
  'espelho desligado: falta google_agenda_id em app_settings[calendly]';
export const LOG_ESPELHO_SEM_CREDENCIAL =
  'espelho desligado: falta GOOGLE_AGENDA_CREDENCIAL neste worker';
export const LOG_ESPELHO_LIGADO = 'espelho no Google ligado';

export function criarSincronizacaoDaAgenda(opcoes: {
  cliente: SupabaseClient;
  logger: Logger;
  tokenCalendly?: string;
  credencialGoogle?: string;
  /** GOOGLE_AGENDA_SUB: o usuário do Workspace em nome de quem gravar (plano B). */
  subGoogle?: string;
  buscar?: typeof fetch;
  apiDoCalendly?: string;
  apiDoGoogle?: string;
}): SincronizacaoDaAgenda {
  const { cliente, logger } = opcoes;

  let google: ClienteDoGoogleAgenda | null = null;
  if (opcoes.credencialGoogle) {
    try {
      google = new ClienteDoGoogleAgenda({
        credencial: lerCredencial(opcoes.credencialGoogle),
        sub: opcoes.subGoogle,
        buscar: opcoes.buscar,
        api: opcoes.apiDoGoogle,
      });
    } catch (e) {
      // Chave torta não derruba o worker: o resto do laço segue, e o log diz por quê.
      logger.error('GOOGLE_AGENDA_CREDENCIAL inválida: o espelho no Google fica parado', {
        erro: (e as Error).message,
      });
    }
  }
  const tokenCalendly = opcoes.tokenCalendly ?? null;
  const ligada = google !== null || tokenCalendly !== null;
  let esperarAte = 0;
  // O que o log já disse do espelho: só se diz de novo quando muda.
  let espelhoDito: 'desligado' | 'ligado' | null = null;

  // Worker com o Calendly e sem a chave do Google (a da Imova, antes do
  // espelho): o espelho nunca vai ao banco, então é aqui que se diz, uma vez.
  // Sem chave nenhuma (a KOMUNE), silêncio, como sempre.
  if (tokenCalendly !== null && !opcoes.credencialGoogle) {
    logger.warn(LOG_ESPELHO_SEM_CREDENCIAL, {
      efeito: 'o que a equipe marca no CRM continua livre no Calendly',
    });
  }

  async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await cliente.rpc(nome, args);
    if (error) throw new Error(`${nome}: ${error.message}`);
    return data as T;
  }

  async function cancelamentos(resumo: ResumoDaAgenda): Promise<void> {
    if (!tokenCalendly) return;
    const pendentes = lista(
      await rpc<unknown>('calendly_cancelamentos_pendentes', { p_limite: LOTE_DO_CALENDLY }),
    );
    for (const p of pendentes) {
      const id = texto(p.id);
      const eventoUri = texto(p.evento_uri);
      if (!id || !eventoUri) continue;
      const r = await cancelarNoCalendly({
        token: tokenCalendly,
        eventoUri,
        motivo: texto(p.motivo) ?? 'A Imova Imobiliária precisou cancelar este compromisso.',
        buscar: opcoes.buscar,
        api: opcoes.apiDoCalendly,
      });
      if (r.ok) {
        await rpc('calendly_cancelamento_feito', { p_id: id });
        resumo.canceladosNoCalendly += 1;
        logger.info('agendamento cancelado no Calendly', { agendamento: id });
      } else {
        await rpc('calendly_cancelamento_falhou', {
          p_id: id,
          p_erro: r.erro,
          p_definitivo: r.definitivo,
        });
        resumo.falhas += 1;
        logger.warn('o Calendly não cancelou', {
          agendamento: id,
          erro: r.erro,
          definitivo: r.definitivo,
        });
      }
    }
  }

  async function espelho(resumo: ResumoDaAgenda): Promise<void> {
    if (!google) return;
    const p =
      (await rpc<Item | null>('agenda_espelho_pendencias', { p_limite: LOTE_DO_GOOGLE })) ?? {};
    const calendario = p.ligado === true ? texto(p.calendario) : null;
    if (!calendario) {
      if (espelhoDito !== 'desligado') {
        espelhoDito = 'desligado';
        logger.warn(LOG_ESPELHO_DESLIGADO, {
          efeito: 'o que a equipe marca no CRM continua livre no Calendly',
          guia: 'docs/operacao/calendly.md',
        });
      }
      return;
    }
    if (espelhoDito !== 'ligado') {
      espelhoDito = 'ligado';
      logger.info(LOG_ESPELHO_LIGADO, {
        calendario,
        emNomeDeUmUsuario: Boolean(opcoes.subGoogle),
      });
    }

    for (const g of lista(p.gravar)) {
      const item = texto(g.item_id);
      const evento = texto(g.evento_id);
      const inicio = texto(g.inicio);
      const fim = texto(g.fim);
      if (!item || !evento || !inicio || !fim) continue;
      const dia = texto(g.dia);
      const ate = texto(g.ate);
      const r =
        g.tipo === 'feriado' && dia && ate
          ? await google.gravarFeriado(calendario, evento, dia, ate)
          : await google.gravar(
              calendario,
              evento,
              new Date(inicio).toISOString(),
              new Date(fim).toISOString(),
            );
      if (r.ok) {
        await rpc('agenda_espelho_gravado', { p_item: item, p_inicio: inicio, p_fim: fim });
        resumo.gravadosNoGoogle += 1;
      } else {
        await rpc('agenda_espelho_falhou', {
          p_item: item,
          p_inicio: inicio,
          p_fim: fim,
          p_erro: r.erro,
        });
        resumo.falhas += 1;
        logger.warn('o Google não gravou o bloco', { item, erro: r.erro });
      }
    }

    for (const a of lista(p.apagar)) {
      const item = texto(a.item_id);
      const evento = texto(a.evento_id);
      if (!item || !evento) continue;
      const r = await google.apagar(calendario, evento);
      if (r.ok) {
        await rpc('agenda_espelho_apagado', { p_item: item });
        resumo.apagadosNoGoogle += 1;
      } else {
        await rpc('agenda_espelho_falhou', {
          p_item: item,
          p_inicio: null,
          p_fim: null,
          p_erro: r.erro,
        });
        resumo.falhas += 1;
        logger.warn('o Google não apagou o bloco', { item, erro: r.erro });
      }
    }
  }

  return {
    ligada,
    cancelaNoCalendly: tokenCalendly !== null,
    credencialDoGoogle: google !== null,
    async rodar(): Promise<ResumoDaAgenda> {
      const resumo: ResumoDaAgenda = {
        canceladosNoCalendly: 0,
        gravadosNoGoogle: 0,
        apagadosNoGoogle: 0,
        falhas: 0,
      };
      if (!ligada || Date.now() < esperarAte) return resumo;
      // As duas partes são independentes: o Google fora do ar não segura o Calendly.
      for (const [nome, parte] of [
        ['cancelamentos no Calendly', cancelamentos],
        ['espelho no Google', espelho],
      ] as const) {
        try {
          await parte(resumo);
        } catch (e) {
          const mensagem = (e as Error).message;
          if (semFuncao(mensagem)) {
            esperarAte = Date.now() + ESPERA_SEM_FUNCOES_MS;
            logger.info(
              'o banco não tem as funções da agenda do Calendly; pergunto de novo em 30 min',
              {
                erro: mensagem,
              },
            );
            return resumo;
          }
          resumo.falhas += 1;
          logger.error(`a passada da agenda falhou (${nome})`, { erro: mensagem });
        }
      }
      return resumo;
    },
  };
}
