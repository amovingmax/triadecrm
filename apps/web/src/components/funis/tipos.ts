import { z } from 'zod';

import { Constants, type DealStatus, type OrgKind, type Temperature } from '@komune/schema';

/**
 * Contrato do funil kanban (RF-FUN-01/02/03/04/08; PRD §5.3, §5.5 e §5.6).
 *
 * Este arquivo é a fronteira entre o banco e a tela: os tipos de domínio do quadro,
 * a máquina de recusa do "mover" e os schemas zod que validam o pedido ANTES de sair
 * do navegador. Ninguém mais redeclara linha de RPC, motivo de recusa ou rótulo de
 * semáforo. É o único arquivo desta pasta com dono exclusivo — os componentes
 * importam daqui e não editam nada aqui.
 *
 * ---------------------------------------------------------------------------
 * Três decisões que estão gravadas nos tipos e que valem como especificação
 * ---------------------------------------------------------------------------
 *
 * 1. **Nome de campo em inglês, nome de tipo em português.** As linhas que vêm das
 *    RPCs mantêm exatamente os nomes do Postgres (`next_action_at`, `days_in_stage`),
 *    porque o banco inteiro é em inglês desde a migração 000100 e uma camada de
 *    tradução no meio é uma segunda verdade esperando divergir. O que é nosso —
 *    tipos, funções, constantes, rótulos, comentários — é em pt-BR. É a mesma
 *    convenção de `components/parceiros/tipos.ts`.
 *
 * 2. **No celular não existe quadro.** Doze e catorze colunas não cabem em 390px, e
 *    arrastar cartão dentro de uma lista que rola verticalmente disputa o gesto de
 *    rolagem — justamente com quem está de pé, na rua, com uma mão só. Abaixo de
 *    `md` (768px) a tela é: uma trilha horizontal de etapas (nome + contagem, a atual
 *    destacada) e, embaixo, a lista vertical dos cartões daquela etapa em largura
 *    cheia. Mover é um botão no cartão que abre uma folha por baixo com as etapas do
 *    funil e os campos que a etapa exigir. É o que o RF-FUN-09 já manda ("kanban só
 *    no desktop; no celular, lista + ficha + registrar") — aqui isso vira o padrão do
 *    MVP e não uma limitação de v1. Por isso `FiltrosQuadro.etapaId` existe e entra
 *    na URL: no celular ele é a coluna visível; no desktop, um recorte opcional.
 *
 * 3. **Etapa de saída não ocupa coluna inteira.** Nutrição, Perdido e Opt-out (e
 *    Publicado, no funil 1) são destino, não trabalho: no desktop entram recolhidas
 *    numa faixa estreita no fim do quadro, continuando a receber cartão arrastado.
 *    `etapaEhDeSaida` é a regra única — a UI não repete a lista de flags.
 */

// ---------------------------------------------------------------------------
// Funis
// ---------------------------------------------------------------------------

export type FunilSlug = 'fornecedor' | 'ativacao' | 'produtor';

/**
 * Os funis que o quadro do MVP abre. Ativação fica de fora de propósito: as etapas
 * dele são consequência de eventos da plataforma Komune (publicou, recebeu lead,
 * respondeu lead, contratou), não de ação manual do time — o PRD §6 coloca "Funil 2
 * automático por eventos da Komune" na v1, e hoje ele tem zero negócios. Um quadro
 * onde ninguém pode arrastar nada ensina a pessoa errada a coisa errada.
 */
export const FUNIS_NO_QUADRO: readonly FunilSlug[] = ['fornecedor', 'produtor'];

export const FUNIL_PADRAO: FunilSlug = 'fornecedor';

export function ehFunilDoQuadro(valor: string | null | undefined): valor is FunilSlug {
  return !!valor && (FUNIS_NO_QUADRO as readonly string[]).includes(valor);
}

// ---------------------------------------------------------------------------
// Campos obrigatórios por etapa (RF-FUN-04)
// ---------------------------------------------------------------------------

