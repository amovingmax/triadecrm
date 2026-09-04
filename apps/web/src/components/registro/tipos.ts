import { z } from 'zod';

import {
  type AppEnum,
  type Channel,
  type ActivityType,
  Constants,
  type TaskKind,
  type Tables,
  type Temperature,
} from '@komune/schema';

/**
 * Contrato da tela de registrar contato (RF-MET-06, RF-FUN-03, RF-FUN-12, RF-FUN-13;
 * PRD §5.6; `docs/design/spec-desfechos-de-interacao.md`).
 *
 * Este arquivo é a fronteira entre o catálogo de desfechos que já vive no banco e a
 * tela que a Heloísa usa de pé, na rua, com uma mão só. Ele tem dono exclusivo: os
 * componentes de `components/registro/**` e a rota `(app)/registrar/**` importam daqui
 * e não editam nada aqui.
 *
 * ===========================================================================
 * O PROBLEMA, EM UMA FRASE
 * ===========================================================================
 * A base tem 100 organizações reais e todas aparecem "Frio, sem contato" porque não
 * existe nenhum lugar no CRM onde alguém diga o que aconteceu numa conversa. A
 * temperatura não está quebrada: está sem entrada de dado. Foi medido no banco local:
 *
 *   - `insert into activities` como `sdr` FUNCIONA e dispara `app.activities_apply_outcome`
 *     (grava `door_opened`, `door_knocked`, `cooldown_until` em `metadata`);
 *   - mas o negócio continua FRIO, porque `app.compute_temperature` lê ETAPA, INTENÇÃO,
 *     RECÊNCIA e STATUS — e a atividade sozinha só move a recência
 *     (`app.activities_touch_deal` atualiza `deals.last_activity_at` e nada mais);
 *   - e `update public.deals set stage_id = …` como `sdr` devolve **UPDATE 0**, em
 *     silêncio: a política `deals_update` é `is_manager() or owner_id = auth.uid()`, e
 *     os 100 negócios estão com `owner_id` nulo.
 *
 * Ou seja: gravar direto na tabela registra a visita e não move a coluna-assinatura do
 * produto. O que fecha o circuito é a RPC `public.move_deal` (migração 20260904000900, do
 * kanban), que já move a etapa com as validações do RF-FUN-03/04, grava histórico,
 * consentimento e a tarefa da próxima ação — e, na única ampliação que ela declara,
 * **assume para quem move o negócio sem dono**. Medido em sequência, como `sdr`:
 * `insert into activities` → `move_deal(… em_conversa …)` leva o negócio de **frio a
 * morno**, e como o `move_deal` deixou a Heloísa como dona, o `update deals set
 * last_intent = 'interessado'` seguinte passa na política e a regra do banco devolve
 * **quente**. Nada disso reimplementa `app.compute_temperature`: só alimenta as entradas
 * que ela já lê (etapa, intenção, recência).
 *
 * `public.registrar_contato` (migração `20260904001100_registro_de_contato.sql`) é, por
 * isso, uma casca fina e `security invoker`: grava a atividade sob a RLS que já existe,
 * delega o lado do negócio ao `move_deal` e devolve tudo numa resposta só. Ela existe
 * pela transação e pela ida-e-volta única — na calçada, duas chamadas são dois lugares
 * onde o registro morre pela metade —, não por regra nova.
 *
 * ===========================================================================
 * AS QUATRO DECISÕES QUE ESTÃO GRAVADAS NOS TIPOS
 * ===========================================================================
 *
 * 1. **Três toques gravam.** Parceiro → canal → desfecho. Não existe botão "Salvar":
 *    o toque no desfecho é o commit. Tudo o mais (com quem falou, próxima ação, data,
 *    observação) é DERIVADO do catálogo e fica editável depois, num toque, na tela de
 *    recibo. Cada campo a mais é um registro que não acontece.
 *
 * 2. **Quatro desfechos, e só quatro, custam um toque a mais** — e cada um por um
 *    motivo que não é burocracia (`extraDoDesfecho`): os 6 de perda pedem o motivo
 *    (RF-FUN-04, e `app.deals_before_write` recusa sem ele); os 2 de reunião agendada
 *    pedem data e formato (é o `required_fields` da etapa `reuniao_marcada`, e uma
 *    reunião sem data não é reunião); `reu_autorizou` pede a evidência literal da
 *    autorização (guardrail de LGPD: pré-cadastro só depois de `consent_events`); os 2
 *    de opt-out pedem confirmação, porque não têm volta (RF-CON-18).
 *
 * 3. **A janela de desfazer substitui o botão de salvar.** O toque no desfecho pinta o
 *    recibo com a PREVISÃO calculada aqui no cliente (`preverRegistro`) e segura o envio
 *    por `ESPERA_DESFAZER_MS`. Quem some da tela, envia. Isso existe porque `sdr` não
 *    tem `delete` em `activities` (política `activities_delete` é só admin): depois de
 *    gravado não há desfazer de verdade, e prometer um seria mentira. O que ela PODE
 *    fazer depois é editar a própria atividade (`activities_update` aceita
 *    `user_id = auth.uid()`), e é assim que a observação entra sem atrapalhar os 20 s.
 *
 * 4. **A previsão é chute educado; o banco é a verdade.** `PrevisaoRegistro` e
 *    `ResultadoRegistro` são tipos separados de propósito. A tela mostra a previsão em
 *    ~120 ms e a troca pelo resultado quando ele chega. Quando divergem, vale o
 *    resultado, sem animação de correção — e a divergência vira log, não susto.
 */

// ---------------------------------------------------------------------------
// Superfícies
// ---------------------------------------------------------------------------

/**
 * Superfície de interação, como o banco a define em `app.interaction_surface`, menos
 * `triagem` — que está reservada no enum para os motivos de descarte da caixa de
 * triagem (D4) e não é canal de conversa nenhum.
 */
export type Superficie = Exclude<AppEnum<'interaction_surface'>, 'triagem'>;

