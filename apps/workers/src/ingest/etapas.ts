/**
 * As três etapas da esteira de ingestão, uma por fila `pgmq` (ADR-11).
 *
 *   ingest_jobs    "colete a fonte X"      → confere o robots.txt e enfileira as páginas
 *   ingest_pages   "busque esta URL"       → respeita o intervalo da fonte, extrai e grava a captura
 *   ingest_records "resolva esta captura"  → normaliza, deduplica e cria o candidato
 *
 * Três filas e não uma porque um lote de páginas travado não pode segurar a
 * normalização de registros que já chegaram — e porque cada etapa tem um tempo
 * próprio (minutos, segundos, milissegundos), que é o `visibility_seconds` de
 * cada fila em `public.ingest_queues`.
 *
 * Duas naturezas de erro, tratadas de formas diferentes de propósito:
 *  - TRANSITÓRIO (rede, 5xx, tempo esgotado): a mensagem falha, ganha backoff
 *    exponencial e volta; passado o teto, cai na dead-letter com o erro junto.
 *  - DETERMINÍSTICO (robots proíbe, fonte desligada, payload fora da whitelist):
 *    repetir não muda nada. A mensagem é CONCLUÍDA e o motivo vai para o log e
 *    para `import_batches.error`. Deixar isso girando cinco vezes só atrasaria a
 *    dead-letter e bateria de novo numa porta que já disse não.
 */
import { z } from 'zod';

import { hostDaUrl, type Acelerador } from './acelerador';
import { adaptadorCasamentos } from './casamentos';
import { buscarPaginas, type TipoDeColetor } from './coletor';
import {
  concluir,
  enfileirar,
  falhar,
  FILAS,
  gravarCaptura,
  buscarFontePorId,
  lerFila,
  marcarLote,
  processarCaptura,
  type ClienteDoBanco,
  type Fonte,
  type MensagemDaFila,
  type NomeDaFila,
} from './esteira';
import { filtrarPelaWhitelist, payloadTemIdentidade } from './whitelist';

import type { Adaptador } from './adaptador';
import type { Portaria } from './guarda';
import type { Logger } from '../lib/log';

/** Fontes que têm adaptador escrito. Fonte sem adaptador não coleta — e diz isso. */
const ADAPTADORES: Readonly<Record<string, Adaptador>> = {
  casamentos_com_br: adaptadorCasamentos,
};

export const AGENTE_PADRAO = 'KomuneBot/1.0 (+https://komune.app.br; CRM de captação da Komune)';

export interface ContextoDaEsteira {
  cliente: ClienteDoBanco;
  logger: Logger;
  portaria: Portaria;
  /** O freio por host: `sources.rate_limit_seconds` valendo entre mensagens, não só dentro de uma corrida. */
  acelerador: Acelerador;
  agente: string;
}

export interface Contagens {
  jobs: number;
  paginas: number;
  capturas_novas: number;
  capturas_repetidas: number;
  registros_resolvidos: number;
  candidatos_novos: number;
  bloqueadas_pelo_robots: number;
  falhas: number;
}

export function contagensZeradas(): Contagens {
  return {
    jobs: 0,
    paginas: 0,
    capturas_novas: 0,
    capturas_repetidas: 0,
    registros_resolvidos: 0,
    candidatos_novos: 0,
    bloqueadas_pelo_robots: 0,
    falhas: 0,
  };
}

// ---------------------------------------------------------------------------
// Formato das mensagens
// ---------------------------------------------------------------------------
// A chave de idempotência viaja DENTRO da mensagem: é ela que o consumidor usa
// para concluir ou falhar, e ela precisa ser a mesma que o produtor gravou em
// `ingest_dedup`. Deduzi-la no consumidor seria inventar a chave duas vezes.

