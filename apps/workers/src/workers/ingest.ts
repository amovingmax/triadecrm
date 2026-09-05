/**
 * worker-ingest — o coletor do Radar (RF-RAD, anexos R03 e R06).
 *
 * O laço é deliberadamente burro: lê uma fila, trata a mensagem, bate ponto,
 * repete. Toda a inteligência (dedup, higiene, resolução do candidato,
 * proveniência, retenção) está no Postgres (ADR-03), e todo o cuidado legal está
 * uma camada abaixo, em `ingest/guarda.ts` e `ingest/whitelist.ts`.
 *
 * Ordem das filas dentro de uma volta: jobs → páginas → registros. É a ordem da
 * esteira, e mantê-la faz o trabalho fluir na mesma volta em vez de esperar a
 * próxima — a coleta de uma listagem já vira candidato antes de o worker dormir.
 *
 * Encerramento: SIGINT e SIGTERM param depois da mensagem atual, nunca no meio.
 * Uma mensagem interrompida no meio volta sozinha quando o `visibility timeout`
 * da fila expira, mas terminar o que já começou é mais barato que reprocessar.
 */
import {
  agendarColeta,
  AGENTE_PADRAO,
  consumirFila,
  contagensZeradas,
  fecharLotesTerminados,
  type ContextoDaEsteira,
} from '../ingest/etapas';
import { Acelerador } from '../ingest/acelerador';
import { abrirLote, buscarFontePorSlug, criarCliente } from '../ingest/esteira';
import { Portaria } from '../ingest/guarda';
import { criarPulso } from '../lib/pulso';

import type { WorkerContext } from '../lib/context';

/** Fonte coletada quando ninguém diz outra: a espinha dorsal da lista-alvo (R03 §2.1). */
const FONTE_PADRAO = 'casamentos_com_br';

/** Descanso entre voltas quando não há nada em fila nenhuma. */
const DESCANSO_MS = 5_000;

/** Sem `unref()`: um timer que não segura o laço de eventos faria o worker morrer no descanso. */
function dormir(ms: number): Promise<void> {
  return new Promise((resolva) => {
    setTimeout(resolva, ms);
  });
}

function inteiro(valor: string | true | undefined, padrao: number): number {
  if (typeof valor !== 'string') return padrao;
  const numero = Number.parseInt(valor, 10);
  return Number.isFinite(numero) && numero > 0 ? numero : padrao;
}

function texto(valor: string | true | undefined): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

export async function runIngest(ctx: WorkerContext<'ingest'>): Promise<number> {
  const { env, logger, opcoes } = ctx;
  const umaVez = opcoes['uma-vez'] === true;

  const cliente = criarCliente(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const portaria = new Portaria(AGENTE_PADRAO, logger);
  // Um acelerador por processo: é ele que faz `sources.rate_limit_seconds` valer
  // entre mensagens da fila, e não só dentro de uma corrida do Crawlee.
  const acelerador = new Acelerador();
  const contexto: ContextoDaEsteira = {
    cliente,
    logger,
    portaria,
    acelerador,
    agente: AGENTE_PADRAO,
  };

  const pulso = criarPulso({ cliente, logger, worker: 'ingest' });
  const contagens = contagensZeradas();

  await pulso.bater('ok', null, { modo: umaVez ? 'uma-vez' : 'contínuo', agente: AGENTE_PADRAO });
  pulso.iniciar();

  let parando = false;
  const pedirParada = (sinal: string): void => {
    if (parando) return;
    parando = true;
    logger.info('parada pedida: o worker encerra depois da mensagem atual', { sinal });
  };
  process.on('SIGINT', () => pedirParada('SIGINT'));
  process.on('SIGTERM', () => pedirParada('SIGTERM'));

  try {
    if (opcoes.agendar === true) {
      const agendado = await agendar(ctx, contexto);
      if (!agendado) {
        await pulso.bater('degradado', null, { motivo: 'nada_agendado' });
        return 1;
      }
    }

    for (;;) {
      if (parando) break;

      const lidas =
        (await consumirFila(contexto, 'jobs', contagens)) +
        (await consumirFila(contexto, 'paginas', contagens)) +
        (await consumirFila(contexto, 'registros', contagens, 10));

      pulso.somar(lidas, 0);
      await pulso.bater(contagens.falhas > 0 ? 'degradado' : 'ok', null, {
        ...contagens,
        modo: umaVez ? 'uma-vez' : 'contínuo',
      });

      if (lidas > 0) continue;

      await fecharLotesTerminados(contexto);
      if (umaVez) break;
      await dormir(DESCANSO_MS);
    }

    logger.info('coleta encerrada', { ...contagens });
    await pulso.bater('parado', null, { ...contagens, encerrado_em: new Date().toISOString() });
    return contagens.falhas > 0 ? 1 : 0;
  } finally {
    pulso.parar();
  }
}

/** `--agendar`: abre o lote e enfileira a ordem de coleta antes de o laço começar. */
async function agendar(ctx: WorkerContext<'ingest'>, contexto: ContextoDaEsteira): Promise<boolean> {
  const { logger, opcoes } = ctx;
  const slug = texto(opcoes.fonte) ?? FONTE_PADRAO;
  const maxPaginas = inteiro(opcoes.paginas, 1);
  const categorias =
    texto(opcoes.categorias)
      ?.split(',')
      .map((c) => c.trim())
      .filter((c) => c !== '') ?? null;

  const fonte = await buscarFontePorSlug(contexto.cliente, slug);
  if (!fonte) {
    logger.error('fonte não encontrada no catálogo', { fonte: slug });
    return false;
  }

  const hoje = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza' }).format(
    new Date(),
  );
  const rotulo = texto(opcoes.rotulo) ?? `Coleta ${fonte.name} de ${hoje}`;

  const lote = await abrirLote(contexto.cliente, {
    fonteId: fonte.id,
    rotulo,
    parametros: {
      categorias: categorias ?? 'catálogo completo',
      max_paginas_por_categoria: maxPaginas,
      agente: contexto.agente,
    },
  });

  if (!lote.ok) {
    logger.error('o lote não pôde ser aberto', { fonte: slug, motivo: lote.reason });
    return false;
  }

  const enfileirado = await agendarColeta(contexto, {
    loteId: lote.batch_id,
    fonteId: fonte.id,
    categorias: categorias && categorias.length > 0 ? categorias : null,
    maxPaginas,
  });

  logger.info('coleta agendada', {
    batch_id: lote.batch_id,
    rotulo,
    fonte: fonte.slug,
    categorias: categorias ?? 'todas',
    max_paginas: maxPaginas,
    enfileirado,
  });
  return true;
}
