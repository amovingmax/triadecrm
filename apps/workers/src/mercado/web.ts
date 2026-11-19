/**
 * Acesso educado às fontes da inteligência de mercado (só as PERMITIDAS da
 * tabela `mercado_fontes`). Porte de `coletar/anuncios/_web.mjs` e de
 * `coletar/comum.mjs` do protótipo (~/Documents/imova-mercado-premium-2026-11-17).
 *
 * O que este arquivo garante para TODO coletor, e que nenhum coletor consegue
 * desligar:
 *
 *  - identificação honesta e genérica (`identidade.ts`): diz que é um robô de
 *    dados públicos; nunca "Mozilla/5.0", nunca outro robô, nunca o nome da
 *    Imova; sem cookie, sem login, sem formulário;
 *  - só os endereços da fonte: o host do `url` da fonte na lista e os que o
 *    coletor declarou (o Banco Central responde por dois hosts). Qualquer outro
 *    host é recusado antes de sair o pedido; um domínio bloqueado (Grupo OLX e
 *    parecidos, `bloqueio.ts`) é recusado sempre;
 *  - redirecionamento seguido À MÃO (`redirect: 'manual'`, até 5 saltos): a
 *    cada `Location`, o destino passa pelas mesmas travas ANTES do pedido
 *    (host da fonte, domínio bloqueado, robots.txt do host de destino, teto e
 *    prazo). Um site permitido que mande para um portal proibido não faz sair
 *    pedido nenhum para o portal. Vale também para o próprio robots.txt;
 *  - robots.txt lido NO COMEÇO DE CADA RODADA, por host (RFC 9309). 404/410 =
 *    sem regra; erro de rede, 5xx, 401/403 ou robots que vem como HTML = a
 *    fonte para (não dá para saber a regra, então não se pede nada); caminho
 *    fechado = a página não é pedida; o Crawl-delay vale se for maior que o
 *    intervalo da fonte;
 *  - ritmo: um pedido por vez por host, com o intervalo mínimo da fonte medido
 *    do FIM de um pedido ao começo do seguinte; teto de pedidos por rodada;
 *    prazo da rodada;
 *  - 429 e 403 param o host na hora, sem nova tentativa: quem pediu para
 *    parar, parou. Erro de rede e 5xx têm até 2 novas tentativas, no mesmo
 *    ritmo;
 *  - cada resposta leva a impressão digital (sha256) dos bytes, para o
 *    contrato V0.
 */
import { createHash } from 'node:crypto';

import { hostBloqueado, hostDe } from './bloqueio';

export const sha256 = (conteudo: string | Uint8Array): string =>
  createHash('sha256').update(conteudo).digest('hex');

const pausaReal = (ms: number): Promise<void> =>
  new Promise((resolva) => {
    setTimeout(resolva, ms);
  });

// ---------------------------------------------------------------------------
// robots.txt (RFC 9309)
// ---------------------------------------------------------------------------

export interface RegraDoRobots {
  permite: boolean;
  caminho: string;
}

export interface Robots {
  regras: RegraDoRobots[];
  /** Crawl-delay, em segundos, do grupo que vale para nós (o maior). */
  atraso: number | null;
  /** O grupo usado: o nosso nome, ou "*". */
  grupo: string;
}