const mensagemDeJob = z.object({
  chave: z.string().min(1),
  batch_id: z.uuid(),
  source_id: z.number().int().positive(),
  categorias: z.array(z.string().min(1)).nullable().default(null),
  max_paginas: z.number().int().min(1).max(50).default(1),
});

const mensagemDePagina = z.object({
  chave: z.string().min(1),
  batch_id: z.uuid(),
  source_id: z.number().int().positive(),
  url: z.url(),
  categoria_origem: z.string().min(1).nullable().default(null),
  pagina: z.number().int().min(1).default(1),
  max_paginas: z.number().int().min(1).max(50).default(1),
});

const mensagemDeRegistro = z.object({
  chave: z.string().min(1),
  batch_id: z.uuid(),
  raw_capture_id: z.uuid(),
});

export function chaveDoJob(loteId: string): string {
  return `job:${loteId}`;
}
export function chaveDaPagina(loteId: string, url: string): string {
  return `pag:${loteId}:${url}`;
}
/**
 * A chave do registro é POR LOTE, e não só pela captura. Se fosse só pela
 * captura, a recoleta mensal — que devolve a mesma `raw_capture` quando o
 * conteúdo não mudou — encontraria a chave já processada, não enfileiraria nada,
 * e `source_record.last_seen_at` ficaria congelado na primeira coleta. "Visto de
 * novo hoje" é justamente o que a retenção do PRD §10.6 lê. Dentro de um mesmo
 * lote a chave continua única, que é onde a idempotência precisa valer: uma
 * reentrega da mesma mensagem não processa duas vezes.
 */
export function chaveDoRegistro(loteId: string, capturaId: string): string {
  return `reg:${loteId}:${capturaId}`;
}

/** Enfileira a ordem de coleta de um lote já aberto. */
export async function agendarColeta(
  contexto: ContextoDaEsteira,
  argumentos: {
    loteId: string;
    fonteId: number;
    categorias: string[] | null;
    maxPaginas: number;
  },
): Promise<boolean> {
  const chave = chaveDoJob(argumentos.loteId);
  const resposta = await enfileirar(
    contexto.cliente,
    FILAS.jobs,
    {
      chave,
      batch_id: argumentos.loteId,
      source_id: argumentos.fonteId,
      categorias: argumentos.categorias,
      max_paginas: argumentos.maxPaginas,
    },
    chave,
    argumentos.loteId,
  );
  if (resposta.enfileirado) {
    await marcarLote(contexto.cliente, argumentos.loteId, 'na_fila');
    return true;
  }
  contexto.logger.info('a coleta deste lote já estava na fila', {
    batch_id: argumentos.loteId,
    motivo: resposta.motivo,
  });
  return false;
}

// ---------------------------------------------------------------------------
// Etapa 1 — ingest_jobs: planejar a coleta
// ---------------------------------------------------------------------------

function tipoDoColetor(fonte: Fonte): TipoDeColetor {
  return fonte.coletor.tipo === 'playwright' ? 'playwright' : 'http';
}

