/**
 * Uma fonte, uma rodada: confere na lista que a fonte PODE ser coletada (na
 * hora da execução, não na hora da fila), abre a coleta, lê o robots.txt,
 * roda o coletor no ritmo da fonte, grava e fecha.
 *
 * O que faz a fonte NÃO rodar (e o pedido sair da fila sem nova tentativa):
 *  - a fonte sumiu da lista, foi recolhida pelo dono, é PROIBIDA ou espera
 *    reconferência (`pode_coletar` falso);
 *  - o coletor da lista não é o do pedido, ou o worker não tem esse coletor;
 *  - a chave `mercado.ligado` está desligada (o banco recusa abrir a coleta);
 *  - o robots.txt fecha a fonte ou não pôde ser lido.
 *  - a mesma fonte já está sendo coletada (`ja_rodando`: uma `--fonte=<id>` à
 *    mão durante a rodada da fila, ou duas cópias do worker).
 * O ensaio não abre coleta, então confere a chave e o "já rodando" antes, pelo
 * `mercado_worker_estado`: com a chave desligada, nenhum pedido sai.
 * Erro de rede ou do coletor sobe: a fila tenta de novo (até 3 vezes) e depois
 * manda para a `mercado_dlq` (a dlq da fila em `ingest_queues`). 429 e 403 não
 * são tentados de novo no mesmo dia: quem pediu para parar, parou.
 */
import type { Logger } from '../lib/log';
import { COLETORES } from './coletores';
import { TOKEN_DO_ROBO, userAgent, VERSAO_DO_COLETOR } from './identidade';
import type { EstadoDoMercado } from './banco';
import { Regioes, type RegiaoDoBanco } from './regioes';
import type { Coletor, FonteDaLista, Gravador, PontoParaMedir, ResultadoDoColetor } from './tipos';
import { Navegador } from './web';

/** A rodada de uma fonte cabe na hora do visibility timeout da fila (3.600 s), com folga. */
export const PRAZO_DA_FONTE_MS = 50 * 60_000;

export interface DependenciasDaRodada {
  lerFonte(id: string): Promise<FonteDaLista | null>;
  lerRegioes(): Promise<RegiaoDoBanco[]>;
  lerRotulosBloqueados(): Promise<string[]>;
  lerEstadoAnterior(fonte: string): Promise<Record<string, unknown>>;
  lerPontos(): Promise<PontoParaMedir[]>;
  /** O estado do banco (empresa, chave, fila, fonte já rodando); null se o banco não tem a função. */
  lerEstado(fonte: string): Promise<EstadoDoMercado | null>;
  abrirColeta(
    fonte: string,
    versao: string,
    detalhes: Record<string, unknown>,
  ): Promise<{ ok: true; coleta_id: number } | { ok: false; motivo: string }>;
  gravador(coletaId: number, fonte: string): Gravador;
  fecharColeta(a: {
    coletaId: number;
    consultasCompletas: readonly string[];
    erro: string | null;
    detalhes: Record<string, unknown>;
    hashBruto: string | null;
  }): Promise<Record<string, unknown>>;
  fetchImpl?: typeof fetch;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  coletores?: ReadonlyMap<string, Coletor>;
}

export type DesfechoDaRodada =
  | { tipo: 'nao_roda'; motivo: string }
  | { tipo: 'parou'; motivo: string; coletaId: number; fechamento: Record<string, unknown> }
  | {
      tipo: 'ok';
      coletaId: number;
      resultado: ResultadoDoColetor;
      fechamento: Record<string, unknown>;
    }
  | {
      tipo: 'falhou';
      erro: string;
      coletaId: number | null;
      fechamento: Record<string, unknown> | null;
    };

/** Por que a fonte não pode rodar agora (ou null se pode). */
export function motivoParaNaoRodar(
  fonte: FonteDaLista | null,
  coletorPedido: string | null,
  coletores: ReadonlyMap<string, Coletor>,
): string | null {
  if (!fonte) return 'fonte fora da lista';
  if (fonte.veredito === 'PROIBIDA') return 'fonte PROIBIDA';
  if (!fonte.pode_coletar)
    return fonte.reconferir ? 'fonte esperando nova conferência' : 'fonte não liberada pelo dono';
  if (!fonte.coletor) return 'a fonte não tem coletor na lista';
  if (coletorPedido && coletorPedido !== fonte.coletor)
    return `o pedido era do coletor ${coletorPedido}, a lista diz ${fonte.coletor}`;
  if (!coletores.has(fonte.coletor)) return `o worker não tem o coletor ${fonte.coletor}`;
  return null;
}