/**
 * A ordem dos chips de canal na tela. NÃO é a ordem do catálogo (que agrupa por
 * `position` 101, 201, 301…): é a ordem de frequência de quem está na rua. A Heloísa
 * registra visita e ligação muito mais do que reunião, e o chip mais provável precisa
 * ficar debaixo do polegar.
 */
export const SUPERFICIES_DO_REGISTRO = [
  'visita',
  'ligacao',
  'whatsapp',
  'instagram_dm',
  'reuniao',
] as const satisfies readonly Superficie[];

export const ROTULOS_SUPERFICIE: Record<Superficie, string> = {
  visita: 'Visita',
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  instagram_dm: 'DM',
  reuniao: 'Reunião',
};

/**
 * O par (tipo, canal) que cada superfície produz — o inverso de
 * `app.interaction_surface(p_channel, p_type)`.
 *
 * A tela manda a SUPERFÍCIE e a RPC deriva o par: mandar os dois seria pedir à
 * interface que acertasse uma combinação que o gatilho `activities_apply_outcome`
 * revalida e recusa (`Desfecho % não vale para a superfície %`). O mapa mora aqui
 * porque a previsão do cliente precisa dele e porque é o que o teste de paridade
 * com o SQL compara.
 */
export const PAR_DA_SUPERFICIE: Record<Superficie, { tipo: ActivityType; canal: Channel }> = {
  whatsapp: { tipo: 'message', canal: 'whatsapp' },
  ligacao: { tipo: 'call', canal: 'phone' },
  visita: { tipo: 'visit', canal: 'presencial' },
  reuniao: { tipo: 'meeting', canal: 'presencial' },
  instagram_dm: { tipo: 'message', canal: 'instagram' },
};

/** Teto do catálogo (spec §3): acima de 8 chips por superfície ninguém tabula em 20 s. */
export const TETO_DESFECHOS_POR_SUPERFICIE = 8;

// ---------------------------------------------------------------------------
// O catálogo, como a tela o enxerga
// ---------------------------------------------------------------------------

/**
 * Uma linha de `public.interaction_outcomes`, restrita ao que a tela usa. Vem do
 * servidor já filtrada por `is_active` e ordenada por `position`; `sdr` tem `select`
 * no catálogo (política `interaction_outcomes_select … using (true)`), então isso é
 * leitura direta da tabela, sem RPC.
 */
export type DesfechoCatalogo = Pick<
  Tables<'interaction_outcomes'>,
  | 'id'
  | 'slug'
  | 'name'
  | 'surfaces'
  | 'position'
  | 'cooldown_days'
  | 'can_reactivate'
  | 'next_action_kind'
  | 'next_action_label'
  | 'next_action_offset_days'
  | 'target_stage_slug'
  | 'sets_temperature'
  | 'requires_lost_reason'
  | 'counts_as'
>;

/** As colunas que a tela lê do catálogo, na forma exata do `select` do PostgREST. */
export const COLUNAS_DESFECHO =
  'id, slug, name, surfaces, position, cooldown_days, can_reactivate, next_action_kind, next_action_label, next_action_offset_days, target_stage_slug, sets_temperature, requires_lost_reason, counts_as' as const;

/** Os desfechos de uma superfície, na ordem do catálogo. Nunca mais que 8. */
export function desfechosDaSuperficie(
  catalogo: readonly DesfechoCatalogo[],
  superficie: Superficie,
): DesfechoCatalogo[] {
  return catalogo
    .filter((d) => (d.surfaces as readonly string[]).includes(superficie))
    .sort((a, b) => a.position - b.position);
}

/**
 * O que ainda pode ser registrado sobre quem pediu para NÃO ser contatado.
 *
 * O guardrail do CLAUDE.md é "nenhum envio a contato suprimido, em nenhum modo", e
 * registrar um desfecho é o começo de um envio: 26 dos 34 desfechos criam a próxima
 * ação, e a tarefa criada devolve à fila do Meu dia exatamente quem pediu para sair.
 * Foi o que aconteceu com o DJ Zone Natal RN: "Enviado, sem resposta" gerou o
 * "Follow-up D+3". Além disso, "Interessado" ou "Reunião marcada" num parceiro
 * suprimido é o registro de um contato ativo que não podia ter existido.
 *
 * A regra é lida do próprio catálogo, e não de uma lista de slugs em código, porque o
 * gestor edita o catálogo (RF-ADM-02). Sobra o que é ao mesmo tempo:
 *
 * - `counts_as = 'nenhuma'` — não conta como tentativa de contato na meta (RF-MET-01);
 * - `next_action_kind is null` — não cria tarefa, então não devolve ninguém para a fila;
 * - `can_reactivate = false` — não reabre a janela de recontato (RF-FUN-13).
 *
 * No catálogo de hoje sobram três: "Pediu para parar" (WhatsApp e DM), que é o próprio
 * registro do pedido, e "Perfil inativo, não fornece" na DM, que é higiene de base.
 * Ligação, visita e reunião ficam sem nenhum — e é isso mesmo: não há desfecho honesto
 * para uma ligação que não podia ter sido feita.
 *
 * A tela é a primeira barreira, não a única: `public.registrar_contato` também recusa.
 */
export function valeParaQuemPediuParar(desfecho: DesfechoCatalogo): boolean {
  return (
    desfecho.counts_as === 'nenhuma' &&
    desfecho.next_action_kind === null &&
    !desfecho.can_reactivate
  );
}

/**
 * Os desfechos que a tela oferece para um parceiro, já filtrados pela superfície e
 * pelo `do_not_contact`. É por aqui que passo 2 e commit perguntam a mesma coisa.
 */
export function desfechosOferecidos(
  catalogo: readonly DesfechoCatalogo[],
  superficie: Superficie,
  naoContatar: boolean,
): DesfechoCatalogo[] {
  const daSuperficie = desfechosDaSuperficie(catalogo, superficie);
  return naoContatar ? daSuperficie.filter(valeParaQuemPediuParar) : daSuperficie;
}