async function tratarJob(
  contexto: ContextoDaEsteira,
  mensagem: MensagemDaFila,
  contagens: Contagens,
): Promise<void> {
  const payload = mensagemDeJob.parse(mensagem.mensagem);
  const { cliente, logger } = contexto;

  const encerrarComRecusa = async (motivo: string, explicacao: string): Promise<void> => {
    logger.error('coleta recusada', { batch_id: payload.batch_id, motivo, explicacao });
    await marcarLote(cliente, payload.batch_id, 'falhou', { motivo }, explicacao);
    await concluir(cliente, FILAS.jobs, mensagem.msg_id, payload.chave);
  };

  const fonte = await buscarFontePorId(cliente, payload.source_id);
  if (!fonte) {
    await encerrarComRecusa('fonte_inexistente', 'A fonte saiu do catálogo entre o pedido e a coleta.');
    return;
  }
  if (!fonte.is_enabled) {
    await encerrarComRecusa(
      'fonte_desligada',
      `A fonte "${fonte.name}" está desligada no catálogo do Radar. Ligar exige robots.txt e termos avaliados (RF-RAD-01).`,
    );
    return;
  }
  if (!fonte.coletor.ligado) {
    await encerrarComRecusa(
      'coletor_desligado',
      `A fonte "${fonte.name}" não tem coletor liberado (config.collector.enabled = false).`,
    );
    return;
  }
  const adaptador = ADAPTADORES[fonte.slug];
  if (!adaptador) {
    await encerrarComRecusa(
      'sem_adaptador',
      `Ainda não existe adaptador de coleta para "${fonte.name}". A fonte é lida à mão até que exista.`,
    );
    return;
  }
  if (!fonte.base_url) {
    await encerrarComRecusa('sem_base_url', `A fonte "${fonte.name}" não tem endereço base cadastrado.`);
    return;
  }

  const catalogo = fonte.coletor.catalogo.filter(
    (entrada) => !payload.categorias || payload.categorias.includes(entrada.categoria_origem),
  );
  if (catalogo.length === 0) {
    await encerrarComRecusa(
      'catalogo_vazio',
      payload.categorias
        ? `Nenhuma das categorias pedidas (${payload.categorias.join(', ')}) existe no catálogo de "${fonte.name}".`
        : `A fonte "${fonte.name}" não tem catálogo de coleta configurado.`,
    );
    return;
  }

  // A portaria antes de tudo. Se o robots.txt não puder ser lido, o host inteiro
  // fica proibido e a coleta para aqui — sem tentar outro caminho.
  const raiz = await contexto.portaria.avaliar(new URL('/', fonte.base_url).toString());
  if (!raiz.permitido) {
    contagens.bloqueadas_pelo_robots += 1;
    await encerrarComRecusa('robots_proibe', raiz.explicacao);
    return;
  }

  const enfileiradas: string[] = [];
  const bloqueadas: string[] = [];

  for (const entrada of catalogo) {
    const url = new URL(entrada.caminho, fonte.base_url).toString();
    const veredito = await contexto.portaria.avaliar(url);
    if (!veredito.permitido) {
      bloqueadas.push(entrada.categoria_origem);
      contagens.bloqueadas_pelo_robots += 1;
      logger.warn('página de listagem proibida pelo robots.txt', {
        url,
        explicacao: veredito.explicacao,
      });
      continue;
    }

    const chave = chaveDaPagina(payload.batch_id, url);
    const resposta = await enfileirar(
      cliente,
      FILAS.paginas,
      {
        chave,
        batch_id: payload.batch_id,
        source_id: fonte.id,
        url,
        categoria_origem: entrada.categoria_origem,
        pagina: 1,
        max_paginas: payload.max_paginas,
      },
      chave,
      payload.batch_id,
    );
    if (resposta.enfileirado) enfileiradas.push(url);
  }

  if (enfileiradas.length === 0) {
    await encerrarComRecusa(
      'tudo_bloqueado',
      `Nenhuma das ${catalogo.length} listagens de "${fonte.name}" pôde ser enfileirada: ${bloqueadas.length} proibidas pelo robots.txt e o resto já estava na fila.`,
    );
    return;
  }

  await marcarLote(cliente, payload.batch_id, 'rodando', {
    listagens_enfileiradas: enfileiradas.length,
    listagens_bloqueadas: bloqueadas,
    agente: contexto.agente,
    intervalo_segundos: fonte.rate_limit_seconds,
    coletor: tipoDoColetor(fonte),
  });
  await concluir(cliente, FILAS.jobs, mensagem.msg_id, payload.chave);
  contagens.jobs += 1;

  logger.info('coleta planejada', {
    batch_id: payload.batch_id,
    fonte: fonte.slug,
    listagens: enfileiradas.length,
    bloqueadas: bloqueadas.length,
  });
}