/** Por que o ensaio não pode rodar (ou null). O ensaio não abre coleta: estas travas são as de `mercado_coleta_abrir`. */
export function motivoParaNaoEnsaiar(estado: EstadoDoMercado | null): string | null {
  if (!estado) return 'este banco não tem a inteligência de mercado';
  if (estado.empresa !== 'imova') return 'a inteligência de mercado é só da Imova';
  if (!estado.ligado)
    return 'a inteligência de mercado está desligada (chave mercado.ligado): nenhum pedido sai';
  if (estado.rodando) return 'a fonte já está sendo coletada agora (ja_rodando)';
  return null;
}

function lerRobotsIlegivel(estado: Record<string, unknown>): Record<string, string> {
  const x = estado.robots_ilegivel;
  if (!x || typeof x !== 'object' || Array.isArray(x)) return {};
  return Object.fromEntries(
    Object.entries(x as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e[1]),
    ),
  );
}

const hojeEmFortaleza = (agora: number): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(agora));

export async function executarFonte(
  deps: DependenciasDaRodada,
  argumentos: {
    fonteId: string;
    coletorPedido: string | null;
    logger: Logger;
    contato?: string;
    /** Ensaio: não abre coleta nem grava (o gravador é o dado). */
    ensaio?: { gravador: Gravador };
  },
): Promise<DesfechoDaRodada> {
  const { logger } = argumentos;
  const coletores = deps.coletores ?? COLETORES;
  const agora = deps.agora ?? Date.now;
  const fonte = await deps.lerFonte(argumentos.fonteId);
  const motivo = motivoParaNaoRodar(fonte, argumentos.coletorPedido, coletores);
  if (motivo || !fonte?.coletor) return { tipo: 'nao_roda', motivo: motivo ?? 'sem coletor' };
  const coletor = coletores.get(fonte.coletor);
  if (!coletor) return { tipo: 'nao_roda', motivo: `o worker não tem o coletor ${fonte.coletor}` };
  if (argumentos.ensaio) {
    // Antes de qualquer pedido ao site.
    const naoEnsaia = motivoParaNaoEnsaiar(await deps.lerEstado(fonte.id));
    if (naoEnsaia) return { tipo: 'nao_roda', motivo: naoEnsaia };
  }

  const [regioesDoBanco, rotulos, estadoAnterior] = await Promise.all([
    deps.lerRegioes(),
    deps.lerRotulosBloqueados(),
    deps.lerEstadoAnterior(fonte.id),
  ]);
  const prazo = agora() + PRAZO_DA_FONTE_MS;
  const intervaloMs = Math.max(
    (fonte.intervalo_min_seg ?? 1) * 1000,
    coletor.intervaloMinimoMs ?? 0,
  );
  const maxPedidos =
    Math.min(fonte.max_por_rodada ?? coletor.maxPedidosPadrao, coletor.maxPedidosPadrao) +
    1 +
    (coletor.hostsExtras?.length ?? 0);
  const navegador = new Navegador({
    urlDaFonte: /^https?:\/\//i.test(fonte.url ?? '') ? fonte.url : null,
    hostsExtras: coletor.hostsExtras,
    intervaloMs,
    maxPedidos,
    prazo,
    userAgent: userAgent(argumentos.contato),
    tokenDoRobo: TOKEN_DO_ROBO,
    rotulosBloqueados: rotulos,
    robotsIlegivelDesde: lerRobotsIlegivel(estadoAnterior),
    hoje: hojeEmFortaleza(agora()),
    fetchImpl: deps.fetchImpl,
    agora: deps.agora,
    dormir: deps.dormir,
  });

  let coletaId: number | null = null;
  let gravador: Gravador;
  if (argumentos.ensaio) {
    gravador = argumentos.ensaio.gravador;
  } else {
    const aberta = await deps.abrirColeta(fonte.id, `${VERSAO_DO_COLETOR}:${coletor.chave}`, {
      coletor: coletor.chave,
      intervalo_ms: intervaloMs,
      max_pedidos: maxPedidos,
    });
    if (!aberta.ok)
      return { tipo: 'nao_roda', motivo: `o banco não abriu a coleta (${aberta.motivo})` };
    coletaId = aberta.coleta_id;
    gravador = deps.gravador(coletaId, fonte.id);
  }

  const fechar = async (
    erro: string | null,
    r: ResultadoDoColetor | null,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    if (coletaId === null) return { ensaio: true };
    return deps.fecharColeta({
      coletaId,
      consultasCompletas: erro ? [] : (r?.consultasCompletas ?? []),
      erro,
      hashBruto: r?.hashBruto ?? null,
      detalhes: {
        ...(r?.detalhes ?? {}),
        // O estado da próxima rodada: o do coletor (ou o anterior, se ele não rodou) e o robots ilegível.
        estado: { ...(r?.estado ?? estadoAnterior), robots_ilegivel: navegador.robotsIlegivel },
        erros: (r?.erros ?? []).slice(0, 20),
        completa_da_fonte: r?.completa ?? false,
        robots: navegador.robotsLidos(),
        identificacao: userAgent(argumentos.contato),
        ...extra,
      },
    });
  };

  // robots.txt da fonte, no começo da rodada. Fechado ou ilegível: a fonte não roda.
  const caminho =
    coletor.caminhoDeTeste ??
    (fonte.url && /^https?:\/\//i.test(fonte.url) ? new URL(fonte.url).pathname : '/');
  if (navegador.hostsLiberados.size > 0 && /^https?:\/\//i.test(fonte.url ?? '')) {
    const aberto = await navegador.abrir(caminho);
    if (!aberto) {
      const parada = navegador.parada ?? 'robots.txt fecha a fonte';
      logger.warn('a fonte não rodou: robots.txt', { fonte: fonte.id, parada });
      const fechamento = await fechar(`robots.txt: ${parada}`, null);
      return coletaId === null
        ? { tipo: 'nao_roda', motivo: parada }
        : { tipo: 'parou', motivo: parada, coletaId, fechamento };
    }
  }

  const regioes = new Regioes(regioesDoBanco);
  try {
    const r = await coletor.coletar({
      fonte,
      navegador,
      regioes,
      gravador,
      logger,
      dia: hojeEmFortaleza(agora()),
      prazo,
      estadoAnterior,
      pontos: () => deps.lerPontos(),
      agora: deps.agora,
    });
    // 429 ou 403 no meio: o que entrou fica, mas a rodada não conta como boa (ninguém ganha falta).
    const parada = navegador.parada;
    const pediuParaParar = parada !== null && /HTTP (429|403)/.test(parada);
    const erro = pediuParaParar ? `a fonte pediu para parar: ${parada}` : null;
    const fechamento = await fechar(erro, r);
    logger.info('fonte coletada', {
      fonte: fonte.id,
      coleta: coletaId,
      completa: r.completa,
      consultas_completas: r.consultasCompletas?.length ?? 0,
      pedidos: navegador.pedidos,
      parada,
    });
    if (pediuParaParar && coletaId !== null)
      return { tipo: 'parou', motivo: parada ?? '', coletaId, fechamento };
    if (coletaId === null) return { tipo: 'ok', coletaId: 0, resultado: r, fechamento };
    return { tipo: 'ok', coletaId, resultado: r, fechamento };
  } catch (e) {
    const texto = e instanceof Error ? e.message : String(e);
    let fechamento: Record<string, unknown> | null = null;
    try {
      fechamento = await fechar(texto, null);
    } catch (e2) {
      logger.error('não consegui fechar a coleta com erro', {
        fonte: fonte.id,
        coleta: coletaId,
        erro: e2 instanceof Error ? e2.message : String(e2),
      });
    }
    return { tipo: 'falhou', erro: texto, coletaId, fechamento };
  }
}
