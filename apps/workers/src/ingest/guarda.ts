/**
 * A portaria: o robots.txt de cada host, buscado uma vez por corrida e consultado
 * antes de QUALQUER requisição.
 *
 * Como a RFC 9309 manda tratar a busca do próprio robots.txt:
 *  - 2xx: vale o arquivo;
 *  - 4xx (não existe, não autorizado): não há regra, o host libera;
 *  - 5xx, tempo esgotado, rede caída: o host está INALCANÇÁVEL, e inalcançável
 *    significa PROIBIDO TUDO. É o único jeito honesto: sem o arquivo não dá para
 *    saber o que a fonte permite, e "não sei" não pode virar "então vou".
 *
 * Nada aqui tem caminho alternativo. Não existe opção de ignorar, não existe
 * lista de exceções e não existe segundo user-agent. Se a fonte barrar, o coletor
 * para e relata (CLAUDE.md).
 *
 * ## A busca do robots.txt também é uma requisição (laudo §3.12h)
 *
 * Ela conta para o limite por host, e até 05/09/2026 não contava: a portaria ia
 * à rede por fora do `Acelerador`, e o host levava o `/robots.txt` e a página
 * logo em seguida — duas requisições em ~40 ms com `rate_limit_seconds = 4`.
 * Agora quem chama empresta o freio (`FreioDaPortaria`), e ele é acionado só na
 * ida à rede — o cache não paga pedágio.
 */
import { analisarRobots, avaliarCaminho, caminhoDaUrl, type Veredito } from './robots';

import type { Logger } from '../lib/log';

/**
 * O freio, emprestado por quem chama.
 *
 * A `Portaria` não tem `Acelerador` próprio de propósito: o limite é por HOST e
 * precisa ser o MESMO contador da busca das páginas — dois aceleradores lado a
 * lado seriam dois relógios, e dois relógios não somam. Quem tem o acelerador
 * (a esteira) empresta uma função que segura a vez.
 *
 * É acionado só quando a portaria vai à REDE. O robots.txt de um host é lido
 * uma vez por corrida e depois vem do cache: cobrar o intervalo em cada
 * consulta de cache multiplicaria o tempo de coleta sem proteger ninguém.
 */
export type FreioDaPortaria = (url: string) => Promise<unknown>;

export interface VereditoDaPortaria {
  permitido: boolean;
  /** Frase em português, pronta para o log, para `import_batches.error` e para a tela. */
  explicacao: string;
  /** Piso de intervalo pedido pela própria fonte, quando ela declara `Crawl-delay`. */
  atrasoSegundos: number | null;
}

interface EntradaDoCache {
  avaliar: (url: string) => Veredito;
  atrasoSegundos: number | null;
}

export class Portaria {
  private readonly cache = new Map<string, EntradaDoCache>();

  constructor(
    private readonly agente: string,
    private readonly logger: Logger,
    private readonly buscar: typeof fetch = fetch,
  ) {}

  private async carregar(origem: string, freio?: FreioDaPortaria): Promise<EntradaDoCache> {
    const emCache = this.cache.get(origem);
    if (emCache) return emCache;

    const alvo = `${origem}/robots.txt`;
    let entrada: EntradaDoCache;

    // (laudo §3.12h) A PRIMEIRA requisição que este worker faz a um host novo
    // não é a página — é este arquivo. Sem passar pelo freio, o host levava
    // duas requisições em ~40 ms, e o limite por fonte do R03 é um pedido da
    // FONTE, não uma preferência nossa. O freio vem por parâmetro para ser o
    // mesmo contador que a busca das páginas usa.
    if (freio !== undefined) await freio(alvo);

    try {
      const resposta = await this.buscar(alvo, {
        headers: { 'user-agent': this.agente, accept: 'text/plain' },
        signal: AbortSignal.timeout(15_000),
      });

      if (resposta.status >= 500) {
        this.logger.warn('robots.txt inalcançável: o host fica proibido por inteiro', {
          origem,
          status: resposta.status,
        });
        entrada = {
          avaliar: () => ({
            permitido: false,
            motivo: 'proibido_por_regra',
            regra: `robots.txt respondeu ${resposta.status}`,
            grupo: this.agente,
          }),
          atrasoSegundos: null,
        };
      } else if (!resposta.ok) {
        this.logger.info('robots.txt não existe nesta fonte: sem regra para respeitar', {
          origem,
          status: resposta.status,
        });
        entrada = { avaliar: () => ({ permitido: true, motivo: 'sem_regra' }), atrasoSegundos: null };
      } else {
        const arquivo = analisarRobots(await resposta.text());
        const grupo = arquivo.grupos.find((g) =>
          g.agentes.some((a) => a === '*' || this.agente.toLowerCase().startsWith(a)),
        );
        entrada = {
          avaliar: (url) => avaliarCaminho(arquivo, this.agente, caminhoDaUrl(url)),
          atrasoSegundos: grupo?.atrasoSegundos ?? null,
        };
        this.logger.info('robots.txt lido', {
          origem,
          grupos: arquivo.grupos.length,
          agente: this.agente,
        });
      }
    } catch (erro) {
      const texto = erro instanceof Error ? erro.message : String(erro);
      this.logger.warn('robots.txt não pôde ser buscado: o host fica proibido por inteiro', {
        origem,
        erro: texto,
      });
      entrada = {
        avaliar: () => ({
          permitido: false,
          motivo: 'proibido_por_regra',
          regra: `robots.txt não pôde ser buscado (${texto})`,
          grupo: this.agente,
        }),
        atrasoSegundos: null,
      };
    }

    this.cache.set(origem, entrada);
    return entrada;
  }

  async avaliar(url: string, freio?: FreioDaPortaria): Promise<VereditoDaPortaria> {
    const origem = new URL(url).origin;
    const entrada = await this.carregar(origem, freio);
    const veredito = entrada.avaliar(url);

    if (!veredito.permitido) {
      return {
        permitido: false,
        explicacao: `O robots.txt de ${origem} proíbe esta página para o agente "${veredito.grupo}" (${veredito.regra}). A coleta parou aqui, e não há caminho alternativo.`,
        atrasoSegundos: entrada.atrasoSegundos,
      };
    }

    return {
      permitido: true,
      explicacao:
        veredito.motivo === 'sem_regra'
          ? `O robots.txt de ${origem} não tem regra para esta página.`
          : `O robots.txt de ${origem} libera esta página (${veredito.regra ?? 'sem regra específica'}).`,
      atrasoSegundos: entrada.atrasoSegundos,
    };
  }
}