/**
 * Uma entrada de `stages.required_fields`, como está na seed. O formato é aberto de
 * propósito (o gestor edita o catálogo na v1), então a UI monta o formulário a partir
 * do que vier e o banco revalida tudo em `move_deal`. Os quatro campos que o MVP sabe
 * tratar estão em `CAMPOS_CONHECIDOS`; qualquer outro é exibido como texto e viaja em
 * `p_fields` sem interpretação.
 */
export type CampoObrigatorio = {
  /** Chave em `p_fields`. Ex.: `lost_reason_id`, `meeting_at`, `authorization_evidence`. */
  field: string;
  /** Rótulo em pt-BR, já vem pronto do banco. */
  label: string;
  /** `timestamptz`, `enum`, `text`… ausente quando o campo é texto livre. */
  type?: string;
  /** Valores aceitos quando `type === 'enum'` (ex.: `['meet', 'visita']`). */
  options?: string[];
  /** Catálogo de onde sai o valor (ex.: `lost_reasons`). */
  table?: string;
  /** Espécie de consentimento gravada em `consent_events` (ex.: `data_use_authorized`). */
  consent_kind?: string;
};

/** Os campos que o `move_deal` do MVP interpreta; o resto viaja como texto. */
export const CAMPOS_CONHECIDOS = [
  'lost_reason_id',
  'meeting_at',
  'meeting_format',
  'authorization_evidence',
] as const;

/**
 * Rótulos dos formatos de reunião/demonstração. Os valores vêm de
 * `stages.required_fields[].options` (seed: `meet`/`visita` no funil 1;
 * `meet_manha`/`cafe_ou_visita_tarde`/`evento_demo_sabado` no funil 3). O banco guarda
 * o slug; o texto de tela mora aqui.
 */
export const ROTULOS_FORMATO_REUNIAO: Record<string, string> = {
  meet: 'Google Meet',
  visita: 'Visita presencial',
  meet_manha: 'Meet pela manhã',
  cafe_ou_visita_tarde: 'Café ou visita à tarde',
  evento_demo_sabado: 'Evento demo de sábado',
};

export function rotuloFormatoReuniao(slug: string): string {
  return ROTULOS_FORMATO_REUNIAO[slug] ?? slug;
}

// ---------------------------------------------------------------------------
// Semáforo da próxima ação (RF-FUN-02)
// ---------------------------------------------------------------------------

/**
 * Estado do círculo do cartão. Calculado pelo banco em `America/Fortaleza`, porque
 * "hoje" tem de ser o mesmo dia para a Heloísa no celular e para o relatório de
 * segunda — o navegador não é autoridade de fuso aqui.
 */
export type EstadoProximaAcao = 'sem' | 'hoje' | 'agendada' | 'atrasada';

export const SEMAFORO_PROXIMA_ACAO: Record<
  EstadoProximaAcao,
  { rotulo: string; descricao: string }
> = {
  sem: {
    rotulo: 'Sem próxima ação',
    descricao: 'Negócio aberto sem próxima ação marcada: define uma ou justifica (RF-FUN-03).',
  },
  hoje: { rotulo: 'Hoje', descricao: 'A próxima ação é para hoje.' },
  agendada: { rotulo: 'Agendada', descricao: 'A próxima ação tem data futura.' },
  atrasada: { rotulo: 'Atrasada', descricao: 'A próxima ação venceu e ninguém fez.' },
};

// ---------------------------------------------------------------------------
// O quadro (retorno de `public.pipeline_board`)
// ---------------------------------------------------------------------------

/**
 * Cartão do kanban. Sem telefone, sem e-mail e sem @: o quadro carrega dezenas de
 * cartões por tela e PII em lote é exatamente o que o RF-BAS-14 e o `pii_access_log`
 * existem para evitar. Quem precisa do número abre a ficha e revela lá, com registro.
 */
