import { haQuantoCurto } from '@/components/relatorios/formatos-vende';

import type { Permissao } from './aviso-do-navegador';

/**
 * Toda a equipe recebe aviso, e a gestão vê quem não recebe (11/11/2026, só na
 * Imova, módulo `avisosDaEquipe`). As regras puras, sem React e sem navegador.
 *
 * O gargalo: o app de celular só estava no iPhone do dono, o e-mail de aviso
 * estava desligado e cada computador só avisava se alguém tivesse ligado a
 * notificação do navegador. Ninguém sabia quem estava recebendo. Pedido:
 * "Instalar o app em toda a equipe ou, no mínimo, ligar a notificação do
 * navegador em cada computador."
 *
 * Três peças usam o que está aqui:
 *   - a FAIXA no alto do CRM, que pede para ligar os avisos deste computador
 *     (`faixaDosAvisos`);
 *   - o REGISTRO do navegador no banco, que conta à gestão se ele avisa
 *     (`rotuloDoNavegador`, `precisaRegistrar`; migração 20261111202000);
 *   - a VISÃO da gestão, Ajustes → Avisos (`TEXTO_DA_SITUACAO`,
 *     `textoDoCelular`, `textoDoComputador`).
 */

// ===========================================================================
// O navegador, em palavras
// ===========================================================================

export type NomeDoNavegador =
  'Chrome' | 'Edge' | 'Safari' | 'Firefox' | 'Opera' | 'Samsung Internet' | 'Navegador';

export type Sistema = 'Mac' | 'Windows' | 'Linux' | 'Chromebook' | 'iPhone' | 'iPad' | 'Android';

/**
 * Qual navegador, em qual sistema, pela identificação dele. A ordem importa: o
 * Edge e o Opera também dizem "Chrome", o Chrome também diz "Safari", o iPhone
 * diz "like Mac OS X", o Android diz "Linux", e o iPad se apresenta como Mac — só
 * os toques o denunciam (como em `instalar-app.ts`).
 */
export function identificarNavegador(
  identificacao: string,
  toques = 0,
): { navegador: NomeDoNavegador; sistema: Sistema | null } {
  const ua = identificacao;
  const navegador: NomeDoNavegador = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser\//.test(ua)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\/|Chromium\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua) && /Version\//.test(ua)
              ? 'Safari'
              : 'Navegador';

  const sistema: Sistema | null = /iPhone|iPod/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && toques > 1)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'Chromebook'
            : /Macintosh|Mac OS X/.test(ua)
              ? 'Mac'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;

  return { navegador, sistema };
}

/**
 * O nome que a gestão lê: "Chrome no Mac", "Edge no Windows". É o único traço do
 * navegador que vai ao banco: a identificação inteira, não.
 */
export function rotuloDoNavegador(identificacao: string, toques = 0): string {
  const { navegador, sistema } = identificarNavegador(identificacao, toques);
  return sistema ? `${navegador} no ${sistema}` : navegador;
}

/** O nome do navegador como o sistema o mostra nos ajustes de notificação. */
function nomeNoSistema(navegador: NomeDoNavegador): string {
  switch (navegador) {
    case 'Chrome':
      return 'Google Chrome';
    case 'Edge':
      return 'Microsoft Edge';
    case 'Navegador':
      return 'o seu navegador';
    default:
      return navegador;
  }
}

/**
 * O que o sistema pode estar calando, mesmo com o navegador liberado. Foi o caso
 * de 30/10/2026 (`aviso-do-navegador.ts`): no Mac, com a chave do Chrome
 * desligada nos Ajustes do Sistema, a chamada dá certo e nada aparece.
 */
export function dicaDoSistema(navegador: NomeDoNavegador, sistema: Sistema | null): string | null {
  const nome = nomeNoSistema(navegador);
  if (sistema === 'Mac') {
    return `No Mac, confira Ajustes do Sistema → Notificações → ${nome}: “Permitir notificações” ligado, e o Foco (Não perturbe) desligado.`;
  }
  if (sistema === 'Windows') {
    return `No Windows, confira Configurações → Sistema → Notificações: ${nome} ligado, e o Não incomodar desligado.`;
  }
  return null;
}

/**
 * Como desbloquear a notificação no navegador que a pessoa está usando. Os nomes
 * entre aspas são os do navegador em português, para a pessoa achar o que lê.
 */