// ---------------------------------------------------------------------------
// Etapa 2 — ingest_pages: buscar uma listagem e gravar as capturas
// ---------------------------------------------------------------------------

async function tratarPagina(
  contexto: ContextoDaEsteira,
  mensagem: MensagemDaFila,
  contagens: Contagens,
): Promise<void> {
  const payload = mensagemDePagina.parse(mensagem.mensagem);
  const { cliente, logger } = contexto;

  const fonte = await buscarFontePorId(cliente, payload.source_id);
  const adaptador = fonte ? ADAPTADORES[fonte.slug] : undefined;
  if (!fonte || !adaptador || !fonte.is_enabled || !fonte.coletor.ligado) {
    logger.error('página descartada: a fonte não coleta mais', {
      url: payload.url,
      source_id: payload.source_id,
    });
    await concluir(cliente, FILAS.paginas, mensagem.msg_id, payload.chave);
    return;
  }

  const veredito = await contexto.portaria.avaliar(payload.url);
  if (!veredito.permitido) {
    contagens.bloqueadas_pelo_robots += 1;
    logger.warn('página não buscada: o robots.txt proíbe', {
      url: payload.url,
      explicacao: veredito.explicacao,
    });
    await concluir(cliente, FILAS.paginas, mensagem.msg_id, payload.chave);
    return;
  }

  // O intervalo é o maior entre o que a fonte pede no robots (`Crawl-delay`) e o
  // que o catálogo do CRM define. Nunca o menor.
  const intervalo = Math.max(fonte.rate_limit_seconds, veredito.atrasoSegundos ?? 0);
  const esperou = await contexto.acelerador.aguardarAVez(hostDaUrl(payload.url), intervalo);

  const { paginas, falhas } = await buscarPaginas({
    urls: [payload.url],
    tipo: tipoDoColetor(fonte),
    agente: fonte.coletor.agente ?? contexto.agente,
    atrasoSegundos: intervalo,
    logger,
  });

  const pagina = paginas.get(payload.url);
  if (!pagina) {
    // Transitório até prova em contrário: volta para a fila com backoff.
    throw new Error(falhas.get(payload.url) ?? 'a página não voltou e não disse por quê');
  }

  const extraido = adaptador.extrairListagem(pagina.html, {
    url: pagina.url,
    categoriaOrigem: payload.categoria_origem,
  });

  let novas = 0;
  let repetidas = 0;

  for (const registro of extraido.registros) {
    const { payload: limpo, descartados, proibidos } = filtrarPelaWhitelist(registro.bruto);
    if (proibidos.length > 0) {
      logger.error('a fonte trouxe campo proibido: descartado antes de sair da máquina', {
        url: registro.sourceUrl,
        campos: proibidos,
      });
    } else if (descartados.length > 0) {
      logger.debug('campos fora da whitelist descartados', {
        url: registro.sourceUrl,
        campos: descartados,
      });
    }
    if (!payloadTemIdentidade(limpo)) continue;

    const gravada = await gravarCaptura(cliente, {
      loteId: payload.batch_id,
      fonteId: fonte.id,
      payload: limpo,
      externalId: registro.externalId,
      sourceUrl: registro.sourceUrl,
      httpStatus: pagina.status,
      coletor: fonte.coletor.agente ?? contexto.agente,
    });

    if (!gravada.ok) {
      logger.error('captura recusada pelo banco', {
        url: registro.sourceUrl,
        motivo: gravada.reason,
      });
      continue;
    }

    if (gravada.novo) novas += 1;
    else repetidas += 1;

    // Nova ou repetida, a captura vai para a fila de registros: é lá que o
    // `last_seen_at` do `source_record` é atualizado, e "visto de novo hoje" é
    // informação, não repetição inútil. A resolução é idempotente do lado do
    // banco — conteúdo idêntico só carimba a data e nem toca no candidato.
    const chave = chaveDoRegistro(payload.batch_id, gravada.raw_capture_id);
    await enfileirar(
      cliente,
      FILAS.registros,
      { chave, batch_id: payload.batch_id, raw_capture_id: gravada.raw_capture_id },
      chave,
      payload.batch_id,
    );
  }

  contagens.capturas_novas += novas;
  contagens.capturas_repetidas += repetidas;
  contagens.paginas += 1;

  // Paginação: só a que a própria página declarou, e só até o teto do lote.
  if (extraido.proximaUrl && payload.pagina < payload.max_paginas) {
    const proximaPermitida = await contexto.portaria.avaliar(extraido.proximaUrl);
    if (proximaPermitida.permitido) {
      const chave = chaveDaPagina(payload.batch_id, extraido.proximaUrl);
      await enfileirar(
        cliente,
        FILAS.paginas,
        {
          chave,
          batch_id: payload.batch_id,
          source_id: fonte.id,
          url: extraido.proximaUrl,
          categoria_origem: payload.categoria_origem,
          pagina: payload.pagina + 1,
          max_paginas: payload.max_paginas,
        },
        chave,
        payload.batch_id,
      );
    } else {
      contagens.bloqueadas_pelo_robots += 1;
      logger.warn('próxima página proibida pelo robots.txt', {
        url: extraido.proximaUrl,
        explicacao: proximaPermitida.explicacao,
      });
    }
  }

  await concluir(cliente, FILAS.paginas, mensagem.msg_id, payload.chave);

  logger.info('listagem coletada', {
    url: payload.url,
    categoria_origem: payload.categoria_origem,
    pagina: payload.pagina,
    status: pagina.status,
    encontrados: extraido.registros.length,
    esperou_ms: esperou,
    capturas_novas: novas,
    capturas_repetidas: repetidas,
    tem_proxima: Boolean(extraido.proximaUrl),
  });
}