/** Lê o texto do robots.txt e devolve as regras que valem para o nosso robô (grupo com o nosso nome, senão "*"). */
export function lerRobots(texto: string, tokenDoRobo: string): Robots {
  type Grupo = { agentes: string[]; regras: RegraDoRobots[]; atraso: number | null };
  const grupos: Grupo[] = [];
  let atual: Grupo | null = null;
  let ultimoFoiAgente = false;
  for (const bruta of String(texto).split(/\r?\n/)) {
    const linha = bruta.replace(/#.*$/, '').trim();
    if (!linha) continue;
    const m = linha.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const campo = (m[1] ?? '').toLowerCase();
    const valor = (m[2] ?? '').trim();
    if (campo === 'user-agent') {
      if (!ultimoFoiAgente || !atual) {
        atual = { agentes: [], regras: [], atraso: null };
        grupos.push(atual);
      }
      atual.agentes.push(valor.toLowerCase());
      ultimoFoiAgente = true;
      continue;
    }
    ultimoFoiAgente = false;
    if (!atual) continue;
    if (campo === 'allow' || campo === 'disallow') {
      // "Disallow:" vazio libera tudo; guardamos como allow de caminho vazio (não casa nada).
      atual.regras.push({ permite: campo === 'allow' || valor === '', caminho: valor });
    } else if (campo === 'crawl-delay') {
      const n = Number.parseFloat(valor);
      if (Number.isFinite(n) && n >= 0) atual.atraso = n;
    }
  }
  const token = tokenDoRobo.toLowerCase();
  const nossos = grupos.filter((g) =>
    g.agentes.some((a) => a !== '*' && a !== '' && token.startsWith(a)),
  );
  const usados = nossos.length > 0 ? nossos : grupos.filter((g) => g.agentes.includes('*'));
  const atrasos = usados.map((g) => g.atraso).filter((x): x is number => x !== null);
  return {
    regras: usados.flatMap((g) => g.regras),
    atraso: atrasos.length > 0 ? Math.max(...atrasos) : null,
    grupo: nossos.length > 0 ? token : '*',
  };
}

function casa(padrao: string, caminho: string): boolean {
  if (padrao === '') return false;
  const fim = padrao.endsWith('$');
  const p = fim ? padrao.slice(0, -1) : padrao;
  const corpo = p
    .split('*')
    .map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${corpo}${fim ? '$' : ''}`).test(caminho);
}

/** true se o robots deixa pedir o endereço (a regra mais longa vence; empate: allow). */
export function permitidoPeloRobots(robots: Robots, url: string): boolean {
  const u = new URL(url);
  let caminho: string;
  try {
    caminho = decodeURIComponent(u.pathname) + (u.search || '');
  } catch {
    caminho = u.pathname + (u.search || '');
  }
  let melhor: { tam: number; permite: boolean } | null = null;
  for (const r of robots.regras) {
    if (!casa(r.caminho, caminho)) continue;
    const tam = r.caminho.replace(/\*/g, '').length;
    if (!melhor || tam > melhor.tam || (tam === melhor.tam && r.permite)) {
      melhor = { tam, permite: r.permite };
    }
  }
  return melhor ? melhor.permite : true;
}

// ---------------------------------------------------------------------------
// O cliente educado de uma fonte
// ---------------------------------------------------------------------------

export interface RespostaDaPagina {
  url: string;
  status: number;
  /** Os bytes da resposta (só em 2xx). */
  bytes: Buffer | null;
  /** O texto já decodificado no charset certo (só em 2xx e quando não é binário). */
  texto: string | null;
  sha256: string | null;
  tipo: string | null;
  cabecalhos: Record<string, string>;
  coletadoEm: string;
  erro?: string;
}

export interface PedidoDaPagina {
  metodo?: 'GET' | 'POST';
  corpo?: string;
  cabecalhos?: Record<string, string>;
  aceitar?: string;
  binario?: boolean;
  /** Tempo máximo do pedido, em ms (padrão 60 s). */
  tempo?: number;
  /** Novas tentativas em erro de rede e 5xx (padrão 2). */
  tentativas?: number;
}

export interface OpcoesDoNavegador {
  /** O `url` da fonte na lista: o host dele é o único liberado, além dos extras. */
  urlDaFonte: string | null;
  /** Hosts a mais que o coletor declara (ex.: api.bcb.gov.br). */
  hostsExtras?: readonly string[];
  /** Intervalo mínimo entre dois pedidos ao mesmo host, em ms. */
  intervaloMs: number;
  /** Teto de pedidos por rodada (somando todos os hosts e o robots.txt). */
  maxPedidos: number;
  /** Até quando a rodada pode pedir (epoch ms). */
  prazo: number;
  userAgent: string;
  tokenDoRobo: string;
  fetchImpl?: typeof fetch;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  /** Domínio a mais que a régua do banco bloqueia (`fontes_bloqueadas`). */
  rotulosBloqueados?: readonly string[];
  /**
   * Desde quando (AAAA-MM-DD) o robots.txt de cada origem está ilegível por
   * erro do servidor, vindo das rodadas anteriores. RFC 9309 §2.3.1.4: 5xx ou
   * rede = tudo fechado; ilegível por 30 dias seguidos, o robô PODE tratar como
   * "sem robots" (4xx). Sem isso, a regra estrita vale sempre.
   */
  robotsIlegivelDesde?: Readonly<Record<string, string>>;
  /** Hoje (AAAA-MM-DD, Fortaleza), para a conta dos 30 dias. */
  hoje?: string;
}

type EstadoDoHost = {
  origem: string;
  robots: Robots | null;
  robotsTexto: string | null;
  robotsStatus: number | null;
  ultima: number;
  intervaloMs: number;
  parado: string | null;
};

const semWww = (host: string): string => host.toLowerCase().replace(/^www\./, '');

/** Quantos redirecionamentos seguidos o robô aceita (RFC 9309 §2.3.1.2 pede ao menos 5 no robots.txt). */
export const MAX_SALTOS = 5;
const REDIRECIONAMENTOS = new Set([301, 302, 303, 307, 308]);

/** Resultado de um pedido seguido à mão: a resposta final, ou o motivo de não ter seguido. */
type Seguido =
  | { tipo: 'resposta'; r: Response; url: string; host: EstadoDoHost }
  | { tipo: 'recusado'; url: string; status: number; motivo: string }
  | { tipo: 'parou' };

/** Descarta o corpo de uma resposta que não vai ser lida (libera a conexão). */
async function descartar(r: Response): Promise<void> {
  try {
    await r.body?.cancel();
  } catch {
    // nada: o corpo já foi fechado
  }
}

/** O próximo pedido depois de um redirecionamento (303, e 301/302 depois de POST, viram GET sem corpo). */
function pedidoDoSalto(status: number, p: PedidoDaPagina): PedidoDaPagina {
  const post = (p.metodo ?? 'GET') === 'POST';
  if (status === 303 || (post && (status === 301 || status === 302))) {
    const { corpo: _corpo, ...resto } = p;
    return { ...resto, metodo: 'GET' };
  }
  return p;
}

/**
 * Um navegador por fonte e por rodada. Guarda o robots, o relógio e a parada
 * de cada host, e o total de pedidos da rodada.
 */
export class Navegador {
  readonly hostsLiberados: Set<string>;
  pedidos = 0;
  /** Endereços que o robots fechou (contados para o relatório). */
  readonly fechadosPeloRobots: string[] = [];
  private readonly hosts = new Map<string, EstadoDoHost>();
  private readonly fetchImpl: typeof fetch;
  private readonly agora: () => number;
  private readonly dormir: (ms: number) => Promise<void>;
  private paradaGeral: string | null = null;
  /** O que vai para a próxima rodada: origem → desde quando o robots está ilegível. */
  readonly robotsIlegivel: Record<string, string> = {};

  constructor(private readonly o: OpcoesDoNavegador) {
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.agora = o.agora ?? Date.now;
    this.dormir = o.dormir ?? pausaReal;
    const liberados = new Set<string>();
    if (o.urlDaFonte && /^https?:\/\//i.test(o.urlDaFonte))
      liberados.add(semWww(hostDe(o.urlDaFonte)));
    for (const h of o.hostsExtras ?? []) liberados.add(semWww(h));
    this.hostsLiberados = liberados;
  }

  /** Por que parou (o primeiro host que parou, ou o teto ou o prazo), ou null. */
  get parada(): string | null {
    if (this.paradaGeral) return this.paradaGeral;
    for (const h of this.hosts.values()) if (h.parado) return `${h.origem}: ${h.parado}`;
    return null;
  }

  /** O robots.txt lido em cada host nesta rodada (para guardar a impressão digital). */
  robotsLidos(): Array<{
    origem: string;
    status: number | null;
    sha256: string | null;
    grupo: string | null;
  }> {
    return [...this.hosts.values()].map((h) => ({
      origem: h.origem,
      status: h.robotsStatus,
      sha256: h.robotsTexto !== null ? sha256(h.robotsTexto) : null,
      grupo: h.robots?.grupo ?? null,
    }));
  }

  /** Motivo de recusa do endereço, ou null se ele pode ser pedido (antes do robots). */
  motivoDeRecusa(url: string): string | null {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return 'endereço inválido';
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'só http e https';
    if (u.username || u.password) return 'endereço com login';
    // Sem o nome do host: este texto vai para o relatório da coleta no banco, e
    // nenhum nome de portal da lista de bloqueio é guardado (decisão do dono).
    if (hostBloqueado(u.host, this.o.rotulosBloqueados))
      return 'domínio bloqueado (lista de bloqueio)';
    if (!this.hostsLiberados.has(semWww(u.host))) return `host fora da fonte (${u.host})`;
    return null;
  }

  private async esperarVez(h: EstadoDoHost): Promise<void> {
    const falta = h.ultima + h.intervaloMs - this.agora();
    if (falta > 0) await this.dormir(falta);
  }

  private async bruto(h: EstadoDoHost, url: string, p: PedidoDaPagina): Promise<Response> {
    await this.esperarVez(h);
    this.pedidos += 1;
    try {
      return await this.fetchImpl(url, {
        method: p.metodo ?? 'GET',
        body: p.corpo,
        // Nunca seguir sozinho: cada salto passa pelas travas antes de sair (`seguir`).
        redirect: 'manual',
        headers: {
          'User-Agent': this.o.userAgent,
          Accept: p.aceitar ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          ...(p.cabecalhos ?? {}),
        },
        signal: AbortSignal.timeout(p.tempo ?? 60_000),
      });
    } finally {
      h.ultima = this.agora();
    }
  }

  /**
   * Pede o robots.txt seguindo redirecionamento à mão, só para endereço que
   * passa em `motivoDeRecusa` (http→https e www são o caso comum). Devolve a
   * resposta final ou o motivo de não ter seguido. Cada salto conta no teto.
   */
  private async pedirRobots(h: EstadoDoHost, url0: string): Promise<Response | string> {
    let url = url0;
    for (let salto = 0; ; salto += 1) {
      const r = await this.bruto(h, url, { aceitar: 'text/plain,*/*;q=0.5', tempo: 20_000 });
      const local = r.headers.get('location');
      if (!REDIRECIONAMENTOS.has(r.status) || !local) return r;
      await descartar(r);
      if (salto + 1 > MAX_SALTOS) return `com mais de ${MAX_SALTOS} redirecionamentos`;
      let proxima: string;
      try {
        proxima = new URL(local, url).href;
      } catch {
        return 'redirecionado para endereço inválido';
      }
      const recusa = this.motivoDeRecusa(proxima);
      if (recusa) return `redirecionado para fora da fonte (${recusa})`;
      if (this.pedidos >= this.o.maxPedidos)
        return `parou no teto de ${this.o.maxPedidos} pedidos por rodada`;
      url = proxima;
    }
  }

  /**
   * Faz o pedido e segue redirecionamento À MÃO (até `MAX_SALTOS`). Antes de
   * cada salto o destino passa pelas travas: endereço da fonte e não
   * bloqueado, robots.txt do host de destino (lido se preciso, contado no
   * teto), caminho aberto, teto e prazo. Se alguma trava fecha, o pedido ao
   * destino NÃO sai.
   */
  private async seguir(h0: EstadoDoHost, url0: string, p0: PedidoDaPagina): Promise<Seguido> {
    let h = h0;
    let url = url0;
    let p = p0;
    for (let salto = 0; ; salto += 1) {
      const r = await this.bruto(h, url, p);
      const local = r.headers.get('location');
      if (!REDIRECIONAMENTOS.has(r.status) || !local) return { tipo: 'resposta', r, url, host: h };
      await descartar(r);
      if (salto + 1 > MAX_SALTOS)
        return {
          tipo: 'recusado',
          url,
          status: r.status,
          motivo: `mais de ${MAX_SALTOS} redirecionamentos`,
        };
      let proxima: string;
      try {
        proxima = new URL(local, url).href;
      } catch {
        return {
          tipo: 'recusado',
          url,
          status: r.status,
          motivo: 'redirecionado para endereço inválido',
        };
      }
      const recusa = this.motivoDeRecusa(proxima);
      if (recusa) {
        // Fica o endereço da fonte que redirecionou, nunca o destino recusado.
        this.fechadosPeloRobots.push(`${url} (redirecionou para fora da fonte: ${recusa})`);
        return {
          tipo: 'recusado',
          url,
          status: r.status,
          motivo: `redirecionado para fora da fonte: ${recusa}`,
        };
      }
      const destino = await this.abrirHost(new URL(proxima).origin);
      if (destino.parado || !destino.robots) {
        return {
          tipo: 'recusado',
          url: proxima,
          status: r.status,
          motivo: `redirecionado para host parado: ${destino.parado ?? 'robots.txt não lido'}`,
        };
      }
      if (!permitidoPeloRobots(destino.robots, proxima)) {
        this.fechadosPeloRobots.push(proxima);
        return {
          tipo: 'recusado',
          url: proxima,
          status: r.status,
          motivo: 'redirecionado para caminho que o robots.txt fecha',
        };
      }
      if (this.pedidos >= this.o.maxPedidos) {
        this.paradaGeral = `teto de ${this.o.maxPedidos} pedidos por rodada`;
        return { tipo: 'parou' };
      }
      if (this.agora() + destino.intervaloMs > this.o.prazo) {
        this.paradaGeral = 'prazo da rodada';
        return { tipo: 'parou' };
      }
      p = pedidoDoSalto(r.status, p);
      h = destino;
      url = proxima;
    }
  }

  private async abrirHost(origem: string): Promise<EstadoDoHost> {
    const existente = this.hosts.get(origem);
    if (existente) return existente;
    const h: EstadoDoHost = {
      origem,
      robots: null,
      robotsTexto: null,
      robotsStatus: null,
      ultima: 0,
      intervaloMs: this.o.intervaloMs,
      parado: null,
    };
    this.hosts.set(origem, h);
    if (this.pedidos >= this.o.maxPedidos) {
      h.parado = `teto de ${this.o.maxPedidos} pedidos por rodada`;
      return h;
    }
    let r: Response;
    // RFC 9309 §2.3.1.4: robots ilegível por erro do servidor = tudo fechado,
    // até 30 dias seguidos; depois disso, pode valer como "sem robots".
    const ilegivel = (motivo: string): EstadoDoHost => {
      const desde = this.o.robotsIlegivelDesde?.[origem] ?? this.o.hoje ?? null;
      if (desde) this.robotsIlegivel[origem] = desde;
      const dias =
        desde && this.o.hoje
          ? (Date.parse(`${this.o.hoje}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 864e5
          : 0;
      if (dias >= 30) {
        h.robotsTexto = '';
        h.robots = {
          regras: [],
          atraso: null,
          grupo: `* (robots ilegível desde ${desde ?? '?'}: RFC 9309, 30 dias)`,
        };
        return h;
      }
      h.parado = motivo;
      return h;
    };
    try {
      const lido = await this.pedirRobots(h, `${origem}/robots.txt`);
      if (typeof lido === 'string') {
        // Redirecionado para fora da fonte, laço ou teto: não dá para saber a regra.
        h.parado = `robots.txt ${lido}`;
        return h;
      }
      r = lido;
    } catch (e) {
      return ilegivel(
        `robots.txt não pôde ser lido (${e instanceof Error ? e.message : String(e)})`,
      );
    }
    h.robotsStatus = r.status;
    if (r.status >= 500) return ilegivel(`robots.txt respondeu HTTP ${r.status}`);
    if (r.status === 404 || r.status === 410) {
      // RFC 9309 §2.3.1.3: robots "indisponível" (4xx) = sem regra declarada.
      h.robotsTexto = '';
      h.robots = { regras: [], atraso: null, grupo: '*' };
    } else if (!r.ok) {
      // 5xx, 401/403, 429...: não dá para saber a regra, então não se pede nada.
      h.parado = `robots.txt respondeu HTTP ${r.status}`;
      return h;
    } else {
      const texto = await r.text();
      if (/<html/i.test(texto.slice(0, 500))) {
        h.parado = 'robots.txt veio como página HTML (ilegível)';
        return h;
      }
      h.robotsTexto = texto;
      h.robots = lerRobots(texto, this.o.tokenDoRobo);
    }
    if (h.robots.atraso !== null) h.intervaloMs = Math.max(h.intervaloMs, h.robots.atraso * 1000);
    return h;
  }

  /**
   * Abre a fonte: lê o robots.txt do host principal e confere que a raiz (ou o
   * caminho dado) está aberta para o nosso robô. Sem isso, a fonte não roda.
   */
  async abrir(caminhoDeTeste = '/'): Promise<boolean> {
    const base = this.o.urlDaFonte;
    if (!base || !/^https?:\/\//i.test(base)) {
      this.paradaGeral = 'a fonte não tem endereço na lista';
      return false;
    }
    const u = new URL(base);
    const recusa = this.motivoDeRecusa(base);
    if (recusa) {
      this.paradaGeral = recusa;
      return false;
    }
    const h = await this.abrirHost(u.origin);
    if (h.parado || !h.robots) return false;
    if (!permitidoPeloRobots(h.robots, new URL(caminhoDeTeste, u.origin).href)) {
      h.parado = 'robots.txt fecha o caminho da fonte para o nosso robô';
      return false;
    }
    return true;
  }

  /** O robots deixa pedir este endereço? (Lê o robots do host se ainda não leu.) */
  async podePedir(url: string): Promise<boolean> {
    if (this.motivoDeRecusa(url)) return false;
    const h = await this.abrirHost(new URL(url).origin);
    return !h.parado && h.robots !== null && permitidoPeloRobots(h.robots, url);
  }

  /**
   * Um pedido a uma página pública. Devolve null quando o pedido NÃO sai:
   * host fora da fonte ou bloqueado, robots fecha, teto, prazo ou parada.
   */
  async pagina(url: string, p: PedidoDaPagina = {}): Promise<RespostaDaPagina | null> {
    if (this.paradaGeral) return null;
    const recusa = this.motivoDeRecusa(url);
    if (recusa) {
      this.fechadosPeloRobots.push(`${url} (${recusa})`);
      return null;
    }
    const h = await this.abrirHost(new URL(url).origin);
    if (h.parado || !h.robots) return null;
    if (!permitidoPeloRobots(h.robots, url)) {
      this.fechadosPeloRobots.push(url);
      return null;
    }
    const tentativas = Math.max(0, p.tentativas ?? 2);
    let ultimoErro = '';
    for (let i = 0; i <= tentativas; i += 1) {
      if (this.pedidos >= this.o.maxPedidos) {
        this.paradaGeral = `teto de ${this.o.maxPedidos} pedidos por rodada`;
        return null;
      }
      if (this.agora() + h.intervaloMs > this.o.prazo) {
        this.paradaGeral = 'prazo da rodada';
        return null;
      }
      let seg: Seguido;
      try {
        seg = await this.seguir(h, url, p);
      } catch (e) {
        ultimoErro = e instanceof Error ? e.message : String(e);
        continue;
      }
      if (seg.tipo === 'parou') return null;
      if (seg.tipo === 'recusado') {
        // O destino do redirecionamento não passou nas travas: nada foi pedido a ele.
        return {
          url: seg.url,
          status: seg.status,
          bytes: null,
          texto: null,
          sha256: null,
          tipo: null,
          cabecalhos: {},
          coletadoEm: new Date(this.agora()).toISOString(),
          erro: seg.motivo,
        };
      }
      const { r, url: final, host } = seg;
      const cabecalhos: Record<string, string> = {};
      r.headers.forEach((valor, chave) => {
        cabecalhos[chave.toLowerCase()] = valor;
      });
      if (r.status === 429 || r.status === 403) {
        await descartar(r);
        host.parado = `HTTP ${r.status} (o site pediu para parar)`;
        return {
          url: final,
          status: r.status,
          bytes: null,
          texto: null,
          sha256: null,
          tipo: null,
          cabecalhos,
          coletadoEm: new Date(this.agora()).toISOString(),
        };
      }
      if (r.status >= 500) {
        await descartar(r);
        ultimoErro = `HTTP ${r.status}`;
        continue;
      }
      const coletadoEm = new Date(this.agora()).toISOString();
      if (!r.ok) {
        await descartar(r);
        return {
          url: final,
          status: r.status,
          bytes: null,
          texto: null,
          sha256: null,
          tipo: null,
          cabecalhos,
          coletadoEm,
        };
      }
      const bytes = Buffer.from(await r.arrayBuffer());
      const tipo = r.headers.get('content-type');
      return {
        url: final,
        status: r.status,
        bytes,
        texto: p.binario ? null : decodificar(bytes, tipo),
        sha256: sha256(bytes),
        tipo,
        cabecalhos,
        coletadoEm,
      };
    }
    return {
      url,
      status: 0,
      bytes: null,
      texto: null,
      sha256: null,
      tipo: null,
      cabecalhos: {},
      coletadoEm: new Date(this.agora()).toISOString(),
      erro: ultimoErro || 'sem resposta',
    };
  }

  /** Atalho: pede e lê JSON. Devolve null quando o pedido não saiu ou não veio 2xx. */
  async json<T = unknown>(
    url: string,
    p: PedidoDaPagina = {},
  ): Promise<{ dado: T; resposta: RespostaDaPagina } | null> {
    const r = await this.pagina(url, { aceitar: 'application/json', ...p });
    if (!r?.texto) return null;
    return { dado: JSON.parse(r.texto) as T, resposta: r };
  }
}