/** Um motivo de perda (`public.lost_reasons`), para os 6 desfechos que o exigem. */
export type MotivoPerda = Pick<Tables<'lost_reasons'>, 'id' | 'slug' | 'name'>;

// ---------------------------------------------------------------------------
// Com quem ela falou (RF-MET-01: é isso que separa porta batida de porta aberta)
// ---------------------------------------------------------------------------

export type ComQuem = 'decisor' | 'influenciador' | 'funcionario' | 'ninguem' | 'nao_informado';

export const ROTULOS_COM_QUEM: Record<ComQuem, string> = {
  decisor: 'O dono / decisor',
  influenciador: 'Quem influencia a decisão',
  funcionario: 'Funcionário',
  ninguem: 'Ninguém',
  nao_informado: 'Não sei dizer',
};

/**
 * Os valores que o gatilho `app.activities_apply_outcome` aceita como porta aberta:
 * `aberta := counts_as = 'aberta' and metadata->>'com_quem' in ('decisor','influenciador')`.
 */
export const COM_QUEM_ABRE_PORTA: readonly ComQuem[] = ['decisor', 'influenciador'];

/**
 * O padrão de "com quem falou", derivado do próprio desfecho.
 *
 * A regra é uma só e vale a pena escrevê-la: **o padrão é o que o nome do desfecho já
 * afirma; onde o nome não afirma nada, o padrão é `nao_informado`.** RF-MET-01 exige que
 * o formulário DIGA decisor ou influenciador para contar porta aberta — chutar `decisor`
 * em "Respondeu" seria fabricar essa afirmação e inflar a meta. `nao_informado` grava
 * porta batida, que é honesto, e a tela oferece a correção num toque.
 *
 * Só os slugs que afirmam entram no mapa. Os 10 que faltam (`wa_respondeu`, `wa_agora_nao`,
 * `wa_nao_firme`, `lig_atendeu_retorna`, `lig_interessado`, `lig_agora_nao`,
 * `lig_sem_interesse`, `lig_reuniao_marcada`, `dm_respondeu`, `dm_pediu_whatsapp`) são
 * exatamente os que `perguntaComQuem` marca para o toque opcional do recibo.
 */
export const COM_QUEM_AFIRMADO_PELO_DESFECHO: Readonly<Record<string, ComQuem>> = {
  // Ninguém do outro lado.
  wa_sem_resposta: 'ninguem',
  wa_numero_invalido: 'ninguem',
  wa_optout: 'ninguem',
  lig_nao_atendeu: 'ninguem',
  lig_caixa_postal: 'ninguem',
  lig_numero_errado: 'ninguem',
  vis_nao_estava: 'ninguem',
  reu_no_show: 'ninguem',
  dm_sem_resposta: 'ninguem',
  dm_perfil_inativo: 'ninguem',
  dm_optout: 'ninguem',
  // Falou, mas não com quem decide.
  wa_nao_e_a_pessoa: 'funcionario',
  dm_nao_e_a_pessoa: 'funcionario',
  vis_funcionario: 'funcionario',
  // O nome do desfecho diz "decisor", ou a reunião só acontece com ele.
  vis_decisor_interessado: 'decisor',
  vis_decisor_agora_nao: 'decisor',
  vis_decisor_recusou: 'decisor',
  vis_cadastro_iniciado: 'decisor',
  vis_sem_perfil: 'decisor',
  reu_interessado: 'decisor',
  reu_autorizou: 'decisor',
  reu_objecao: 'decisor',
  reu_nao: 'decisor',
  reu_reagendada: 'decisor',
};

export function comQuemPadrao(desfecho: DesfechoCatalogo): ComQuem {
  return COM_QUEM_AFIRMADO_PELO_DESFECHO[desfecho.slug] ?? 'nao_informado';
}

/**
 * A tela só pergunta "com quem você falou?" quando a resposta muda a métrica: o
 * desfecho tem teto de porta aberta (`counts_as = 'aberta'`) e o nome dele não afirma
 * o interlocutor. Nos outros 24 casos a pergunta é ruído.
 */
export function perguntaComQuem(desfecho: DesfechoCatalogo): boolean {
  return desfecho.counts_as === 'aberta' && !(desfecho.slug in COM_QUEM_AFIRMADO_PELO_DESFECHO);
}

/** Espelha o cálculo do gatilho, para a previsão do cliente. */
export function preveePortaAberta(desfecho: DesfechoCatalogo, comQuem: ComQuem): boolean {
  return desfecho.counts_as === 'aberta' && COM_QUEM_ABRE_PORTA.includes(comQuem);
}

// ---------------------------------------------------------------------------
// O único ramo do fluxo: os quatro desfechos que pedem um campo a mais
// ---------------------------------------------------------------------------

/** Os dois desfechos de opt-out: `consent_events` faz o resto e não há volta (RF-CON-18). */
export const SLUGS_OPTOUT = ['wa_optout', 'dm_optout'] as const;

/**
 * Os dois desfechos que agendam reunião de verdade. A etapa `reuniao_marcada` traz
 * `required_fields = [meeting_at, meeting_format]` na seed — quem move para lá sem data
 * está mentindo para a agenda. Note que `lig_interessado` e `vis_decisor_interessado`
 * NÃO entram: "marcar apresentação" é tarefa a fazer, não compromisso marcado.
 */
export const SLUGS_REUNIAO_AGENDADA = ['lig_reuniao_marcada', 'reu_reagendada'] as const;

/**
 * O desfecho que produz autorização. Sem `consent_events` gravado, o pré-cadastro na
 * Komune não pode acontecer (guardrail do CLAUDE.md e `required_fields` da etapa
 * `autorizou`), então a evidência literal é pedida no ato, enquanto ela lembra a frase.
 */
export const SLUG_AUTORIZACAO = 'reu_autorizou' as const;

export type ExtraDoDesfecho = 'motivo_perda' | 'reuniao' | 'autorizacao' | 'confirmar_optout';