// ---------------------------------------------------------------------------
// Etapa 3 — ingest_records: captura → registro normalizado → candidato
// ---------------------------------------------------------------------------

async function tratarRegistro(
  contexto: ContextoDaEsteira,
  mensagem: MensagemDaFila,
  contagens: Contagens,
): Promise<void> {
  const payload = mensagemDeRegistro.parse(mensagem.mensagem);
  const { cliente, logger } = contexto;

  const resposta = await processarCaptura(cliente, payload.raw_capture_id);
  if (!resposta.ok) {
    if (resposta.reason === 'captura_inexistente' || resposta.reason === 'sem_identidade_na_fonte') {
      // Determinístico: reprocessar não vai criar a identidade que a fonte não deu.
      logger.warn('captura sem como virar registro', {
        raw_capture_id: payload.raw_capture_id,
        motivo: resposta.reason,
      });
      await concluir(cliente, FILAS.registros, mensagem.msg_id, payload.chave);
      return;
    }
    throw new Error(`a resolução recusou a captura: ${resposta.reason}`);
  }

  contagens.registros_resolvidos += 1;
  if (resposta.criado === true) contagens.candidatos_novos += 1;

  await concluir(cliente, FILAS.registros, mensagem.msg_id, payload.chave);
  logger.debug('captura resolvida', {
    raw_capture_id: payload.raw_capture_id,
    mudou: resposta.mudou,
    candidato_novo: resposta.criado === true,
  });
}

// ---------------------------------------------------------------------------
// O consumo de uma fila
// ---------------------------------------------------------------------------

type Tratador = (
  contexto: ContextoDaEsteira,
  mensagem: MensagemDaFila,
  contagens: Contagens,
) => Promise<void>;

const TRATADORES: Record<'jobs' | 'paginas' | 'registros', { fila: NomeDaFila; tratar: Tratador }> =
  {
    jobs: { fila: FILAS.jobs, tratar: tratarJob },
    paginas: { fila: FILAS.paginas, tratar: tratarPagina },
    registros: { fila: FILAS.registros, tratar: tratarRegistro },
  };

