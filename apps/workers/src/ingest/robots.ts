/**
 * robots.txt: leitura e veredito.
 *
 * Guardrail do CLAUDE.md, e o mais duro de todos: nunca contornar bloqueio, nunca
 * trocar o user-agent para disfarçar, nunca ignorar o robots.txt. Se a fonte
 * barrar, o coletor PARA e relata — não tenta outro caminho.
 *
 * Por que um analisador próprio, se o Crawlee já tem `respectRobotsTxtFile`? Porque
 * o Crawlee pula em silêncio a URL proibida, e silêncio aqui é o pior resultado
 * possível: a corrida terminaria "sem candidatos" sem ninguém saber por quê. Este
 * módulo dá um veredito NOMEADO (`permitido` / `proibido` + a regra que decidiu),
 * que vira log, vira `import_batches.error` e vira frase na tela do Radar. O
 * `respectRobotsTxtFile` do Crawlee continua ligado: são duas travas, não uma.
 *
 * Regras implementadas (especificação do REP, RFC 9309):
 * - grupos por `User-agent`; vence o grupo cujo token é o mais longo que casa com
 *   o nosso agente; `*` só quando nenhum específico casa;
 * - `Allow` e `Disallow` com curinga `*` e âncora final `$`;
 * - em empate de caminho, a regra MAIS LONGA vence; empate exato, `Allow` vence;
 * - `Disallow:` vazio libera tudo naquele grupo;
 * - `Crawl-delay`, quando existe, é um piso que se soma ao da fonte.
 */

export interface RegraDeRobots {
  /** true = Allow, false = Disallow. */
  permite: boolean;
  /** O padrão como veio no arquivo, ex.: `/emp-*.php`. */
  padrao: string;
  /** Regex equivalente, já ancorada no início do caminho. */
  expressao: RegExp;
  /** Tamanho do padrão: é ele que desempata (o mais longo vence). */
  peso: number;
}

export interface GrupoDeRobots {
  /** Tokens em minúsculas, como aparecem no arquivo. */
  agentes: string[];
  regras: RegraDeRobots[];
  atrasoSegundos: number | null;
}

export interface ArquivoDeRobots {
  grupos: GrupoDeRobots[];
  /** Sitemaps declarados (fora de grupo). Guardados por completude; ninguém depende deles hoje. */
  sitemaps: string[];
}

export type Veredito =
  | { permitido: true; motivo: 'sem_regra' | 'liberado_por_regra'; regra?: string; grupo?: string }
  | { permitido: false; motivo: 'proibido_por_regra'; regra: string; grupo: string };

/** Traduz um padrão de robots (`*` e `$`) para uma expressão regular ancorada no início. */
function paraExpressao(padrao: string): RegExp {
  let fonte = '';
  for (const caractere of padrao) {
    if (caractere === '*') {
      fonte += '.*';
    } else if (caractere === '$') {
      fonte += '$';
    } else {
      fonte += caractere.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${fonte}`);
}

/** Lê o texto do robots.txt. Linha malformada é ignorada, como manda a RFC. */
export function analisarRobots(texto: string): ArquivoDeRobots {
  const grupos: GrupoDeRobots[] = [];
  const sitemaps: string[] = [];
  let atual: GrupoDeRobots | null = null;
  // Duas linhas `User-agent` seguidas descrevem UM grupo com dois agentes; a
  // primeira linha de regra depois delas é que fecha o cabeçalho do grupo.
  let cabecalhoAberto = false;

  for (const linhaBruta of texto.split(/\r?\n/)) {
    const linha = linhaBruta.split('#')[0]?.trim() ?? '';
    if (!linha) continue;

    const separador = linha.indexOf(':');
    if (separador < 0) continue;
    const campo = linha.slice(0, separador).trim().toLowerCase();
    const valor = linha.slice(separador + 1).trim();

    if (campo === 'user-agent') {
      if (!atual || !cabecalhoAberto) {
        atual = { agentes: [], regras: [], atrasoSegundos: null };
        grupos.push(atual);
        cabecalhoAberto = true;
      }
      if (valor) atual.agentes.push(valor.toLowerCase());
      continue;
    }

    if (campo === 'sitemap') {
      if (valor) sitemaps.push(valor);
      continue;
    }

    if (!atual) continue;
    cabecalhoAberto = false;

    if (campo === 'allow' || campo === 'disallow') {
      // `Disallow:` vazio não é regra: é "nada proibido". Guardar como padrão
      // vazio faria a regra casar com tudo e proibir o site inteiro.
      if (!valor) continue;
      atual.regras.push({
        permite: campo === 'allow',
        padrao: valor,
        expressao: paraExpressao(valor),
        peso: valor.length,
      });
      continue;
    }

    if (campo === 'crawl-delay') {
      const numero = Number(valor.replace(',', '.'));
      if (Number.isFinite(numero) && numero > 0) atual.atrasoSegundos = numero;
    }
  }

  return { grupos, sitemaps };
}

/**
 * Escolhe o grupo que vale para o nosso agente. Vence o token mais longo que é
 * prefixo do nosso nome (`komunebot` casa com `KomuneBot/1.0`); `*` é o último
 * recurso. Quando dois grupos declaram o mesmo agente, as regras se somam.
 */
export function grupoParaAgente(
  arquivo: ArquivoDeRobots,
  agente: string,
): { agente: string; regras: RegraDeRobots[]; atrasoSegundos: number | null } | null {
  const nome = agente.toLowerCase();
  let melhor: string | null = null;

  for (const grupo of arquivo.grupos) {
    for (const token of grupo.agentes) {
      if (token === '*') continue;
      if (nome.startsWith(token) && (melhor === null || token.length > melhor.length)) {
        melhor = token;
      }
    }
  }
  const escolhido = melhor ?? '*';

  const doGrupo = arquivo.grupos.filter((g) => g.agentes.includes(escolhido));
  if (doGrupo.length === 0) return null;

  return {
    agente: escolhido,
    regras: doGrupo.flatMap((g) => g.regras),
    atrasoSegundos: doGrupo.reduce<number | null>(
      (maior, g) => (g.atrasoSegundos === null ? maior : Math.max(maior ?? 0, g.atrasoSegundos)),
      null,
    ),
  };
}

/** O veredito para um caminho (`/cerimonialista/...`, já com query se houver). */
export function avaliarCaminho(
  arquivo: ArquivoDeRobots,
  agente: string,
  caminho: string,
): Veredito {
  const grupo = grupoParaAgente(arquivo, agente);
  if (!grupo) return { permitido: true, motivo: 'sem_regra' };

  let vencedora: RegraDeRobots | null = null;
  for (const regra of grupo.regras) {
    if (!regra.expressao.test(caminho)) continue;
    if (
      vencedora === null ||
      regra.peso > vencedora.peso ||
      // Empate de tamanho: `Allow` vence, como manda a RFC 9309 §2.2.2.
      (regra.peso === vencedora.peso && regra.permite && !vencedora.permite)
    ) {
      vencedora = regra;
    }
  }

  if (!vencedora) return { permitido: true, motivo: 'sem_regra', grupo: grupo.agente };
  return vencedora.permite
    ? {
        permitido: true,
        motivo: 'liberado_por_regra',
        regra: `Allow: ${vencedora.padrao}`,
        grupo: grupo.agente,
      }
    : {
        permitido: false,
        motivo: 'proibido_por_regra',
        regra: `Disallow: ${vencedora.padrao}`,
        grupo: grupo.agente,
      };
}

/** O caminho que o robots avalia: rota + query, sem esquema nem host. */
export function caminhoDaUrl(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}