export type CartaoQuadro = {
  deal_id: string;
  organization_id: string;
  organization_name: string;
  primary_category: string | null;
  city: string | null;
  neighborhood: string | null;
  owner_id: string | null;
  /** Nome do responsável (`team_directory`); `null` = cartão sem dono, do bolo comum. */
  owner_name: string | null;
  temperature: Temperature;
  /** Esfriamento além do prazo do PRD §5.6: liga o pulso da barra térmica. */
  needs_attention: boolean;
  status: DealStatus;
  tier: 'A+' | 'A' | 'B' | 'C' | null;
  score: number | null;
  entered_stage_at: string;
  /** Dias inteiros na etapa atual (cabeçalho da ficha: "há quantos dias"). */
  days_in_stage: number;
  /**
   * Parado além do SLA da etapa (RF-FUN-02, fundo vermelho). Conta da última
   * atividade, não da entrada na etapa: `stages.sla_hours` é, pelo comentário da
   * própria coluna, "horas sem atividade até contar como parado". Sem atividade
   * nenhuma, conta de `entered_stage_at`. Etapa sem `sla_hours` nunca apodrece.
   */
  is_rotting: boolean;
  last_activity_at: string | null;
  /** Dias inteiros desde o último contato; `null` quando nunca houve contato. */
  days_since_contact: number | null;
  next_action: string | null;
  next_action_at: string | null;
  next_action_state: EstadoProximaAcao;
  updated_at: string;
};

/** Uma coluna do quadro: a etapa, suas regras e a página de cartões carregada. */
export type EtapaQuadro = {
  id: number;
  slug: string;
  name: string;
  position: number;
  temperature: Temperature;
  sla_hours: number | null;
  is_won: boolean;
  is_lost: boolean;
  is_dormant: boolean;
  is_optout: boolean;
  is_terminal: boolean;
  required_fields: CampoObrigatorio[];
  /** Total de negócios na etapa depois dos filtros — o número do cabeçalho da coluna. */
  total: number;
  /** Página carregada. `cards.length < total` quando a coluna foi cortada por `p_limit_per_stage`. */
  cards: CartaoQuadro[];
};

export type Quadro = {
  pipeline: { id: number; slug: FunilSlug; name: string; kind: OrgKind };
  /** Carimbo do servidor: base do "hoje" do semáforo e do rótulo "atualizado às". */
  generated_at: string;
  stages: EtapaQuadro[];
};

/**
 * Etapa de destino, não de trabalho: ganho, perda, opt-out e nutrição. No desktop
 * entram recolhidas no fim do quadro; continuam sendo alvo de soltar.
 */
export function etapaEhDeSaida(e: EtapaQuadro): boolean {
  return e.is_won || e.is_lost || e.is_dormant || e.is_terminal;
}

/**
 * Etapa que exige próxima ação ao receber o cartão (RF-FUN-03). Nas etapas de saída a
 * justificativa é a própria etapa — perdido com motivo, opt-out, publicado, nutrição —
 * e pedir "e agora, o que você faz?" ali seria burocracia sem uso.
 */
export function etapaExigeProximaAcao(e: EtapaQuadro): boolean {
  return !etapaEhDeSaida(e);
}

/** Etapa que exige motivo da lista fechada (RF-FUN-04): perda que não é opt-out. */
export function etapaExigeMotivoDePerda(e: EtapaQuadro): boolean {
  return e.is_lost && !e.is_optout;
}

/**
 * Quais campos obrigatórios da etapa ainda faltam no formulário. Mesma regra que o
 * banco reaplica em `move_deal`: valor ausente, nulo, string vazia ou só espaços não
 * conta. A UI usa para não deixar o botão habilitar; o banco usa para não confiar na UI.
 */