/**
 * O passo extra de um desfecho, ou `null` para os 25 que não têm nenhum. É a única
 * ramificação do fluxo: tudo o que não cair aqui grava em três toques.
 */
export function extraDoDesfecho(desfecho: DesfechoCatalogo): ExtraDoDesfecho | null {
  if ((SLUGS_OPTOUT as readonly string[]).includes(desfecho.slug)) return 'confirmar_optout';
  if (desfecho.requires_lost_reason) return 'motivo_perda';
  if ((SLUGS_REUNIAO_AGENDADA as readonly string[]).includes(desfecho.slug)) return 'reuniao';
  if (desfecho.slug === SLUG_AUTORIZACAO) return 'autorizacao';
  return null;
}

/** Formatos de reunião aceitos por funil (`stages.required_fields[].options` da seed). */
export const FORMATOS_REUNIAO: Record<string, string> = {
  meet: 'Google Meet',
  visita: 'Visita presencial',
  meet_manha: 'Meet pela manhã',
  cafe_ou_visita_tarde: 'Café ou visita à tarde',
  evento_demo_sabado: 'Evento demo de sábado',
};

// ---------------------------------------------------------------------------
// A próxima ação: sugerida pelo catálogo, aceita sem toque, mudada com um
// ---------------------------------------------------------------------------

/**
 * A tela NUNCA pergunta "quer criar uma próxima ação?". O catálogo já respondeu: os 26
 * desfechos com `next_action_kind` criam uma; os 8 terminais (as 6 perdas e os 2
 * opt-outs) não criam nenhuma, e o próprio desfecho é a justificativa que o RF-FUN-03
 * exige para um negócio ficar sem próxima ação.
 */
export function temProximaAcao(desfecho: DesfechoCatalogo): boolean {
  return desfecho.next_action_kind !== null;
}

/**
 * Os três desfechos cuja data a tela precisa PERGUNTAR, porque o mundo já a decidiu e
 * inventar uma seria errado: "ligar na data combinada" e as duas reuniões agendadas.
 * Nos outros 23 a data sai da regra abaixo e ela nem vê o seletor.
 */
export const SLUGS_QUE_PEDEM_DATA = [
  'lig_atendeu_retorna',
  ...SLUGS_REUNIAO_AGENDADA,
] as const satisfies readonly string[];

export function pedeDataDaProximaAcao(desfecho: DesfechoCatalogo): boolean {
  return (SLUGS_QUE_PEDEM_DATA as readonly string[]).includes(desfecho.slug);
}

/**
 * Dias que a próxima ação espera quando `next_action_offset_days` é nulo: a régua de
 * RF-MET-06 aplicada à temperatura RESULTANTE (D+1 quente, D+3 morno, D+7 frio).
 */
export const ESPERA_POR_TEMPERATURA: Record<Temperature, number> = {
  quente: 1,
  morno: 3,
  frio: 7,
  cliente: 7,
  cliente_ativo: 7,
};

/** Hora padrão da próxima ação, em `America/Fortaleza`. Começo do expediente. */
export const HORA_DA_PROXIMA_ACAO = 9;

/**
 * Quando o desfecho manda responder "em 15 min" (`next_action_offset_days = 0`), a
 * tarefa vence daqui a 15 minutos e não amanhã de manhã.
 */
export const MINUTOS_RESPOSTA_IMEDIATA = 15;

/** Feriado como o banco guarda em `public.holidays.date`: `YYYY-MM-DD`. */
export type Feriado = string;

const FUSO = 'America/Fortaleza';

/** O dia civil de um instante, em Fortaleza, como `YYYY-MM-DD`. */
export function diaEmFortaleza(quando: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(quando);
}

/** `YYYY-MM-DD` -> meia-noite UTC do mesmo dia civil (aritmética de calendário, sem fuso). */
function meioDiaUtc(dia: string): number {
  const [a = 1970, m = 1, d = 1] = dia.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}

function somarDias(dia: string, dias: number): string {
  return new Date(meioDiaUtc(dia) + dias * 86_400_000).toISOString().slice(0, 10);
}

function ehFimDeSemana(dia: string): boolean {
  const semana = new Date(meioDiaUtc(dia)).getUTCDay();
  return semana === 0 || semana === 6;
}

/**
 * Empurra para o próximo dia útil (Fortaleza), pulando sábado, domingo e feriado.
 *
 * Contraste deliberado com `app.next_business_day`, que CONTA dias úteis: contar 30
 * dias úteis a partir de 04/09/2026 cai em 20/10, quase seis semanas depois — e o
 * "reativar em D+30" do catálogo passa a não bater com o `cooldown_days = 30`, que é
 * corrido. Aqui a espera é sempre em dias CORRIDOS (a mesma unidade do cooldown) e só
 * o pouso é ajustado. Com isso vale uma propriedade que a fila do RF-CON-08 depende:
 * a próxima ação nunca cai antes do fim do cooldown.
 */
export function proximoDiaUtil(dia: string, feriados: readonly Feriado[]): string {
  let d = dia;
  for (let i = 0; i < 14; i += 1) {
    if (!ehFimDeSemana(d) && !feriados.includes(d)) return d;
    d = somarDias(d, 1);
  }
  return d;
}

/** Monta o instante ISO de um dia às `HORA_DA_PROXIMA_ACAO` em Fortaleza (UTC−3, sem horário de verão). */
export function instanteEmFortaleza(dia: string, hora = HORA_DA_PROXIMA_ACAO): string {
  return `${dia}T${String(hora).padStart(2, '0')}:00:00-03:00`;
}

/**
 * A data sugerida para a próxima ação. `null` quando o desfecho é terminal (sem próxima
 * ação) ou quando ele pede que a data venha da pessoa (`SLUGS_QUE_PEDEM_DATA`).
 */
