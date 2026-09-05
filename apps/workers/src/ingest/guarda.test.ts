import { describe, expect, it } from 'vitest';

import { Acelerador, hostDaUrl } from './acelerador';
import { Portaria } from './guarda';

import type { LogFields, Logger } from '../lib/log';

function loggerMudo(): Logger {
  const nada = (_msg: string, _campos?: LogFields): void => {};
  return { debug: nada, info: nada, warn: nada, error: nada };
}

/** Um relógio de mentira, para o teste ser sobre a REGRA e não sobre a paciência. */
function relogio(): { agora: () => number; dormir: (ms: number) => Promise<void>; dormiu: number[] } {
  let t = 1_000_000;
  const dormiu: number[] = [];
  return {
    agora: () => t,
    dormir: async (ms: number) => {
      dormiu.push(ms);
      t += ms;
      await Promise.resolve();
    },
    dormiu,
  };
}

const ROBOTS = 'User-agent: *\nAllow: /\n';

function buscaFalsa(registro: string[]): typeof fetch {
  return (async (url: string | URL): Promise<Response> => {
    registro.push(String(url));
    return new Response(ROBOTS, { status: 200, headers: { 'content-type': 'text/plain' } });
  }) as unknown as typeof fetch;
}

/**
 * §3.12h do laudo — A BUSCA DO ROBOTS.TXT PASSA PELO FREIO.
 *
 * O `Acelerador` existe porque `sources.rate_limit_seconds` é um pedido da
 * FONTE (R03), e o freio do Crawlee só vale dentro de uma corrida. Só que a
 * primeira requisição que o coletor faz a um host novo **não é a página**: é o
 * `/robots.txt`, buscado pela `Portaria`. Ela não passava pelo freio, então o
 * host levava duas requisições em ~40 ms — o robots e a página logo em
 * seguida —, o que é exatamente o que o limite por fonte proíbe.
 *
 * O conserto não pode ser "frear toda avaliação": o robots é lido UMA VEZ por
 * host e depois vem do cache, e esperar o intervalo inteiro em cada consulta
 * de cache multiplicaria o tempo de coleta por nada. Por isso o freio entra
 * como um parâmetro que a `Portaria` aciona **só quando vai à rede**.
 */
describe('§3.12h — o robots.txt também respeita o intervalo da fonte', () => {
  it('a busca do robots conta como batida no host: a página seguinte espera', async () => {
    const registro: string[] = [];
    const { agora, dormir, dormiu } = relogio();
    const acelerador = new Acelerador({ agora, dormir });
    const portaria = new Portaria('TriadeBot/1.0', loggerMudo(), buscaFalsa(registro));
    const url = 'https://www.casamentos.com.br/fotografo/natal';

    await portaria.avaliar(url, (alvo) => acelerador.aguardarAVez(hostDaUrl(alvo), 4));
    expect(registro).toEqual(['https://www.casamentos.com.br/robots.txt']);

    // A página, logo depois — é o que `tratarPagina` faz. Antes do conserto
    // esta espera era ZERO: o host levava duas requisições no mesmo instante.
    const esperou = await acelerador.aguardarAVez(hostDaUrl(url), 4);
    expect(esperou).toBe(4000);
    expect(dormiu).toEqual([4000]);
  });

  it('o freio é acionado UMA vez por host: o cache não paga pedágio', async () => {
    const registro: string[] = [];
    const freiadas: string[] = [];
    const portaria = new Portaria('TriadeBot/1.0', loggerMudo(), buscaFalsa(registro));
    const freio = async (alvo: string): Promise<void> => {
      freiadas.push(alvo);
      await Promise.resolve();
    };

    await portaria.avaliar('https://www.casamentos.com.br/a', freio);
    await portaria.avaliar('https://www.casamentos.com.br/b', freio);
    await portaria.avaliar('https://www.casamentos.com.br/c', freio);

    expect(registro).toHaveLength(1);
    expect(freiadas).toEqual(['https://www.casamentos.com.br/robots.txt']);
  });

  it('host novo é um freio novo: o limite é por host, como o robots.txt', async () => {
    const registro: string[] = [];
    const freiadas: string[] = [];
    const portaria = new Portaria('TriadeBot/1.0', loggerMudo(), buscaFalsa(registro));
    const freio = async (alvo: string): Promise<void> => {
      freiadas.push(alvo);
      await Promise.resolve();
    };

    await portaria.avaliar('https://www.casamentos.com.br/a', freio);
    await portaria.avaliar('https://www.sympla.com.br/b', freio);

    expect(freiadas).toEqual([
      'https://www.casamentos.com.br/robots.txt',
      'https://www.sympla.com.br/robots.txt',
    ]);
  });

  it('sem freio, a Portaria continua funcionando — o parâmetro é opcional', async () => {
    const registro: string[] = [];
    const portaria = new Portaria('TriadeBot/1.0', loggerMudo(), buscaFalsa(registro));
    const veredito = await portaria.avaliar('https://www.casamentos.com.br/a');
    expect(veredito.permitido).toBe(true);
  });
});