export function camposFaltando(
  etapa: Pick<EtapaQuadro, 'required_fields'>,
  campos: Record<string, unknown> | null | undefined,
): CampoObrigatorio[] {
  const dados = campos ?? {};
  return etapa.required_fields.filter((c) => {
    const v = dados[c.field];
    if (v === undefined || v === null) return true;
    if (typeof v === 'string') return v.trim() === '';
    return false;
  });
}

// ---------------------------------------------------------------------------
// Histórico de etapas (retorno de `public.deal_stage_timeline`, RF-FUN-08)
// ---------------------------------------------------------------------------

export type ItemHistoricoEtapa = {
  id: number;
  changed_at: string;
  from_stage_id: number | null;
  from_stage_name: string | null;
  to_stage_id: number;
  to_stage_name: string;
  /** `null` = automação, IA ou sistema (o histórico guarda isso desde a migração 000300). */
  changed_by: string | null;
  changed_by_name: string | null;
  reason: string | null;
};

// ---------------------------------------------------------------------------
// Mover o cartão (retorno de `public.move_deal`)
// ---------------------------------------------------------------------------

/**
 * Toda recusa do `move_deal` tem nome. A tela nunca inventa texto de erro a partir da
 * mensagem do Postgres: casa o motivo com `MENSAGENS_RECUSA_MOVER` e, quando é
 * `campos_obrigatorios`, reabre o formulário com `missing` em vermelho.
 */
export type MotivoRecusaMover =
  /** O negócio não existe, foi apagado ou a RLS não mostra para quem pediu. */
  | 'negocio_nao_encontrado'
  /** Papel sem escrita (leitura, financeiro) ou embaixador mexendo em carteira alheia. */
  | 'sem_permissao'
  /** A etapa de destino pertence a outro funil. Erro de programa, não de quem usa. */
  | 'etapa_de_outro_funil'
  /** Soltou o cartão na coluna de onde ele saiu: nada a fazer. */
  | 'etapa_igual'
  /** Outra pessoa moveu o cartão antes (conferido contra `p_expected_stage_id`). */
  | 'etapa_mudou'
  /** Faltou campo exigido pela etapa (RF-FUN-04). `missing` diz quais. */
  | 'campos_obrigatorios'
  /** Motivo de perda ausente ou fora da lista fechada `lost_reasons` (RF-FUN-04). */
  | 'motivo_de_perda_invalido'
  /** Etapa de trabalho sem próxima ação e sem justificativa (RF-FUN-03). */
  | 'proxima_acao_obrigatoria'
  /** Próxima ação marcada para uma data que já passou. */
  | 'proxima_acao_no_passado';

export const MENSAGENS_RECUSA_MOVER: Record<MotivoRecusaMover, string> = {
  negocio_nao_encontrado: 'Este negócio não está mais disponível para você.',
  sem_permissao: 'Seu perfil não move negócios desta carteira.',
  etapa_de_outro_funil: 'Esta etapa é de outro funil.',
  etapa_igual: 'O cartão já estava nesta etapa.',
  etapa_mudou: 'Alguém moveu este cartão antes de você. O quadro foi atualizado.',
  campos_obrigatorios: 'Faltam informações para entrar nesta etapa.',
  motivo_de_perda_invalido: 'Escolha um motivo da lista para marcar como perdido.',
  proxima_acao_obrigatoria: 'Diga qual é a próxima ação antes de mover o cartão.',
  proxima_acao_no_passado: 'A próxima ação precisa ter data de hoje em diante.',
};

export type ResultadoMover =
  | {
      ok: true;
      /** O cartão já recalculado (etapa, temperatura, semáforo): a UI reconcilia com isto. */
      card: CartaoQuadro;
      from_stage_id: number;
      to_stage_id: number;
      /** `true` quando o negócio estava sem dono e passou a ser de quem moveu (RF-CON-04). */
      claimed: boolean;
      /** Id da tarefa criada a partir da próxima ação, quando houve. */
      task_id: string | null;
    }
  | {
      ok: false;
      reason: MotivoRecusaMover;
      /** Preenchido só em `campos_obrigatorios`. */
      missing?: CampoObrigatorio[];
      /** Etapa em que o cartão realmente está, em `etapa_mudou`. */
      current_stage_id?: number;
    };

