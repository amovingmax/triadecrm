import type { AppRole } from '@/lib/auth/role';
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
  /**
   * Deixou de ser MOSTRADA em 28/09/2026 (ADR-16). Fica no tipo, e a RPC
   * continua devolvendo, porque `public.meu_dia` a usa na ORDENAÇÃO INTERNA da
   * fila (20260905000100): tirar daqui mudaria a ordem em que o time trabalha.
   */
  temperatura: Temperatura | null;
  funil: string | null;
  etapa: string | null;
  /**
   * O primeiro nome de quem a conversa aponta, e `null` quando ela já é minha
   * (28/09/2026, ADR-17). Só o item `conversa_esperando` o preenche: a fila de
   * quem respondeu deixou de ser filtrada por dono, então a linha precisa dizer
   * a quem ela está endereçada. Nulo em toda outra linha, porque lá a pergunta
   * não existe — tarefa e negócio da minha fila já são meus por definição.
   */
  atendente: string | null;
};

/**
 * Os dez motivos de entrada na fila, na ordem de urgência que a função do banco
 * numera de 0 a 9. Um `tipo` desconhecido (uma migração futura acrescenta um) cai
 * em `outro` e a linha continua aparecendo, sem quebrar a tela.
 *
 * O zero é o único que não numeramos nós: `conversa_esperando` é alguém que
 * respondeu no WhatsApp e está esperando gente (28/09/2026). Ele vem antes de
 * tudo porque é o único item da fila cujo relógio é de OUTRA pessoa — a janela de
 * 24 h fecha, e depois dela só sai modelo aprovado.
 */