export function passosParaDesbloquear(
  navegador: NomeDoNavegador,
  sistema: Sistema | null,
): readonly string[] {
  const passos: string[] =
    navegador === 'Safari'
      ? [
          'No menu “Safari”, no alto da tela, abra “Ajustes…” e a aba “Sites”.',
          'Na lista da esquerda, escolha “Notificações”.',
          'Ache o endereço do CRM, troque para “Permitir” e recarregue a página.',
        ]
      : navegador === 'Firefox'
        ? [
            'Clique no ícone à esquerda do endereço do site, na barra de cima.',
            'Ao lado de “Enviar notificações”, clique no X para tirar o bloqueio.',
            'Recarregue a página e clique em “Ligar avisos” de novo.',
          ]
        : navegador === 'Edge'
          ? [
              'Clique no cadeado à esquerda do endereço do site, na barra de cima.',
              'Em “Permissões para este site”, troque “Notificações” para “Permitir”.',
              'Recarregue a página.',
            ]
          : [
              'Clique no ícone à esquerda do endereço do site, na barra de cima.',
              'Em “Notificações”, escolha “Permitir”.',
              'Recarregue a página.',
            ];
  const dica = dicaDoSistema(navegador, sistema);
  return dica ? [...passos, dica] : passos;
}

// ===========================================================================
// A faixa
// ===========================================================================

/** "Agora não" esconde a faixa por três dias. */
export const ADIAR_A_FAIXA_MS = 3 * 24 * 60 * 60 * 1000;

/** `ligar`: o navegador ainda não perguntou. `desbloquear`: a pessoa recusou. */
export type FaixaDosAvisos = 'ligar' | 'desbloquear' | null;

/**
 * Se a faixa aparece, e qual. Só no computador, no navegador comum (o app de
 * celular tem os avisos dele) e para quem recebe avisos. Não aparece:
 *   - com o aviso já liberado, ou num navegador sem notificação;
 *   - para quem silenciou os avisos no menu: foi escolha da pessoa, e a gestão
 *     vê isso na visão dela;
 *   - nos três dias depois de "Agora não".
 */
export function faixaDosAvisos(e: {
  /** O módulo da empresa e o papel de quem recebe avisos. */
  readonly ligada: boolean;
  readonly noApp: boolean;
  readonly computador: boolean;
  readonly permissao: Permissao;
  readonly silenciado: boolean;
  /** Até quando "Agora não" vale (ISO), ou `null`. */
  readonly adiadaAte: string | null;
  readonly agora: number;
}): FaixaDosAvisos {
  if (!e.ligada || e.noApp || !e.computador || e.silenciado) return null;
  if (estaAdiada(e.adiadaAte, e.agora)) return null;
  if (e.permissao === 'a_pedir') return 'ligar';
  if (e.permissao === 'bloqueada') return 'desbloquear';
  return null;
}

/** "Agora não" vale até este instante. Data ilegível conta como não adiada. */
export function estaAdiada(adiadaAte: string | null, agora: number): boolean {
  if (!adiadaAte) return false;
  const ate = Date.parse(adiadaAte);
  return Number.isFinite(ate) && ate > agora;
}

export function adiarAte(agora: number): string {
  return new Date(agora + ADIAR_A_FAIXA_MS).toISOString();
}

// ===========================================================================
// O registro do navegador
// ===========================================================================

export const UMA_HORA_MS = 60 * 60 * 1000;

/** O que o navegador conta ao banco. */
export interface EstadoDoNavegador {
  readonly permissao: Permissao;
  readonly som: boolean;
  readonly silenciado: boolean;
  readonly rotulo: string;
}

/** O estado numa linha: mudou a linha, mudou o estado. */
export function assinaturaDoEstado(e: EstadoDoNavegador): string {
  return [
    e.permissao,
    e.som ? 'som' : 'mudo',
    e.silenciado ? 'silenciado' : 'avisa',
    e.rotulo,
  ].join('|');
}

/** O último registro deste navegador, como ficou guardado nele. */
export interface UltimoRegistro {
  readonly assinatura: string;
  readonly em: number;
}

/** Lê o que foi guardado; qualquer coisa estranha vale como "nunca registrou". */
export function lerUltimoRegistro(texto: string | null): UltimoRegistro | null {
  if (!texto) return null;
  try {
    const lido = JSON.parse(texto) as { assinatura?: unknown; em?: unknown };
    return typeof lido.assinatura === 'string' && typeof lido.em === 'number'
      ? { assinatura: lido.assinatura, em: lido.em }
      : null;
  } catch {
    return null;
  }
}

/**
 * Registrar agora? Na primeira vez, quando o estado mudou (a pessoa liberou ou
 * bloqueou a notificação, ligou o som, silenciou), e de hora em hora para
 * renovar o sinal. Relógio que voltou para trás conta como "passou a hora".
 */
export function precisaRegistrar(
  ultimo: UltimoRegistro | null,
  assinatura: string,
  agora: number,
): boolean {
  if (!ultimo || ultimo.assinatura !== assinatura) return true;
  return agora - ultimo.em >= UMA_HORA_MS || agora < ultimo.em;
}

const ID_DO_APARELHO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function idDoAparelhoValido(id: string | null): id is string {
  return id !== null && ID_DO_APARELHO.test(id);
}

// ===========================================================================
// A visão da gestão
// ===========================================================================

export type Situacao = 'celular_e_computador' | 'so_computador' | 'so_celular' | 'nenhum';