export function prazoSugerido(
  desfecho: DesfechoCatalogo,
  ocorridoEm: Date,
  temperaturaPrevista: Temperature,
  feriados: readonly Feriado[],
): string | null {
  if (!temProximaAcao(desfecho) || pedeDataDaProximaAcao(desfecho)) return null;

  const espera = desfecho.next_action_offset_days ?? ESPERA_POR_TEMPERATURA[temperaturaPrevista];
  if (espera === 0) {
    return new Date(ocorridoEm.getTime() + MINUTOS_RESPOSTA_IMEDIATA * 60_000).toISOString();
  }
  const alvo = somarDias(diaEmFortaleza(ocorridoEm), espera);
  return instanteEmFortaleza(proximoDiaUtil(alvo, feriados));
}

// ---------------------------------------------------------------------------
// Previsão do resultado (só para a tela; o banco é a autoridade)
// ---------------------------------------------------------------------------

/**
 * As etapas de destino do catálogo, com a temperatura que a etapa carrega no funil
 * `fornecedor`. Vem do servidor junto com o catálogo (`stages` é legível por todos os
 * papéis) e existe por um motivo concreto: **5 dos 9 `target_stage_slug` não existem no
 * funil `produtor`** (`em_conversa`, `reuniao_marcada`, `apresentacao_realizada`,
 * `autorizou`, `cadastro_em_andamento`), que é a metade da base (50 cerimonialistas).
 * Nesses casos a RPC grava a atividade, NÃO move a etapa e devolve
 * `etapa_aplicada: false`; a tela diz "registrado — a etapa deste funil não muda por
 * este desfecho" em vez de mentir uma promoção que não houve.
 */
export type EtapaAlvo = {
  pipelineId: number;
  slug: string;
  nome: string;
  temperatura: Temperature;
};

export type PrevisaoRegistro = {
  /** Etapa para onde o desfecho leva, se ela existir no funil deste negócio. */
  etapaDestino: EtapaAlvo | null;
  /** Temperatura que a tela mostra no recibo. */
  temperatura: Temperature;
  /** `true` quando a etapa muda de fato. */
  moveEtapa: boolean;
  portaAberta: boolean;
  /** Fim da janela de recontato (`occurred_at + cooldown_days`), RF-FUN-13. */
  cooldownAte: string;
  /** Permanente: `cooldown_days = 36500`. */
  cooldownPermanente: boolean;
  /** `null` quando o desfecho é terminal ou quando a data ainda vai ser pedida. */
  proximaAcaoEm: string | null;
  proximaAcaoTitulo: string | null;
  proximaAcaoTipo: TaskKind | null;
};

/**
 * O que a tela pinta antes da resposta do servidor.
 *
 * Sobre a temperatura: ela NÃO é recalculada aqui. `app.compute_temperature` continua
 * sendo a regra (PRD §5.6) e a previsão só copia a temperatura da etapa de destino,
 * que é a entrada que o desfecho move. Onde o catálogo declara `sets_temperature`
 * diferente da etapa — são exatamente três linhas, `lig_interessado`,
 * `vis_decisor_interessado` (declaram `quente`, mas `em_conversa` é `morno`) e
 * `lig_atendeu_retorna` (declara `morno` e não tem etapa alvo) — a previsão usa o
 * declarado, porque é o que a RPC vai produzir gravando `deals.last_intent`, que é a
 * outra entrada que a regra do banco já lê (o ramo `v_hot`/`v_warm`). Está medido: com
 * `stage = em_conversa` e `last_intent = 'interessado'`, a regra devolve `quente`.
 */
export function preverRegistro(
  desfecho: DesfechoCatalogo,
  entrada: {
    ocorridoEm: Date;
    comQuem: ComQuem;
    temperaturaAtual: Temperature;
    etapasAlvo: readonly EtapaAlvo[];
    pipelineId: number | null;
    feriados: readonly Feriado[];
  },
): PrevisaoRegistro {
  const destino =
    desfecho.target_stage_slug === null || entrada.pipelineId === null
      ? null
      : (entrada.etapasAlvo.find(
          (e) => e.pipelineId === entrada.pipelineId && e.slug === desfecho.target_stage_slug,
        ) ?? null);

  const temperatura: Temperature =
    desfecho.sets_temperature ?? destino?.temperatura ?? entrada.temperaturaAtual;

  const cooldownAte = new Date(
    entrada.ocorridoEm.getTime() + desfecho.cooldown_days * 86_400_000,
  ).toISOString();

  return {
    etapaDestino: destino,
    temperatura,
    moveEtapa: destino !== null,
    portaAberta: preveePortaAberta(desfecho, entrada.comQuem),
    cooldownAte,
    cooldownPermanente: desfecho.cooldown_days >= 36_500,
    proximaAcaoEm: prazoSugerido(desfecho, entrada.ocorridoEm, temperatura, entrada.feriados),
    proximaAcaoTitulo: temProximaAcao(desfecho) ? desfecho.next_action_label : null,
    proximaAcaoTipo: desfecho.next_action_kind,
  };
}

// ---------------------------------------------------------------------------
// O alvo do registro
// ---------------------------------------------------------------------------

/**
 * Uma linha da lista de escolha do parceiro. Os campos são os de
 * `public.search_organizations` (RPC `security definer`, telefone já mascarado por
 * papel, RF-BAS-14) — reaproveitada inteira, sem consulta nova.
 */
export type AlvoDoRegistro = {
  id: string;
  nome: string;
  bairro: string | null;
  cidade: string | null;
  categoria: string | null;
  temperatura: Temperature;
  etapa: string | null;
  /** Id da etapa atual: viaja como `p_expected_stage_id` e pega duas pessoas mexendo no mesmo negócio. */
  etapaId: number | null;
  /** Negócio do parceiro; `null` quando ele não está em funil nenhum. */
  dealId: string | null;
  /**
   * Funil do negócio. É o que `preverRegistro` usa para saber se a etapa de destino
   * do desfecho EXISTE aqui: 5 dos 9 `target_stage_slug` do catálogo não existem no
   * funil `produtor`, que é metade da base.
   */
  pipelineId: number | null;
  diasSemContato: number | null;
  precisaAtencao: boolean;
  /**
   * Fim da janela de recontato (`v_contact_cooldown`), e SÓ enquanto ela está aberta:
   * uma janela que já passou vira `null` na hidratação, não uma data velha na tela.
   * Assim a interface nunca compara com o relógio durante a renderização — o que seria
   * impuro, mudaria de resposta entre dois desenhos do mesmo dado e é justamente o que
   * `react-hooks/purity` proíbe.
   */
  cooldownAte: string | null;
  /** `can_reactivate = false` sem reabertura registrada (RF-FUN-13). */
  bloqueado: boolean;
  /** `organizations.do_not_contact`: a tela mostra e não deixa registrar envio. */
  naoContatar: boolean;
};

