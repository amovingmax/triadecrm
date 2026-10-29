/**
 * A atitude do cliente, a parte pura (29/10/2026; migração 20261029110000):
 * os nomes, a ordem de "Mais interessados" e a montagem do que veio do banco.
 * Quem CALCULA a etiqueta é o banco (`app.atitude_calcular`); aqui não há regra
 * de interesse nenhuma, só a de mostrar e ordenar.
 */

export type EtiquetaDeAtitude =
  | 'muito_interessado'
  | 'interessado'
  | 'morno'
  | 'esfriando'
  | 'sem_resposta'
  | 'sem_interesse'
  | 'nao_contatar';

/** As quatro que quem atende pode dar. As outras três são só da regra. */
export type EtiquetaDoToque = 'muito_interessado' | 'interessado' | 'morno' | 'sem_interesse';

export const ETIQUETAS_DO_TOQUE: readonly EtiquetaDoToque[] = [
  'muito_interessado',
  'interessado',
  'morno',
  'sem_interesse',
];

export const ROTULO_ATITUDE: Record<EtiquetaDeAtitude, string> = {
  muito_interessado: 'Muito interessado',
  interessado: 'Interessado',
  morno: 'Morno',
  esfriando: 'Esfriando',
  sem_resposta: 'Sem resposta',
  sem_interesse: 'Sem interesse',
  nao_contatar: 'Não contatar',
};

/**
 * A ordem de "Mais interessados". Esfriando vem logo depois dos interessados:
 * é gente que já quis e parou de responder — a próxima a cobrar.
 */
const POSICAO: Record<EtiquetaDeAtitude, number> = {
  muito_interessado: 0,
  interessado: 1,
  esfriando: 2,
  morno: 3,
  sem_resposta: 4,
  sem_interesse: 5,
  nao_contatar: 6,
};
const SEM_ETIQUETA = 7;

export type AtitudeDaConversa = {
  etiqueta: EtiquetaDeAtitude;
  antesDeEsfriar: EtiquetaDeAtitude | null;
  motivo: string | null;
  desde: string;
  /** O toque de quem atende, quando há. */
  marcada: EtiquetaDoToque | null;
  /** Os ids das objeções abertas. */
  objecoes: number[];
};

export type Objecao = { id: number; nome: string };

export type AtitudeCrua = {
  conversation_id: string;
  etiqueta: string | null;
  antes_de_esfriar: string | null;
  motivo: string | null;
  desde: string;
  marcada: string | null;
};

function ehEtiqueta(v: string | null): v is EtiquetaDeAtitude {
  return v !== null && v in ROTULO_ATITUDE;
}

function ehDoToque(v: string | null): v is EtiquetaDoToque {
  return v !== null && (ETIQUETAS_DO_TOQUE as readonly string[]).includes(v);
}

/** As linhas do banco num mapa por conversa. Linha sem etiqueta (conversa sem mensagem) fica de fora. */
export function montarAtitudes(
  linhas: readonly AtitudeCrua[],
  abertas: readonly { conversation_id: string; objecao_id: number }[],
): Map<string, AtitudeDaConversa> {
  const objecoesPorConversa = new Map<string, number[]>();
  for (const a of abertas) {
    const lista = objecoesPorConversa.get(a.conversation_id) ?? [];
    lista.push(a.objecao_id);
    objecoesPorConversa.set(a.conversation_id, lista);
  }
  const mapa = new Map<string, AtitudeDaConversa>();
  for (const l of linhas) {
    if (!ehEtiqueta(l.etiqueta)) continue;
    mapa.set(l.conversation_id, {
      etiqueta: l.etiqueta,
      antesDeEsfriar: ehEtiqueta(l.antes_de_esfriar) ? l.antes_de_esfriar : null,
      motivo: l.motivo,
      desde: l.desde,
      marcada: ehDoToque(l.marcada) ? l.marcada : null,
      objecoes: objecoesPorConversa.get(l.conversation_id) ?? [],
    });
  }
  return mapa;
}

/** A posição na ordem de "Mais interessados" (menor primeiro). */
export function posicaoDeInteresse(atitude: AtitudeDaConversa | undefined): number {
  return atitude ? POSICAO[atitude.etiqueta] : SEM_ETIQUETA;
}

/**
 * "Mais interessados": mais interessado primeiro, e, dentro de cada etiqueta, a
 * ordem que a lista já tinha (por ler, depois quem falou por último). O sort do
 * JavaScript é estável, então a segunda regra vem de graça.
 */
export function porInteresse<T>(
  linhas: readonly T[],
  conversaDe: (linha: T) => string | null | undefined,
  atitudes: ReadonlyMap<string, AtitudeDaConversa>,
): T[] {
  const posicao = (l: T) => {
    const id = conversaDe(l);
    return posicaoDeInteresse(id ? atitudes.get(id) : undefined);
  };
  return [...linhas].sort((a, b) => posicao(a) - posicao(b));
}

/** O texto da etiqueta: Esfriando diz o que a pessoa era. */
export function textoDaAtitude(atitude: Pick<AtitudeDaConversa, 'etiqueta' | 'antesDeEsfriar'>): string {
  if (atitude.etiqueta === 'esfriando' && atitude.antesDeEsfriar) {
    return `Esfriando · era ${ROTULO_ATITUDE[atitude.antesDeEsfriar].toLowerCase()}`;
  }
  return ROTULO_ATITUDE[atitude.etiqueta];
}