export const TEXTO_DA_SITUACAO: Readonly<Record<Situacao, string>> = {
  celular_e_computador: 'Recebe no celular e no computador',
  so_computador: 'Só no computador',
  so_celular: 'Só no celular',
  nenhum: 'Não recebe aviso nenhum',
};

export function situacaoDe(valor: unknown): Situacao {
  return typeof valor === 'string' && Object.hasOwn(TEXTO_DA_SITUACAO, valor)
    ? (valor as Situacao)
    : 'nenhum';
}

/** Um navegador da pessoa, como vem de `public.avisos_quem_recebe`. */
export interface NavegadorDaPessoa {
  readonly rotulo: string;
  readonly permissao: string;
  readonly som: boolean;
  readonly silenciado: boolean;
  readonly visto_em: string;
}

/** Uma linha de `public.avisos_quem_recebe` (migração 20261111202000). */
export interface QuemRecebe {
  readonly pessoa_id: string;
  readonly nome: string;
  readonly papel: string;
  readonly celular_aparelhos: number;
  readonly celular_visto_em: string | null;
  readonly celular_mensagem_ligada: boolean;
  readonly celular_push_ligado: boolean;
  readonly computador_ligados: number;
  readonly computador_visto_em: string | null;
  readonly navegadores: readonly NavegadorDaPessoa[];
  readonly situacao: Situacao;
}

/** O que a célula mostra: a frase, o último sinal e o que explica um "não". */
export interface TextoDaCelula {
  readonly texto: string;
  /** "último sinal há 3 h"; `null` quando nunca houve sinal. */
  readonly sinal: string | null;
  /** O que falta, navegador por navegador, em linhas curtas. */
  readonly notas: readonly string[];
  /** A frase é um "não": vai em cinza. */
  readonly apagado: boolean;
}

/** "último sinal há 3 h", "último sinal ontem", "último sinal agora mesmo". */
export function ultimoSinal(iso: string | null, agora: Date): string | null {
  const quando = haQuantoCurto(iso, agora);
  if (!quando) return null;
  return `último sinal ${quando === 'agora' ? 'agora mesmo' : quando}`;
}

export function textoDoCelular(linha: QuemRecebe, agora: Date): TextoDaCelula {
  const sinal = ultimoSinal(linha.celular_visto_em, agora);
  const n = linha.celular_aparelhos;
  if (n <= 0) return { texto: 'Sem o app', sinal: null, notas: [], apagado: true };
  if (!linha.celular_push_ligado) {
    return {
      texto: 'App instalado, sem aviso',
      sinal,
      notas: ['Os avisos no celular estão desligados para todos.'],
      apagado: true,
    };
  }
  if (!linha.celular_mensagem_ligada) {
    return {
      texto: 'App instalado, sem o aviso de mensagem nova',
      sinal,
      notas: ['A pessoa desligou em “Avisos no celular”.'],
      apagado: true,
    };
  }
  return {
    texto: n === 1 ? 'App com aviso ligado' : `App com aviso ligado em ${n} aparelhos`,
    sinal,
    notas: [],
    apagado: false,
  };
}

/** Por que um navegador não avisa, ou avisa calado. `null` = avisa com som. */
export function motivoDoNavegador(n: NavegadorDaPessoa): string | null {
  if (n.permissao === 'bloqueada') return 'notificação bloqueada no navegador';
  if (n.permissao === 'a_pedir') return 'aviso ainda não ligado';
  if (n.permissao === 'sem_suporte') return 'este navegador não mostra aviso';
  if (n.silenciado) return 'avisos silenciados no menu';
  if (!n.som) return 'avisa, sem som';
  return null;
}

export function textoDoComputador(linha: QuemRecebe, agora: Date): TextoDaCelula {
  const sinal = ultimoSinal(linha.computador_visto_em, agora);
  const notas = linha.navegadores.flatMap((n) => {
    const motivo = motivoDoNavegador(n);
    return motivo ? [`${n.rotulo}: ${motivo}`] : [];
  });
  const ligados = linha.computador_ligados;
  if (ligados > 0) {
    return {
      texto: ligados === 1 ? '1 navegador com aviso' : `${ligados} navegadores com aviso`,
      sinal,
      notas,
      apagado: false,
    };
  }
  if (linha.navegadores.length > 0) {
    return { texto: 'Nenhum navegador com aviso', sinal, notas, apagado: true };
  }
  return {
    texto: 'Não abriu o CRM nos últimos 30 dias',
    sinal,
    notas: [],
    apagado: true,
  };
}

/** O resumo do alto da visão. */
export function resumoDaEquipe(linhas: readonly QuemRecebe[]): {
  readonly total: number;
  readonly nenhum: number;
  readonly ambos: number;
} {
  return {
    total: linhas.length,
    nenhum: linhas.filter((l) => l.situacao === 'nenhum').length,
    ambos: linhas.filter((l) => l.situacao === 'celular_e_computador').length,
  };
}