/**
 * De onde a linha veio, para a tela saber o que destacar sem inventar ordenação.
 * `tarefa` é a lista do dia (tarefas de hoje atribuídas a ela — `tasks_select` já
 * devolve por `assignee_id`); `recente` são os últimos parceiros que ela registrou;
 * `parado` é o fundo de fila, quem está há mais tempo sem contato — a lista que
 * sobra quando não há tarefa marcada nem registro recente, e que é justamente o
 * estado da base hoje (100 parceiros, todos "sem contato"); `busca` é a RPC.
 */
export type OrigemDoAlvo = 'tarefa' | 'recente' | 'parado' | 'busca';

export type SugestaoDeAlvo = AlvoDoRegistro & {
  origem: OrigemDoAlvo;
  /** Título da tarefa de hoje, quando `origem === 'tarefa'`. */
  motivo: string | null;
};

/** Quantas sugestões cabem antes da rolagem, num celular de 390px. */
export const MAX_SUGESTOES = 8;

/** Espera do autocompletar. Curto: ela digita 3 letras e para. */
export const DEBOUNCE_BUSCA_MS = 250;

/** Janela de arrependimento antes do envio. Ver decisão 3 no cabeçalho. */
export const ESPERA_DESFAZER_MS = 5_000;

// ---------------------------------------------------------------------------
// O pedido: schemas zod
// ---------------------------------------------------------------------------

const taskKindSchema = z.enum(Constants.app.Enums.task_kind);
const superficieSchema = z.enum(
  Constants.app.Enums.interaction_surface.filter((s): s is Superficie => s !== 'triagem'),
);
const comQuemSchema = z.enum([
  'decisor',
  'influenciador',
  'funcionario',
  'ninguem',
  'nao_informado',
]);

const dataHoraOpcional = z.iso
  .datetime({ offset: true, error: 'Data e hora inválidas.' })
  .nullish()
  .transform((v) => v ?? null);

/** A próxima ação, quando a pessoa a edita. Ausente = vale o padrão do catálogo. */
export const proximaAcaoSchema = z.object({
  tipo: taskKindSchema,
  titulo: z
    .string()
    .trim()
    .min(1, { error: 'A próxima ação precisa de um título.' })
    .max(120, { error: 'Máximo de 120 caracteres.' }),
  em: z.iso.datetime({ offset: true, error: 'Data e hora inválidas.' }),
});

export type ProximaAcaoEditada = z.infer<typeof proximaAcaoSchema>;

/**
 * O que sai do navegador. Os cruzamentos de campo estão no `superRefine` porque o
 * banco também os cobra (`app.deals_before_write` recusa perda sem motivo; a etapa
 * `autorizou` exige a evidência; `reuniao_marcada` exige data e formato) — o zod só
 * antecipa o erro em português, no chip certo, antes da viagem.
 */
export const registroContatoSchema = z
  .object({
    /** Chave de idempotência gerada no cliente (`crypto.randomUUID`). */
    clientKey: z.uuid({ error: 'Chave de registro inválida.' }),
    organizationId: z.uuid({ error: 'Escolha o parceiro.' }),
    /** Nulo = a RPC escolhe o negócio aberto da organização. */
    dealId: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    /** Etapa que a tela viu; o `move_deal` recusa com `etapa_mudou` se alguém tiver mexido antes. */
    etapaEsperadaId: z
      .number()
      .int()
      .positive()
      .nullish()
      .transform((v) => v ?? null),
    outcomeId: z.number().int().positive({ error: 'Escolha o que aconteceu.' }),
    superficie: superficieSchema,
    comQuem: comQuemSchema,
    ocorridoEm: z.iso.datetime({ offset: true, error: 'Data e hora inválidas.' }),
    observacao: z
      .string()
      .trim()
      .max(2000, { error: 'Máximo de 2000 caracteres.' })
      .nullish()
      .transform((v) => (v ? v : null)),
    /** Só faz sentido em reunião; a tela nem mostra o campo nas outras superfícies. */
    duracaoMin: z
      .number()
      .int()
      .min(1)
      .max(600)
      .nullish()
      .transform((v) => v ?? null),
    lostReasonId: z
      .number()
      .int()
      .positive()
      .nullish()
      .transform((v) => v ?? null),
    reuniaoEm: dataHoraOpcional,
    reuniaoFormato: z
      .string()
      .trim()
      .min(1)
      .nullish()
      .transform((v) => v ?? null),
    /** Texto literal do que a pessoa autorizou, com o canal — evidência de `consent_events`. */
    autorizacaoEvidencia: z
      .string()
      .trim()
      .min(10, { error: 'Escreva o que ele autorizou, com as palavras dele.' })
      .max(500)
      .nullish()
      .transform((v) => (v ? v : null)),
    proximaAcao: proximaAcaoSchema.nullish().transform((v) => v ?? null),
    /** Confirmação explícita do opt-out: não tem volta (RF-CON-18). */
    confirmouOptout: z.boolean().default(false),
    /** O que a tela previu, para o servidor logar divergência da regra. Nunca é lido como verdade. */
    temperaturaPrevista: z
      .enum(Constants.app.Enums.temperature)
      .nullish()
      .transform((v) => v ?? null),
  })
  .superRefine((v, ctx) => {
    if (v.reuniaoEm !== null && v.reuniaoFormato === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['reuniaoFormato'],
        message: 'Diga se é Meet ou presencial.',
      });
    }
    if (v.reuniaoFormato !== null && v.reuniaoEm === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['reuniaoEm'],
        message: 'Reunião marcada precisa de data e hora.',
      });
    }
  });