/** Lê a chave de idempotência de uma mensagem que talvez esteja malformada. */
function chaveDaMensagem(mensagem: MensagemDaFila): string {
  const chave = mensagem.mensagem.chave;
  return typeof chave === 'string' && chave.length > 0 ? chave : `msg:${mensagem.msg_id}`;
}

/**
 * Consome até `quantidade` mensagens de uma fila. Devolve quantas foram lidas —
 * zero significa "esta fila está vazia agora", que é o sinal de parada do laço.
 */
export async function consumirFila(
  contexto: ContextoDaEsteira,
  etapa: keyof typeof TRATADORES,
  contagens: Contagens,
  quantidade = 1,
): Promise<number> {
  const { fila, tratar } = TRATADORES[etapa];
  const mensagens = await lerFila(contexto.cliente, fila, quantidade);

  for (const mensagem of mensagens) {
    try {
      await tratar(contexto, mensagem, contagens);
    } catch (erro) {
      contagens.falhas += 1;
      const texto = erro instanceof Error ? erro.message : String(erro);
      const resultado = await falhar(
        contexto.cliente,
        fila,
        mensagem.msg_id,
        chaveDaMensagem(mensagem),
        texto,
      );
      contexto.logger.error('mensagem falhou', {
        fila,
        msg_id: mensagem.msg_id,
        tentativa: resultado.tentativa,
        acao: resultado.acao,
        erro: texto,
      });
    }
  }

  return mensagens.length;
}

// ---------------------------------------------------------------------------
// Fechar o que terminou
// ---------------------------------------------------------------------------

/**
 * Um lote de coleta acabou quando não sobrou nenhuma mensagem dele por processar.
 * Quem sabe isso é `ingest_dedup`: cada mensagem enfileirada deixa lá uma linha
 * com o `batch_id`, e ela só ganha `processed_at` quando a mensagem é concluída
 * (ou vai para a dead-letter). Zero linhas pendentes = lote terminado.
 *
 * A conta é feita só quando as três filas estão vazias, e vale para qualquer
 * lote — inclusive um que outra pessoa agendou de outra máquina.
 */
export async function fecharLotesTerminados(
  contexto: ContextoDaEsteira,
): Promise<{ fechados: number }> {
  const { cliente, logger } = contexto;

  const { data, error } = await cliente
    .from('import_batches')
    .select('id, label')
    .eq('kind', 'coleta')
    .eq('status', 'rodando');
  if (error) {
    logger.warn('não deu para listar os lotes em andamento', { erro: error.message });
    return { fechados: 0 };
  }

  const lotes = (data ?? []) as { id: string; label: string }[];
  let fechados = 0;

  for (const lote of lotes) {
    const pendentes = await cliente
      .from('ingest_dedup')
      .select('idempotency_key', { count: 'exact', head: true })
      .eq('batch_id', lote.id)
      .is('processed_at', null);
    if (pendentes.error) {
      logger.warn('não deu para contar as mensagens pendentes do lote', {
        batch_id: lote.id,
        erro: pendentes.error.message,
      });
      continue;
    }
    if ((pendentes.count ?? 0) > 0) continue;

    const capturas = await cliente
      .from('raw_capture')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', lote.id);
    const registros = await cliente
      .from('source_record')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', lote.id);
    const candidatos = await cliente
      .from('supplier_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('import_batch_id', lote.id);

    await marcarLote(cliente, lote.id, 'concluido', {
      capturas: capturas.count ?? 0,
      registros: registros.count ?? 0,
      candidatos: candidatos.count ?? 0,
    });
    fechados += 1;
    logger.info('lote de coleta concluído', {
      batch_id: lote.id,
      rotulo: lote.label,
      capturas: capturas.count ?? 0,
      candidatos: candidatos.count ?? 0,
    });
  }

  return { fechados };
}
