import type { Temperatura } from '@/components/temperatura';

/**
 * A fila do dia (RF-MET-03, RF-MET-04) como ela chega de `public.meu_dia`.
 *
 * O tipo gerado em `packages/schema` declara toda coluna como não-nula (é o que o
 * `supabase gen types` faz com `returns table`), mas metade delas é nula na prática:
 * uma tarefa pode não ter organização, um negócio não tem `task_id`, um item futuro
 * não tem atraso. Este arquivo é onde essa mentira é desfeita, uma vez só, na
 * fronteira — o resto da tela trabalha com campos honestamente opcionais.
 */
export type ItemDoDia = {
  prioridade: number;
  tipo: TipoDeItem;
  /** Por que este item está na fila, escrito pelo banco em português. */
  motivo: string;
  /** O que fazer: título da tarefa, texto da próxima ação ou o nome do parceiro. */
  titulo: string;
  /** Instante do compromisso, em ISO. Nulo em tarefa sem prazo. */
  quando: string | null;
  /** Horas desde que venceu. Nulo quando ainda não venceu. */
  atrasoHoras: number | null;
  tarefaId: string | null;
  atividadeId: string | null;
  negocioId: string | null;
  organizacaoId: string | null;
  organizacao: string | null;
  bairro: string | null;
  categoria: string | null;
  temperatura: Temperatura | null;
  funil: string | null;
  etapa: string | null;
};

/**
 * Os nove motivos de entrada na fila, na ordem de urgência que a função do banco
 * numera de 1 a 9. Um `tipo` desconhecido (uma migração futura acrescenta um) cai
 * em `outro` e a linha continua aparecendo, sem quebrar a tela.
 */
export const TIPOS_DE_ITEM = [
  'reuniao_proxima',
  'desfecho_pendente',
  'tarefa_atrasada',
  'proxima_acao_atrasada',
  'tarefa_hoje',
  'proxima_acao_hoje',
  'sem_proxima_acao',
  'negocio_parado',
  'tarefa_futura',
  'tarefa_sem_data',
  'outro',
] as const;

export type TipoDeItem = (typeof TIPOS_DE_ITEM)[number];

export function ehTipoConhecido(valor: string): valor is TipoDeItem {
  return (TIPOS_DE_ITEM as readonly string[]).includes(valor);
}

// ---------------------------------------------------------------------------
// Blocos da fila
// ---------------------------------------------------------------------------

/**
 * A fila chega ordenada e plana. Ela é quebrada em blocos porque "vencido" e
 * "agendado para sexta" pedem decisões diferentes: o primeiro é dívida, o segundo é
 * plano. Uma lista contínua de 40 linhas faz a pessoa rolar procurando onde termina
 * o que é para agora — e no celular, no meio da rua, esse é justamente o custo que
 * não dá para pagar.
 *
 * As faixas são as prioridades da própria função (nada é reordenado aqui): 1-4 é o
 * que passou da hora, 5-6 é o resto do dia, 7 e 8 são os dois buracos que o funil
 * abre sozinho, 9 é o futuro.
 */
export type IdDoBloco = 'agora' | 'hoje' | 'sem_proxima_acao' | 'parados' | 'depois';

export type DefinicaoDeBloco = {
  id: IdDoBloco;
  titulo: string;
  /** Uma frase que diz o que junta essas linhas, para o bloco não ser só um rótulo. */
  explicacao: string;
  prioridades: readonly number[];
  /** `true` no bloco que nasce fechado (o futuro não disputa a atenção da manhã). */
  recolhidoPorPadrao?: boolean;
};

export const BLOCOS: readonly DefinicaoDeBloco[] = [
  {
    id: 'agora',
    titulo: 'Agora',
    explicacao: 'Passou da hora, ou acontece em menos de três horas.',
    prioridades: [1, 2, 3, 4],
  },
  {
    id: 'hoje',
    titulo: 'Ainda hoje',
    explicacao: 'Tem prazo para hoje e ainda não venceu.',
    prioridades: [5, 6],
  },
  {
    id: 'sem_proxima_acao',
    titulo: 'Sem próxima ação',
    explicacao: 'Negócio aberto sem nada marcado. Combine o próximo passo ou dê como perdido.',
    prioridades: [7],
  },
  {
    id: 'parados',
    titulo: 'Parados na etapa',
    explicacao: 'Passaram do prazo da etapa sem ninguém tocar.',
    prioridades: [8],
  },
  {
    id: 'depois',
    titulo: 'Depois de hoje',
    explicacao: 'Já tem data marcada. Está aqui só para você saber o que vem.',
    prioridades: [9],
    recolhidoPorPadrao: true,
  },
];

export type BlocoPreenchido = DefinicaoDeBloco & { itens: ItemDoDia[] };