// ---------------------------------------------------------------------------
// Peças de leitura de HTML
// ---------------------------------------------------------------------------

/** Bytes → texto no charset certo (cabeçalho, depois <meta charset>, senão UTF-8). */
export function decodificar(bytes: Uint8Array, contentType: string | null = ''): string {
  let cs = (String(contentType ?? '').match(/charset=([\w-]+)/i) ?? [])[1];
  if (!cs) {
    const inicio = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
    cs = (inicio.match(/<meta[^>]+charset=["']?([\w-]+)/i) ?? [])[1];
  }
  const nome = (cs ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(
      nome === 'iso-8859-1' || nome === 'latin1' ? 'windows-1252' : nome,
    ).decode(bytes);
  } catch {
    return Buffer.from(bytes).toString('utf8');
  }
}

const ENT: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  sup2: '²',
  sup3: '³',
  ordm: 'º',
  ordf: 'ª',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  deg: '°',
  middot: '·',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
  ccedil: 'ç',
  Ccedil: 'Ç',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
};
const ACENTO: Record<string, string> = { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈' };

/** Decodifica entidades HTML (&aacute;, &#233;, &#x00e9;, &sup2;...). */
export function entidades(s: unknown): string {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, n: string) => {
      const direto = ENT[n];
      if (direto !== undefined) return direto;
      const a = n.match(/^([a-zA-Z])(acute|grave|circ|tilde|uml)$/);
      return a && a[1] && a[2] ? (a[1] + (ACENTO[a[2]] ?? '')).normalize('NFC') : m;
    });
}

export const semTags = (s: unknown): string =>
  entidades(
    String(s ?? '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

/** "R$ 1.250.000,00" → 1250000; "1.250" → 1250; "98,5" → 98.5. null se não houver número positivo. */
export function numeroBR(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return null;
  let n: number;
  if (/,\d{1,2}$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'));
  else if (/\.\d{3}(\.|$)/.test(s) && !/\.\d{1,2}$/.test(s))
    n = Number(s.replace(/\./g, '').replace(/,/g, ''));
  else n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Caracteres de controle (menos tab, quebra de linha e retorno), que quebram o JSON-LD de alguns sites. */
const controles = (s: string): string =>
  [...s]
    .map((ch) => {
      const c = ch.charCodeAt(0);
      return c < 32 && c !== 9 && c !== 10 && c !== 13 ? ' ' : ch;
    })
    .join('');

function lerJsonTolerante(corpo: string): unknown {
  try {
    return JSON.parse(corpo);
  } catch {
    try {
      return JSON.parse(controles(corpo).replace(/[\t\n\r]+/g, ' '));
    } catch {
      return null;
    }
  }
}

/** Todos os blocos JSON-LD da página, já lidos (inclusive os de @graph). */
export function jsonLd(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of String(html).matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const corpo = (m[1] ?? '').trim();
    const j = lerJsonTolerante(corpo);
    if (!j) continue;
    for (const x of Array.isArray(j) ? j : [j]) {
      if (x && typeof x === 'object') {
        const grafo = (x as Record<string, unknown>)['@graph'];
        if (Array.isArray(grafo)) out.push(...(grafo as Array<Record<string, unknown>>));
        else out.push(x as Record<string, unknown>);
      }
    }
  }
  return out;
}

/** URLs <loc> de um sitemap (ou índice de sitemaps). */
export const locsDoSitemap = (xml: string): string[] =>
  [...String(xml).matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) =>
    (m[1] ?? '').trim().replace(/&amp;/g, '&'),
  );