// ---------------------------------------------------------------------------
// Schemas zod de entrada — validam antes de sair do navegador
// ---------------------------------------------------------------------------

const dataHoraIso = z.iso.datetime({
  offset: true,
  error: 'Data e hora inválidas (use ISO 8601 com fuso).',
});

/** Tipos de tarefa do banco (`app.task_kind`), montados a partir do enum gerado. */
export const tipoProximaAcaoSchema = z.enum(Constants.app.Enums.task_kind);
export type TipoProximaAcao = z.infer<typeof tipoProximaAcaoSchema>;

export const ROTULOS_TIPO_PROXIMA_ACAO: Record<TipoProximaAcao, string> = {
  call: 'Ligar',
  visit: 'Visitar',
  meeting: 'Reunião',
  message: 'Mandar mensagem',
  follow_up: 'Follow-up',
  other: 'Outra',
};

/**
 * Próxima ação exigida ao mover (RF-FUN-03). Vira `deals.next_action` /
 * `deals.next_action_at` e uma linha em `tasks` para o dono do negócio.
 *
 * A data é validada por dia, não por instante: "hoje às 09:00" continua valendo às
 * 14:00, senão a regra viraria uma armadilha para quem registra a visita depois de
 * fazê-la. O corte do dia é o do navegador; o banco reaplica em `America/Fortaleza`,
 * que é a autoridade.
 */
export const proximaAcaoSchema = z.object({
  kind: tipoProximaAcaoSchema,
  label: z
    .string({ error: 'Escreva a próxima ação.' })
    .transform((v) => v.replace(/\s+/g, ' ').trim())
    .refine((v) => v.length >= 3, { error: 'Escreva a próxima ação (ao menos 3 letras).' })
    .refine((v) => v.length <= 120, { error: 'Deixe a próxima ação em até 120 caracteres.' }),
  at: dataHoraIso.refine(
    (v) => {
      const alvo = new Date(v);
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      return alvo.getTime() >= hoje.getTime();
    },
    { error: 'A próxima ação precisa ter data de hoje em diante.' },
  ),
});
export type ProximaAcao = z.infer<typeof proximaAcaoSchema>;

/**
 * Os campos exigidos pela etapa (RF-FUN-04). Conhece os quatro do MVP e deixa passar
 * o que o gestor acrescentar depois (`catchall`), porque o catálogo é editável na v1 e
 * a validação de verdade é a do banco.
 */
export const camposEtapaSchema = z
  .object({
    lost_reason_id: z.number({ error: 'Escolha um motivo da lista.' }).int().positive().optional(),
    meeting_at: dataHoraIso.optional(),
    meeting_format: z.string().min(1).optional(),
    authorization_evidence: z
      .string()
      .transform((v) => v.trim())
      .refine((v) => v.length >= 10, {
        error: 'Registre a evidência da autorização (texto literal do que a pessoa disse).',
      })
      .optional(),
  })
  .catchall(z.union([z.string(), z.number(), z.boolean(), z.null()]));
export type CamposEtapa = z.infer<typeof camposEtapaSchema>;

/**
 * Pedido de `public.move_deal`. Os nomes são os parâmetros da RPC, para o objeto ir
 * direto em `supabase.rpc('move_deal', pedido)`.
 */
export const moverNegocioSchema = z.object({
  p_deal_id: z.uuid({ error: 'Negócio inválido.' }),
  p_to_stage_id: z.number({ error: 'Escolha a etapa de destino.' }).int().positive(),
  /** Etapa em que a UI acredita que o cartão está: guarda contra duas pessoas arrastando. */
  p_expected_stage_id: z.number().int().positive().nullish(),
  /** Motivo livre da mudança; vai para `deal_stage_history.reason` (RF-FUN-08). */
  p_reason: z
    .string()
    .transform((v) => v.replace(/\s+/g, ' ').trim())
    .refine((v) => v.length <= 300, { error: 'Deixe o motivo em até 300 caracteres.' })
    .nullish()
    .transform((v) => (v ? v : null)),
  p_fields: camposEtapaSchema.nullish().transform((v) => v ?? {}),
  p_next_action: proximaAcaoSchema.nullish().transform((v) => v ?? null),
});
export type PedidoMover = z.infer<typeof moverNegocioSchema>;