/** Quebra a fila nos blocos acima, preservando a ordem que o banco devolveu. */
export function agruparFila(itens: readonly ItemDoDia[]): BlocoPreenchido[] {
  return BLOCOS.map((bloco) => ({
    ...bloco,
    itens: itens.filter((item) => bloco.prioridades.includes(item.prioridade)),
  })).filter((bloco) => bloco.itens.length > 0);
}

/** Quantos itens são para hoje ou para trás — o número que a pessoa realmente deve. */
export function contarPendentesDeHoje(itens: readonly ItemDoDia[]): number {
  return itens.filter((item) => item.prioridade <= 8).length;
}

// ---------------------------------------------------------------------------
// Para onde cada linha leva
// ---------------------------------------------------------------------------

export type Destino = {
  href: string;
  /** O que a pessoa vai encontrar do outro lado, dito no rótulo acessível do link. */
  onde: string;
};

/**
 * Cada item leva para o lugar onde a ação acontece, e não para um lugar genérico:
 *
 *   * interação sem resultado  → Registrar contato, que é literalmente o que falta;
 *   * negócio sem próxima ação
 *     ou parado na etapa       → o funil, filtrado no parceiro, que é onde se move
 *                                de etapa e se combina o próximo passo;
 *   * tudo o mais              → a ficha do parceiro, que tem telefone, negócio e
 *                                histórico numa tela só.
 *
 * Item sem organização (interação registrada sem alvo resolvido) não vira link:
 * não há para onde mandar, e um link morto é pior que texto.
 */
export function destinoDoItem(item: ItemDoDia): Destino | null {
  if (!item.organizacaoId) return null;

  if (item.tipo === 'desfecho_pendente') {
    return { href: `/registrar?org=${item.organizacaoId}`, onde: 'registrar o resultado' };
  }

  if (item.tipo === 'sem_proxima_acao' || item.tipo === 'negocio_parado') {
    return { href: hrefDoFunil(item), onde: 'o funil' };
  }

  return { href: `/parceiros/${item.organizacaoId}`, onde: 'a ficha do parceiro' };
}

/**
 * O quadro filtrado no parceiro. A função do banco devolve o NOME do funil, não o
 * slug que a URL do quadro usa; o mapa abaixo cobre os dois quadros que existem e,
 * em qualquer outro caso, cai no padrão da própria tela de funis — pior hipótese, a
 * pessoa troca de aba uma vez, em vez de abrir um link quebrado.
 */
const SLUG_POR_FUNIL: Record<string, string> = {
  'Captação de fornecedor': 'fornecedor',
  'Produtor e cerimonialista': 'produtor',
};

export function hrefDoFunil(item: ItemDoDia): string {
  const parametros = new URLSearchParams();
  const slug = item.funil ? SLUG_POR_FUNIL[item.funil] : undefined;
  if (slug && slug !== 'fornecedor') parametros.set('funil', slug);
  if (item.organizacao) parametros.set('q', item.organizacao);
  const busca = parametros.toString();
  return busca ? `/funis?${busca}` : '/funis';
}

// ---------------------------------------------------------------------------
// Resumo do dia (metas × realizado)
// ---------------------------------------------------------------------------

export type MetricaDoDia = {
  metrica: string;
  rotulo: string;
  meta: number | null;
  realizado: number | null;
  percentual: number | null;
  /** `false` quando a métrica ainda não tem lastro no banco (o inbox não existe). */
  mensuravel: boolean;
  /** De onde sai o número, ou por que ele não sai. Vem escrito do banco. */
  fonte: string;
  periodoInicio: string;
  periodoFim: string;
};

/**
 * As quatro que abrem a tela. São as do RF-MET-01: a porta batida é o esforço, a
 * porta aberta é o resultado que o PRD persegue (três por dia), a ligação é o que a
 * Heloísa mais faz e a reunião marcada é o que move o funil.
 *
 * Métrica com meta definida entra mesmo fora desta lista: quem definiu a meta quer
 * vê-la.
 */
export const METRICAS_EM_DESTAQUE: readonly string[] = [
  'doors_opened',
  'doors_knocked',
  'calls_made',
  'meetings_booked',
];

export function metricasVisiveis(metricas: readonly MetricaDoDia[]): MetricaDoDia[] {
  return metricas.filter(
    (m) => m.mensuravel && (METRICAS_EM_DESTAQUE.includes(m.metrica) || m.meta !== null),
  );
}

/** Métricas que a tela precisa confessar: sem lastro, ou medidas por aproximação. */
export function ressalvasDasMetricas(metricas: readonly MetricaDoDia[]): string[] {
  return metricas
    .filter((m) => !m.mensuravel || m.fonte.startsWith('PROXY'))
    .map((m) => `${m.rotulo}: ${primeiraLetraMinuscula(m.fonte)}`);
}

function primeiraLetraMinuscula(frase: string): string {
  if (frase.startsWith('PROXY')) return frase.replace(/^PROXY:\s*/, 'é uma aproximação. ');
  return frase.charAt(0).toLowerCase() + frase.slice(1);
}