export type RegistroContato = z.infer<typeof registroContatoSchema>;

/**
 * A parte da validação que depende do catálogo (e por isso não cabe no schema puro):
 * exige motivo de perda, data de reunião, evidência de autorização e confirmação de
 * opt-out conforme `extraDoDesfecho`. Devolve as mensagens por campo, na mesma forma
 * que o formulário já usa.
 */
export function validarExtras(
  registro: RegistroContato,
  desfecho: DesfechoCatalogo,
): Partial<
  Record<'lostReasonId' | 'reuniaoEm' | 'autorizacaoEvidencia' | 'confirmouOptout', string>
> {
  const erros: Partial<Record<string, string>> = {};
  switch (extraDoDesfecho(desfecho)) {
    case 'motivo_perda':
      if (registro.lostReasonId === null) erros.lostReasonId = 'Escolha o motivo da perda.';
      break;
    case 'reuniao':
      if (registro.reuniaoEm === null) erros.reuniaoEm = 'Quando é a reunião?';
      if (registro.reuniaoFormato === null) erros.reuniaoFormato = 'Meet ou presencial?';
      break;
    case 'autorizacao':
      if (registro.autorizacaoEvidencia === null)
        erros.autorizacaoEvidencia = 'Escreva o que ele autorizou, com as palavras dele.';
      break;
    case 'confirmar_optout':
      if (!registro.confirmouOptout)
        erros.confirmouOptout = 'Confirme: este contato não volta para nenhuma fila.';
      break;
    default:
      break;
  }
  return erros;
}

// ---------------------------------------------------------------------------
// A resposta: `public.registrar_contato` devolve `jsonb`
// ---------------------------------------------------------------------------

/** Nome da RPC. Um lugar só, para o dia em que ela mudar. */
export const RPC_REGISTRAR_CONTATO = 'registrar_contato' as const;

/**
 * Os argumentos, na grafia do Postgres (`p_*`), como o supabase-js os manda. A tradução
 * de `RegistroContato` para cá é `argumentosDaRpc`, e é o único lugar onde os dois
 * vocabulários se encostam.
 */
export type ArgumentosRegistrarContato = {
  p_client_key: string;
  p_organization_id: string;
  p_deal_id: string | null;
  p_expected_stage_id: number | null;
  p_outcome_id: number;
  p_com_quem: ComQuem;
  p_occurred_at: string;
  p_body: string | null;
  p_duration_min: number | null;
  p_lost_reason_id: number | null;
  p_meeting_at: string | null;
  p_meeting_format: string | null;
  p_authorization_evidence: string | null;
  p_next_action_kind: TaskKind | null;
  p_next_action_title: string | null;
  p_next_action_at: string | null;
};

export function argumentosDaRpc(r: RegistroContato): ArgumentosRegistrarContato {
  return {
    p_client_key: r.clientKey,
    p_organization_id: r.organizationId,
    p_deal_id: r.dealId,
    p_expected_stage_id: r.etapaEsperadaId,
    p_outcome_id: r.outcomeId,
    p_com_quem: r.comQuem,
    p_occurred_at: r.ocorridoEm,
    p_body: r.observacao,
    p_duration_min: r.duracaoMin,
    p_lost_reason_id: r.lostReasonId,
    p_meeting_at: r.reuniaoEm,
    p_meeting_format: r.reuniaoFormato,
    p_authorization_evidence: r.autorizacaoEvidencia,
    p_next_action_kind: r.proximaAcao?.tipo ?? null,
    p_next_action_title: r.proximaAcao?.titulo ?? null,
    p_next_action_at: r.proximaAcao?.em ?? null,
  };
}

/**
 * O que a RPC devolve. `registrado: false` é recusa prevista (o pedido chegou, a regra
 * disse não) e vira mensagem na tela; erro de rede ou de permissão vira exceção e cai
 * na fila offline.
 */
export const resultadoRegistroSchema = z.discriminatedUnion('registrado', [
  z.object({
    registrado: z.literal(true),
    /** `true` quando a chave de idempotência já tinha sido gravada: nada foi duplicado. */
    repetido: z.boolean(),
    activity_id: z.uuid(),
    deal_id: z.uuid().nullable(),
    task_id: z.uuid().nullable(),
    outcome_slug: z.string(),
    etapa_antes: z.string().nullable(),
    etapa_depois: z.string().nullable(),
    /** `false` quando a etapa alvo não existe no funil do negócio (metade da base é `produtor`). */
    etapa_aplicada: z.boolean(),
    /**
     * Por que a etapa não mudou, quando `etapa_aplicada` é `false`. Os primeiros são a
     * recusa prevista do `move_deal` (que devolve `{ok:false, reason}` em vez de
     * levantar exceção); `etapa_fora_do_funil` é a nossa, para os destinos que não
     * existem no funil do negócio; `contato_suprimido` é o guardrail do RF-CON-18, que
     * grava a atividade mas não deixa nenhuma etapa de TRABALHO passar. Nenhum deles
     * perde a atividade: o registro de campo já está gravado quando o `move_deal` é
     * chamado — e é por isso que esta lista precisa acompanhar a RPC. Faltando um
     * valor, `resultadoRegistroSchema` recusa a resposta INTEIRA e a tela diz "não deu
     * para registrar" sobre um contato que ESTÁ gravado (medido com número na
     * `suppression_list`, migração 001200).
     */
    etapa_recusa: z
      .enum([
        'etapa_igual',
        'etapa_mudou',
        'campos_obrigatorios',
        'motivo_de_perda_invalido',
        'proxima_acao_obrigatoria',
        'proxima_acao_no_passado',
        'sem_permissao',
        'etapa_fora_do_funil',
        'contato_suprimido',
      ])
      .nullable(),
    /** `true` quando o negócio não tinha dono e passou a ser dela (`move_deal`, claim). */
    assumiu_negocio: z.boolean(),
    temperatura_antes: z.enum(Constants.app.Enums.temperature).nullable(),
    temperatura_depois: z.enum(Constants.app.Enums.temperature).nullable(),
    precisa_atencao: z.boolean(),
    porta_aberta: z.boolean(),
    porta_batida: z.boolean(),
    cooldown_ate: z.string().nullable(),
    proxima_acao_em: z.string().nullable(),
    proxima_acao_titulo: z.string().nullable(),
    /** `true` quando a organização não tem negócio em funil nenhum: gravou a atividade e mais nada. */
    sem_negocio: z.boolean(),
  }),
  z.object({
    registrado: z.literal(false),
    motivo: z.enum([
      'sem_permissao',
      'fora_da_carteira',
      'desfecho_invalido',
      'desfecho_fora_da_superficie',
      'motivo_de_perda_obrigatorio',
      'reuniao_sem_data',
      'autorizacao_sem_evidencia',
      'organizacao_inexistente',
    ]),
    detalhe: z.string().nullable(),
  }),
]);