/** Pedido de `public.pipeline_board`. */
export const pedidoQuadroSchema = z.object({
  p_pipeline_id: z.number().int().positive(),
  /** Só os negócios de quem está logado (o botão "meus/todos" do RF-FUN-01). */
  p_only_mine: z.boolean().default(false),
  /** Recorte por responsável (gestor olhando a carteira de alguém). Ignorado com `p_only_mine`. */
  p_owner_id: z.uuid().nullish(),
  /** Busca por nome do parceiro dentro do quadro. */
  p_q: z.string().nullish(),
  /** Só esta etapa devolve cartões; as demais vêm só com `total` (é o modo do celular). */
  p_stage_id: z.number().int().positive().nullish(),
  p_limit_per_stage: z.number().int().min(1).max(200).default(40),
  /** Paginação dentro de uma etapa; só faz sentido junto de `p_stage_id`. */
  p_offset: z.number().int().min(0).default(0),
});
export type PedidoQuadro = z.infer<typeof pedidoQuadroSchema>;

/** Cartões carregados por coluna antes de "Carregar mais". */
export const CARTOES_POR_ETAPA = 40;

// ---------------------------------------------------------------------------
// Estado do quadro na URL
// ---------------------------------------------------------------------------

export type FiltrosQuadro = {
  funil: FunilSlug;
  /** Botão "meus/todos" (RF-FUN-01). */
  apenasMeus: boolean;
  /** Busca por nome dentro do quadro. */
  q: string;
  /** No celular, a etapa aberta; no desktop, um recorte opcional. */
  etapaId: number | null;
};

export const FILTROS_QUADRO_PADRAO: FiltrosQuadro = {
  funil: FUNIL_PADRAO,
  apenasMeus: false,
  q: '',
  etapaId: null,
};

/** Lê os filtros da query string (no servidor, a partir de `searchParams`). */
export function filtrosQuadroDaUrl(
  params: Record<string, string | string[] | undefined>,
): FiltrosQuadro {
  const texto = (chave: string): string => {
    const v = params[chave];
    return typeof v === 'string' ? v : '';
  };
  const inteiro = (chave: string): number | null => {
    const n = Number.parseInt(texto(chave), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const funil = texto('funil');

  return {
    funil: ehFunilDoQuadro(funil) ? funil : FUNIL_PADRAO,
    apenasMeus: texto('meus') === '1',
    q: texto('q'),
    etapaId: inteiro('etapa'),
  };
}

/** Escreve os filtros na query string, omitindo o que está no padrão. */
export function urlDosFiltrosQuadro(f: FiltrosQuadro): string {
  const p = new URLSearchParams();
  if (f.funil !== FUNIL_PADRAO) p.set('funil', f.funil);
  if (f.apenasMeus) p.set('meus', '1');
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.etapaId) p.set('etapa', String(f.etapaId));
  const busca = p.toString();
  return busca ? `?${busca}` : '';
}

/** Há algum recorte ligado? Separa "a etapa está vazia" de "o filtro não achou nada". */
export function temRecorteNoQuadro(f: FiltrosQuadro): boolean {
  return f.apenasMeus || f.q.trim() !== '';
}

/** Chave de cache do TanStack Query: muda quando qualquer recorte muda. */
export function chaveDoQuadro(f: FiltrosQuadro) {
  return ['funil-quadro', f.funil, f.apenasMeus, f.q.trim(), f.etapaId] as const;
}
