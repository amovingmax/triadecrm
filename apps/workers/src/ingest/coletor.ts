/**
 * A busca da página, com Crawlee (decisão do PRD §9 / CLAUDE.md).
 *
 * O Crawlee entra aqui pelo que ele resolve bem e que ninguém quer reescrever:
 * fila interna de requisições, `sameDomainDelaySecs` (o limite por fonte, do
 * `sources.rate_limit_seconds`), sessões, repetição de falha transitória e
 * `respectRobotsTxtFile`. Duas coisas ficam DE FORA dele de propósito:
 *
 *  - a persistência: `persistStorage = false`, e cada corrida abre a própria
 *    `RequestQueue` em memória. Sem isso o Crawlee guardaria em disco a fila
 *    entre corridas e pularia como "já visitada" uma URL que a nossa fila `pgmq`
 *    mandou buscar de novo — dois donos para a mesma decisão, e o errado ganhando.
 *  - o user-agent: `useHeaderGenerator = false` e um cabeçalho nosso, honesto.
 *    O Crawlee, por padrão, gera cabeçalhos de navegador real. Isso é exatamente
 *    "trocar o user-agent para disfarçar", que o CLAUDE.md proíbe. O coletor se
 *    apresenta como KomuneBot, com URL de contato, e aceita a resposta que vier.
 *
 * Duas famílias de fonte, um contrato: `http` usa `CheerioCrawler` (o
 * Casamentos.com.br é HTML renderizado no servidor — R03 §2.1) e `playwright`
 * usa `PlaywrightCrawler`, para as fontes que só existem depois do JavaScript
 * (Sympla, OLX). As duas devolvem HTML e status; quem interpreta é o adaptador.
 */
import {
  CheerioCrawler,
  Configuration,
  LogLevel,
  PlaywrightCrawler,
  RequestQueue,
  log as logCrawlee,
} from 'crawlee';

import type { Logger } from '../lib/log';

export type TipoDeColetor = 'http' | 'playwright';

export interface PaginaBuscada {
  url: string;
  status: number;
  html: string;
}

export interface ResultadoDaBusca {
  paginas: Map<string, PaginaBuscada>;
  /** URL → motivo, em texto. O que não veio precisa dizer por que não veio. */
  falhas: Map<string, string>;
}

export interface OpcoesDaBusca {
  urls: string[];
  tipo: TipoDeColetor;
  agente: string;
  /** `sources.rate_limit_seconds`: no mínimo este intervalo entre duas batidas no mesmo domínio. */
  atrasoSegundos: number;
  logger: Logger;
}

let configurado = false;

/** Uma vez por processo: nada em disco, e o log do Crawlee sem tagarelice. */
function configurarCrawlee(): void {
  if (configurado) return;
  Configuration.getGlobalConfig().set('persistStorage', false);
  logCrawlee.setLevel(LogLevel.WARNING);
  configurado = true;
}

let contadorDeCorridas = 0;

export async function buscarPaginas(opcoes: OpcoesDaBusca): Promise<ResultadoDaBusca> {
  const paginas = new Map<string, PaginaBuscada>();
  const falhas = new Map<string, string>();
  if (opcoes.urls.length === 0) return { paginas, falhas };

  configurarCrawlee();
  contadorDeCorridas += 1;
  const fila = await RequestQueue.open(`coleta-${process.pid}-${contadorDeCorridas}`);

  const comum = {
    requestQueue: fila,
    maxConcurrency: 1,
    minConcurrency: 1,
    // O intervalo da fonte é lei; o Crawlee o aplica por domínio.
    sameDomainDelaySecs: Math.max(opcoes.atrasoSegundos, 0),
    // Falha transitória (rede caindo) o Crawlee repete; falha de verdade volta
    // para a nossa fila, que tem o backoff longo e a dead-letter.
    maxRequestRetries: 2,
    requestHandlerTimeoutSecs: 60,
    respectRobotsTxtFile: true,
    maxRequestsPerCrawl: opcoes.urls.length + 1,
  };

  const anotarFalha = (url: string, erro: unknown): void => {
    const texto = erro instanceof Error ? erro.message : String(erro);
    falhas.set(url, texto);
    opcoes.logger.warn('página não veio', { url, erro: texto });
  };

  if (opcoes.tipo === 'playwright') {
    const crawler = new PlaywrightCrawler({
      ...comum,
      launchContext: { launchOptions: { args: [`--user-agent=${opcoes.agente}`] } },
      async requestHandler({ request, page, response }) {
        paginas.set(request.url, {
          url: request.loadedUrl ?? request.url,
          status: response?.status() ?? 0,
          html: await page.content(),
        });
      },
      failedRequestHandler({ request }, erro) {
        anotarFalha(request.url, erro);
      },
    });
    await crawler.run(opcoes.urls);
  } else {
    const crawler = new CheerioCrawler({
      ...comum,
      preNavigationHooks: [
        (_contexto, opcoesDoGot) => {
          // Cabeçalho honesto, sem o gerador de "parecer navegador".
          opcoesDoGot.useHeaderGenerator = false;
          opcoesDoGot.headers = {
            ...opcoesDoGot.headers,
            'user-agent': opcoes.agente,
            'accept-language': 'pt-BR,pt;q=0.9',
          };
        },
      ],
      async requestHandler({ request, body, response }) {
        paginas.set(request.url, {
          url: request.loadedUrl ?? request.url,
          status: response.statusCode ?? 0,
          html: typeof body === 'string' ? body : body.toString('utf-8'),
        });
        await Promise.resolve();
      },
      failedRequestHandler({ request }, erro) {
        anotarFalha(request.url, erro);
      },
    });
    await crawler.run(opcoes.urls);
  }

  await fila.drop();

  // O Crawlee pula em silêncio a URL que o robots.txt proíbe. Silêncio aqui é o
  // pior resultado possível, então o que não voltou nem como página nem como
  // falha vira falha nomeada — e alguém lê.
  for (const url of opcoes.urls) {
    if (!paginas.has(url) && !falhas.has(url)) {
      falhas.set(url, 'a requisição não foi executada (robots.txt do Crawlee ou limite da corrida)');
    }
  }

  return { paginas, falhas };
}