export type ResultadoRegistro = z.infer<typeof resultadoRegistroSchema>;
export type RegistroAceito = Extract<ResultadoRegistro, { registrado: true }>;

export const MENSAGENS_DE_RECUSA: Record<
  Extract<ResultadoRegistro, { registrado: false }>['motivo'],
  string
> = {
  sem_permissao: 'Seu perfil não registra contato.',
  fora_da_carteira: 'Este parceiro não está na sua carteira.',
  desfecho_invalido: 'Esse resultado saiu do catálogo. Recarregue a tela.',
  desfecho_fora_da_superficie: 'Esse resultado não vale para este canal.',
  motivo_de_perda_obrigatorio: 'Perda exige motivo (RF-FUN-04).',
  reuniao_sem_data: 'Reunião marcada precisa de data e hora.',
  autorizacao_sem_evidencia: 'Autorização precisa da evidência registrada.',
  organizacao_inexistente: 'Parceiro não encontrado.',
};

// ---------------------------------------------------------------------------
// Fila offline
// ---------------------------------------------------------------------------

/**
 * Ela registra na calçada, e a calçada tem sombra de sinal. O envio vai para uma fila
 * em `localStorage` e sai quando a rede voltar; a `clientKey` garante que reenviar não
 * duplica (índice único parcial em `activities ((metadata->>'client_key'))`, criado na
 * migração desta tela — testado: a segunda gravação levanta `unique_violation`).
 *
 * A fila nunca é bloqueante: a tela dá o recibo na hora, marca "vai subir quando a
 * rede voltar" e libera o próximo registro.
 *
 * O pedido entra na fila NO TOQUE DO DESFECHO, antes da janela de 5 segundos do
 * desfazer e antes de qualquer ida à rede. Guardar só depois de a rede falhar deixava
 * um buraco de 5 segundos por registro: aba fechada, bateria no fim ou app derrubado
 * ali dentro e o registro sumia sem ninguém saber. Persistindo antes, o pior caso vira
 * "sobe no próximo carregamento da tela".
 */
export type RegistroNaFila = {
  clientKey: string;
  criadoEm: string;
  tentativas: number;
  ultimoErro: string | null;
  /** Nome do parceiro, para a fila poder ser lida por gente. */
  parceiro: string;
  /** Nome do desfecho, para a fila poder ser lida por gente. */
  desfecho: string;
  /**
   * Antes deste instante o item NÃO sai: é a janela do desfazer. Se o aparelho morrer
   * dentro dela, no próximo carregamento o prazo já passou e o item sobe.
   */
  enviarApos: string;
  /**
   * `true` quando parou de tentar sozinho (tentativas esgotadas, sessão vencida,
   * recusa do servidor). O item CONTINUA guardado e aparece na tela com o motivo:
   * sumir em silêncio é o pior resultado possível.
   */
  esgotado: boolean;
  pedido: RegistroContato;
};

export const CHAVE_FILA_REGISTRO = 'komune.registro.fila.v1';
export const MAX_TENTATIVAS_FILA = 5;

/** De quanto em quanto tempo a tela tenta subir sozinha o que ficou para trás. */
export const INTERVALO_DRENO_MS = 20_000;

// ---------------------------------------------------------------------------
// Passos da tela
// ---------------------------------------------------------------------------

/**
 * Os três passos, e o quarto que só existe em 11 dos 34 desfechos. A tela é uma rota
 * só (`/registrar`), com o passo no estado e o parceiro na URL (`/registrar?org=<id>`),
 * para que a ficha e a lista de tarefas possam abrir já no passo 2.
 */
export type PassoDoRegistro = 'quem' | 'oque' | 'extra' | 'recibo';

export type EstadoDoRegistro = {
  passo: PassoDoRegistro;
  alvo: AlvoDoRegistro | null;
  superficie: Superficie;
  desfecho: DesfechoCatalogo | null;
  previsao: PrevisaoRegistro | null;
  resultado: RegistroAceito | null;
};

/**
 * Canal inicial dos chips. Sem contexto, o último que ela usou (guardado no
 * dispositivo): quem passa a manhã visitando registra visita atrás de visita, e o
 * chip certo já selecionado é um toque a menos vezes trinta.
 */
export const CHAVE_ULTIMA_SUPERFICIE = 'komune.registro.superficie.v1';
export const SUPERFICIE_PADRAO: Superficie = 'visita';

/** Quando ela abre o registro a partir de uma tarefa, o canal vem do tipo da tarefa. */
export const SUPERFICIE_DA_TAREFA: Partial<Record<TaskKind, Superficie>> = {
  call: 'ligacao',
  visit: 'visita',
  meeting: 'reuniao',
  message: 'whatsapp',
};
