/**
 * O freio do coletor: no máximo uma requisição por host a cada N segundos.
 *
 * O `sameDomainDelaySecs` do Crawlee só vale DENTRO de uma corrida, e cada
 * mensagem da fila `ingest_pages` abre a sua própria. A primeira coleta real
 * mostrou isso: quatro listagens do Casamentos.com.br saíram em 4 segundos, com
 * `sources.rate_limit_seconds = 4` — ou seja, quatro vezes mais rápido do que o
 * catálogo manda, e o Crawlee sem culpa nenhuma, porque para ele cada corrida era
 * a primeira. O freio precisa viver no worker, que é quem atravessa as mensagens.
 *
 * O relógio e o sono entram por parâmetro para o teste não precisar esperar de
 * verdade — e para que o teste seja sobre a REGRA, não sobre a paciência de quem
 * roda a suíte.
 */

export interface OpcoesDoAcelerador {
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

// Sem `unref()`: este sono é trabalho, não pano de fundo. Um timer com `unref()`
// não segura o laço de eventos, e o Node encerra o processo no meio da espera —
// foi exatamente o que aconteceu na primeira corrida com freio: a coleta parou
// depois da primeira listagem, calada, porque o processo simplesmente acabou.
const dormirDeVerdade = (ms: number): Promise<void> =>
  new Promise((resolva) => {
    setTimeout(resolva, ms);
  });

export class Acelerador {
  private readonly ultimaBatida = new Map<string, number>();
  private readonly agora: () => number;
  private readonly dormir: (ms: number) => Promise<void>;

  constructor(opcoes: OpcoesDoAcelerador = {}) {
    this.agora = opcoes.agora ?? Date.now;
    this.dormir = opcoes.dormir ?? dormirDeVerdade;
  }

  /**
   * Segura a vez até o host poder ser batido de novo e marca a batida. Devolve
   * quantos milissegundos esperou — o número que vai para o log, para que
   * "a coleta está lenta" possa ser respondido com "está no ritmo pedido".
   */
  async aguardarAVez(host: string, intervaloSegundos: number): Promise<number> {
    const intervalo = Math.max(intervaloSegundos, 0) * 1000;
    const ultima = this.ultimaBatida.get(host);
    const agora = this.agora();

    let espera = 0;
    if (ultima !== undefined && intervalo > 0) {
      espera = Math.max(0, ultima + intervalo - agora);
      if (espera > 0) await this.dormir(espera);
    }

    this.ultimaBatida.set(host, this.agora());
    return espera;
  }
}

/** O host de uma URL, que é a unidade do limite (o robots.txt também é por host). */
export function hostDaUrl(url: string): string {
  return new URL(url).host;
}