export const TIPOS_DE_ITEM = [
  'conversa_esperando',
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
export type IdDoBloco =
  'respondeu' | 'agora' | 'hoje' | 'sem_proxima_acao' | 'parados' | 'depois' | 'sistema';

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
    id: 'respondeu',
    titulo: 'Responderam e estão esperando',
    explicacao:
      'Escreveram no WhatsApp e ninguém falou com eles desde então. A janela de 24 h corre.',
    prioridades: [0],
  },
  {
    id: 'agora',
    titulo: 'Urgente',
    explicacao: 'Passou da hora, ou acontece em menos de três horas.',
    prioridades: [1, 2, 3, 4],
  },
  {
    id: 'hoje',
    titulo: 'Até o fim do dia',
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

/**
 * AVISO DO SISTEMA NÃO É TAREFA DE CARTEIRA.
 *
 * O motor cria tarefa para o que ele mesmo precisa que alguém veja: "Dead-letter
 * ai_dlq: 1 mensagem morreu", "IA bloqueada pelo guardrail de PII". São avisos
 * legítimos, mas não têm parceiro, não têm negócio e não se resolvem ligando
 * para ninguém — e no meio da fila eles empurravam para baixo os quatro buffets
 * que estão esperando resposta há três dias.
 *
 * Eles vão para um bloco próprio, no fim e fechado, e saem da conta de
 * "pendentes" do cabeçalho: quem deve isso é o CRM, não a pessoa.
 */
export function ehAvisoDoSistema(item: ItemDoDia): boolean {
  // Quem escreveu de fora da base não tem ficha nem negócio, e sem esta linha
  // seria confundido com um aviso do motor e escondido no bloco recolhido do
  // fim — o mesmo sumiço que este item veio consertar.
  if (item.tipo === 'conversa_esperando') return false;
  return item.organizacaoId === null && item.negocioId === null;
}

const BLOCO_DO_SISTEMA: DefinicaoDeBloco = {
  id: 'sistema',
  titulo: 'Avisos do sistema',
  explicacao: 'Sem parceiro e sem negócio: é o motor pedindo atenção, não a carteira.',
  prioridades: [],
  recolhidoPorPadrao: true,
};

/** Quebra a fila nos blocos acima, preservando a ordem que o banco devolveu. */
export function agruparFila(itens: readonly ItemDoDia[]): BlocoPreenchido[] {
  const daCarteira = itens.filter((item) => !ehAvisoDoSistema(item));
  const doSistema = itens.filter(ehAvisoDoSistema);

  const blocos = BLOCOS.map((bloco) => ({
    ...bloco,
    itens: daCarteira.filter((item) => bloco.prioridades.includes(item.prioridade)),
  })).filter((bloco) => bloco.itens.length > 0);

  return doSistema.length > 0 ? [...blocos, { ...BLOCO_DO_SISTEMA, itens: doSistema }] : blocos;
}

// ---------------------------------------------------------------------------
// As três abas
// ---------------------------------------------------------------------------

/**
 * O Meu dia em três abas, como o RF-MET-03 descreve (Inbox / Feito / Futuro):
 *
 *   fazer     a fila de hoje: tudo menos o bloco do futuro — e quem respondeu no
 *             WhatsApp continua abrindo a aba, no topo
 *   feito     o que a pessoa registrou hoje, separado por como foi (`feito.ts`)
 *   proximos  o bloco do futuro, agrupado por dia
 *
 * Antes era uma lista só, com "Depois de hoje" no fim. Quem abria a tela lia os
 * blocos como se fossem o dia dela, e o futuro — que é plano, não dívida — disputava
 * a rolagem com o que vence hoje.
 */
export type AbaDoDia = 'fazer' | 'feito' | 'proximos';

export const ABAS_DO_DIA: readonly AbaDoDia[] = ['fazer', 'feito', 'proximos'];

export function abaDaUrl(valor: string | string[] | undefined): AbaDoDia {
  return typeof valor === 'string' && (ABAS_DO_DIA as readonly string[]).includes(valor)
    ? (valor as AbaDoDia)
    : 'fazer';
}

/** O único bloco que sai de "Para fazer": o futuro, que tem aba própria. */
const BLOCO_DOS_PROXIMOS: IdDoBloco = 'depois';

/**
 * Os blocos da aba "Para fazer": a fila sem o futuro, na ordem de `agruparFila`.
 *
 * O filtro é por EXCLUSÃO de propósito, e é o que mantém "Responderam e estão
 * esperando" (prioridade 0) no topo desta aba: um filtro que listasse os blocos
 * de hoje teria de lembrar dele, e um bloco novo que a `meu_dia` ganhar entra aqui
 * sozinho em vez de sumir das duas abas.
 */
export function blocosParaFazer(blocos: readonly BlocoPreenchido[]): BlocoPreenchido[] {
  return blocos.filter((bloco) => bloco.id !== BLOCO_DOS_PROXIMOS);
}

/** As prioridades que vão para a aba "Próximos dias", e não para "Para fazer". */
export const PRIORIDADES_DOS_PROXIMOS: readonly number[] =
  BLOCOS.find((bloco) => bloco.id === BLOCO_DOS_PROXIMOS)?.prioridades ?? [];

/** O item vai para "Próximos dias": tem data à frente e não é aviso do motor. */
export function ehDosProximos(item: ItemDoDia): boolean {
  return PRIORIDADES_DOS_PROXIMOS.includes(item.prioridade) && !ehAvisoDoSistema(item);
}

export type DiaDaFila = {
  /** `YYYY-MM-DD` em Natal, ou `null` para o que não tem data. */
  dia: string | null;
  itens: ItemDoDia[];
};

/**
 * O futuro agrupado por dia, em ordem de data e hora. A ordem é feita aqui porque a
 * faixa 9 da `public.meu_dia` não sai por data (medido: 29/09, 02/10, 30/09, 01/10),
 * e "próximos dias" se lê como agenda. `diaDe` é injetado para o teste não depender
 * do fuso da máquina.
 */
export function agruparPorDia(
  itens: readonly ItemDoDia[],
  diaDe: (iso: string) => string,
): DiaDaFila[] {
  const dias: DiaDaFila[] = [];
  const porHora = [...itens].sort((a, b) => (a.quando ?? '').localeCompare(b.quando ?? ''));
  for (const item of porHora) {
    const dia = item.quando ? diaDe(item.quando) : null;
    const grupo = dias.find((existente) => existente.dia === dia);
    if (grupo) grupo.itens.push(item);
    else dias.push({ dia, itens: [item] });
  }
  // `YYYY-MM-DD` se ordena como texto. Sem data vai para o fim: é o que menos tem
  // hora para acontecer.
  const comData = dias
    .filter((d): d is DiaDaFila & { dia: string } => d.dia !== null)
    .sort((a, b) => a.dia.localeCompare(b.dia));
  return [...comData, ...dias.filter((d) => d.dia === null)];
}

// ---------------------------------------------------------------------------
// "Próximos dias" lidos por conta própria
// ---------------------------------------------------------------------------

/**
 * A aba "Próximos dias" deixou de sair da fila (02/10/2026).
 *
 * A `public.meu_dia` devolve no máximo `LIMITE_DA_FILA` linhas, ordenadas por
 * urgência, e o futuro é a ÚLTIMA faixa. Com 60 pendências ou mais — o caso de
 * quem responde por muitos negócios — nenhum compromisso futuro cabia no corte:
 * Janio marcava uma reunião para segunda e ela não aparecia aqui (medido no
 * banco de teste: 63 pendências antes de 3 reuniões futuras). A tela avisava do
 * corte ("os compromissos mais distantes podem não estar aqui"), mas avisar não
 * é mostrar, e o pedido foi: "é obrigatório que apareça".
 *
 * Então a aba lê as tarefas abertas da pessoa direto de `tasks`, sem teto ligado
 * ao tamanho da fila, e monta as MESMAS linhas que a faixa 9 da função montaria.
 * É a regra dela, repetida aqui:
 *
 *   - entra a tarefa `todo` ou `doing` sem prazo, ou com prazo DEPOIS de hoje
 *     (dia de calendário em Natal — o recorte por data é feito na consulta);
 *   - não entra a de parceiro apagado nem a de parceiro que pediu para não ser
 *     contatado.
 *
 * PARCEIRO QUE A VIEW NÃO DEVOLVE. A função do banco é `security definer` e lê
 * `organizations` direto; aqui a leitura é pela `organizations_view`, que esconde
 * o apagado E o que quem lê não pode ver. Para admin, gestor, sdr, leitura e
 * financeiro (`app.sees_all`) "não veio" quer dizer "foi apagado", e a tarefa
 * sai. Para o EMBAIXADOR, "não veio" também acontece com o parceiro que não é
 * dele — e o gestor pode marcar para ele uma reunião num parceiro de outra
 * pessoa. Descartar ali esconderia justamente o compromisso que esta aba existe
 * para mostrar; então, para quem não vê tudo (`parceiroForaDaVista: 'mantem'`),
 * a linha fica, com o título da tarefa e sem os dados do parceiro.
 *
 * O que NÃO dá para repetir no navegador: a lista de supressão
 * (`app.is_suppressed_target`: telefone, CNPJ ou @ suprimidos, por parceiro ou
 * por contato), que só o banco enxerga. Aqui só se vê `do_not_contact`, que o
 * opt-out marca junto. Uma tarefa de quem está na lista sem essa marca pode
 * aparecer como plano; no dia dela, a fila de "Para fazer" — que continua saindo
 * da função — não a entrega. Mexeu na faixa 9 da `public.meu_dia`, mexe aqui.
 */
export type TarefaFutura = {
  id: string;
  title: string;
  due_at: string | null;
  deal_id: string | null;
  organization_id: string | null;
};

export type ParceiroDaTarefa = {
  id: string;
  name: string | null;
  neighborhood: string | null;
  primary_category_name: string | null;
  do_not_contact: boolean | null;
};

export type NegocioDaTarefa = {
  id: string;
  temperature: Temperatura | null;
  funil: string | null;
  etapa: string | null;
};

/**
 * O dia que vale como "hoje" para o corte dos próximos dias: o mais adiantado
 * entre o que o servidor mandou ao abrir a tela e o do relógio de agora.
 *
 * A fila de "Para fazer" usa o `now()` do banco. Com o app aberto desde ontem, o
 * `hoje` da tela ainda é ontem, e cortando por ele as tarefas de hoje apareciam
 * aqui, sob "Amanhã", ao mesmo tempo em que a fila as mostrava em "Para fazer".
 * O relógio do aparelho atrasado não puxa o corte para trás. `YYYY-MM-DD` se
 * compara como texto.
 */
export function hojeParaOCorte(daTela: string, deAgora: string): string {
  return deAgora > daTela ? deAgora : daTela;
}

export function montarProximosDias(entrada: {
  tarefas: readonly TarefaFutura[];
  parceiros: readonly ParceiroDaTarefa[];
  negocios: readonly NegocioDaTarefa[];
  /**
   * O que fazer com a tarefa cujo parceiro a view não devolveu: `descarta` para
   * quem vê a base inteira (o parceiro foi apagado), `mantem` para quem não vê
   * (pode só não ser dele). Sem dizer, descarta.
   */
  parceiroForaDaVista?: 'descarta' | 'mantem';
}): ItemDoDia[] {
  const parceiroPorId = new Map(entrada.parceiros.map((p) => [p.id, p]));
  const negocioPorId = new Map(entrada.negocios.map((n) => [n.id, n]));

  return entrada.tarefas
    .flatMap((tarefa): ItemDoDia[] => {
      const parceiro = tarefa.organization_id ? parceiroPorId.get(tarefa.organization_id) : null;
      // Tem parceiro, mas a view não o devolveu: foi apagado, ou não é de quem lê.
      if (tarefa.organization_id && !parceiro && entrada.parceiroForaDaVista !== 'mantem') {
        return [];
      }
      if (parceiro?.do_not_contact) return [];
      const negocio = tarefa.deal_id ? negocioPorId.get(tarefa.deal_id) : null;

      return [
        {
          prioridade: PRIORIDADES_DOS_PROXIMOS[0] ?? 9,
          tipo: tarefa.due_at ? 'tarefa_futura' : 'tarefa_sem_data',
          motivo: tarefa.due_at ? 'Tarefa agendada' : 'Tarefa sem prazo',
          titulo: tarefa.title,
          quando: tarefa.due_at,
          atrasoHoras: null,
          tarefaId: tarefa.id,
          atividadeId: null,
          negocioId: tarefa.deal_id,
          organizacaoId: tarefa.organization_id,
          organizacao: parceiro?.name ?? null,
          bairro: parceiro?.neighborhood ?? null,
          categoria: parceiro?.primary_category_name ?? null,
          temperatura: negocio?.temperature ?? null,
          funil: negocio?.funil ?? null,
          etapa: negocio?.etapa ?? null,
          atendente: null,
        },
      ];
    })
    .filter(ehDosProximos);
}

// ---------------------------------------------------------------------------
// O dia de outra pessoa
// ---------------------------------------------------------------------------

/**
 * De quem é o bloco "Responderam e estão esperando" que a `public.meu_dia` devolve
 * para uma pessoa. Espelha, em TypeScript, o recorte da própria função
 * (20261002180000, "QUEM PODE ATENDER VÊ A FILA INTEIRA"), que decide pelo papel
 * de QUEM A FILA É, e não de quem pergunta:
 *
 *   admin, gestor, sdr   'todos'   a fila COMUM: toda conversa esperando, de quem
 *                                  quer que seja (ADR-17, 28/09/2026)
 *   embaixador           'propria' só as conversas endereçadas a ele
 *   leitura, financeiro,
 *   bot, desconhecido    'nenhuma' não recebem o item (não podem responder)
 *
 * A tela só precisa disto no dia de OUTRA pessoa: no gestor que abre o dia de uma
 * SDR, o bloco que chega é a fila de todos — inclusive as conversas endereçadas ao
 * próprio gestor —, e mostrá-lo como "o dia da Heloísa" seria atribuir a ela uma
 * fila que é do time. Mexeu no recorte da função, mexe aqui.
 */
export type AlcanceDeQuemRespondeu = 'todos' | 'propria' | 'nenhuma';

export function alcanceDeQuemRespondeu(papel: AppRole | null): AlcanceDeQuemRespondeu {
  if (papel === 'admin' || papel === 'gestor' || papel === 'sdr') return 'todos';
  if (papel === 'embaixador') return 'propria';
  return 'nenhuma';
}

/**
 * A fila como a tela a mostra. No próprio dia, exatamente o que o banco devolveu.
 * No dia de outra pessoa, sem as conversas quando elas não são dessa pessoa: a
 * fila de quem respondeu é de todos e aparece no dia de quem abre a tela — a tela
 * diz isso numa linha, no lugar do bloco.
 */
export function filaVisivel(
  itens: readonly ItemDoDia[],
  { doProprio, alcance }: { doProprio: boolean; alcance: AlcanceDeQuemRespondeu },
): readonly ItemDoDia[] {
  if (doProprio || alcance === 'propria') return itens;
  return itens.filter((item) => item.tipo !== 'conversa_esperando');
}

/**
 * Quantos itens não têm data à frente: o que venceu, o que vence hoje, o negócio sem
 * próximo passo e o negócio parado na etapa. É o número que a pessoa realmente deve,
 * e é o do cabeçalho da tela.
 *
 * Ele é de propósito MAIOR que o do bloco "Urgente", que conta só a primeira das quatro
 * faixas. Por isso o cabeçalho fala em "pendentes" e não em "para agora": enquanto os
 * dois se chamavam a mesma coisa, a tela mostrava dois números com o mesmo nome e
 * contas diferentes, um por cima do outro.
 */
export function contarPendentesDeHoje(itens: readonly ItemDoDia[]): number {
  // Aviso do motor não entra na conta: ver `ehAvisoDoSistema`.
  return itens.filter((item) => item.prioridade <= 8 && !ehAvisoDoSistema(item)).length;
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
export function destinoDoItem(
  item: ItemDoDia,
  { somenteLeitura = false }: { somenteLeitura?: boolean } = {},
): Destino | null {
  // No dia de OUTRA pessoa (gestor ou admin olhando pelo seletor), a linha só leva à
  // ficha. Registrar ou mover a partir daqui gravaria no nome de quem está olhando:
  // a pendência da dona continuaria na fila dela, e a meta e o "Feito hoje" de quem
  // olha levariam o crédito. É a mesma regra da Agenda, que é só leitura na visão
  // da equipe. Vale também para a conversa (só chega aqui a do embaixador, que é
  // dele): responder por esta linha passaria o atendimento para quem olha
  // (`app.messages_quem_responde_atende`). Quem escreveu de fora da base não tem
  // ficha, e por isso fica sem link.
  if (somenteLeitura) {
    return item.organizacaoId
      ? { href: `/parceiros/${item.organizacaoId}`, onde: 'a ficha do parceiro' }
      : null;
  }

  // A conversa é o único item que leva para fora do par ficha/funil: o trabalho
  // é responder, e responder acontece em Conversas. É também o único que tem
  // destino SEM ficha — quem escreveu de fora da base não tem para onde mais ir.
  if (item.tipo === 'conversa_esperando') {
    return item.organizacaoId
      ? { href: `/conversas?aba=responderam&org=${item.organizacaoId}`, onde: 'a conversa' }
      : { href: '/conversas?aba=fora', onde: 'quem escreveu de fora da base' };
  }

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

/**
 * O que cada número quer dizer, em uma linha.
 *
 * "Porta batida" e "porta aberta" são jargão de captação: quem entrou no time esta
 * semana não tem como adivinhar que uma é o esforço e a outra é o resultado, e um
 * número que a pessoa não sabe ler não é informação, é enfeite. Por isso a definição
 * vai no cartão, à vista: `title` não existe no celular, que é onde esta tela mais é
 * usada, e a nota de rodapé nasce fechada — as duas escondem justamente de quem
 * ainda não sabe.
 *
 * Isto NÃO é a regra do número, e não tenta ser: a regra está no Postgres, e chega
 * escrita em `fonte`, que continua sendo o texto exato para quem precisa do critério
 * ("máx. 1 por alvo a cada 30 dias" e afins). Aqui é a leitura em português da mesma
 * regra, e as duas andam juntas — mexeu no catálogo de `goal_progress`, mexe aqui.
 *
 * Métrica sem definição no mapa aparece sem a linha, em vez de aparecer com uma
 * definição inventada.
 */
export const DEFINICAO_DA_METRICA: Record<string, string> = {
  // "Um por alvo, por dia" não é preciosismo de rodapé: sem ele, quem ligou cinco
  // vezes para o mesmo buffet lê "Portas batidas: 1" ao lado de "Ligações: 5" e
  // conclui que a tela comeu quatro.
  doors_knocked: 'Contato registrado. Um por alvo, por dia.',
  doors_opened: 'Respondeu, e quem falou decide ou influencia.',
  calls_made: 'Ligações registradas, atendidas ou não.',
  meetings_booked: 'Negócios que chegaram à etapa de reunião.',
  meetings_done: 'Reuniões que aconteceram. Furo não conta.',
  visits_done: 'Visitas registradas em campo.',
  new_targets: 'Parceiros novos com você como responsável.',
  pre_registrations: 'Negócios que entraram em "Cadastro em andamento".',
  published: 'Negócios ganhos no funil de captação.',
  replies: 'Mensagens que o parceiro respondeu.',
};

export function definicaoDaMetrica(metrica: string): string | null {
  return DEFINICAO_DA_METRICA[metrica] ?? null;
}

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
