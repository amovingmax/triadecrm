/**
 * O contrato entre `public.cadencias_visao()`, `public.resumo_do_dia()` e a tela.
 *
 * As duas funções devolvem `jsonb`, então o tipo gerado do banco é `Json` — que não
 * ajuda ninguém. Quem garante a forma aqui é o zod, pelo mesmo motivo do módulo de
 * ligação: uma migração que renomeia um campo tem de quebrar no parse, com o nome do
 * campo no erro, e não três telas abaixo num `undefined` silencioso.
 *
 * Tudo o que é rótulo — nome de canal, texto de condição, frase de atraso — mora
 * neste arquivo e é função pura, testada. Nenhuma tradução nasce dentro de JSX.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// A tela das cadências
// ---------------------------------------------------------------------------

export const CANAIS = ['whatsapp', 'instagram', 'email', 'phone', 'presencial', 'other'] as const;
export type Canal = (typeof CANAIS)[number];

const canalSchema = z.enum(CANAIS).catch('other');

/** De onde o atraso do passo conta (`cadence_steps.delay_from`). */
export const ORIGENS_DO_ATRASO = ['matricula', 'passo_anterior', 'data_combinada'] as const;
export type OrigemDoAtraso = (typeof ORIGENS_DO_ATRASO)[number];

const passoSchema = z.object({
  posicao: z.number(),
  canal: canalSchema,
  tarefa: z.string(),
  atraso_dias: z.number(),
  atraso_de: z.enum(ORIGENS_DO_ATRASO).catch('passo_anterior'),
  titulo: z.string(),
  modelo: z.string().nullable(),
  audio: z.string().nullable(),
  condicao: z.record(z.string(), z.unknown()).default({}),
  tiers: z.array(z.string()).default([]),
  dica_de_janela: z.string().nullable(),
  ultimo_automatico: z.boolean(),
  aqui: z.number(),
  pendentes: z.number(),
  feitos: z.number(),
  pulados: z.number(),
});

const cadenciaSchema = z.object({
  id: z.number(),
  slug: z.string(),
  nome: z.string(),
  ativa: z.boolean(),
  funil: z.string(),
  max_toques: z.number(),
  limite_dias: z.number(),
  etapa_do_fim: z.string().nullable(),
  exige_gancho: z.boolean(),
  exige_autorizacao: z.boolean(),
  nota_de_entrada: z.string().nullable(),
  descricao: z.string().nullable(),
  matriculas: z.object({
    ativas: z.number(),
    pausadas: z.number(),
    concluidas: z.number(),
    encerradas: z.number(),
    esperando_o_primeiro: z.number(),
  }),
  passos: z.array(passoSchema),
});

export const visaoSchema = z.object({
  gerado_em: z.string(),
  dia: z.string(),
  papel: z.string(),
  pode_ligar_desligar: z.boolean(),
  dia_de_operacao: z.boolean(),
  agendador: z
    .array(z.object({ job: z.string(), agenda: z.string(), ativo: z.boolean() }))
    .nullable()
    .transform((v) => v ?? []),
  envio: z.object({
    modo_automatico: z.boolean(),
    modo_automatico_decisao: z.string(),
    worker_whatsapp: z.object({
      visto_em: z.string().nullable(),
      ativo: z.boolean(),
    }),
  }),
  canais: z
    .array(z.object({ canal: canalSchema, teto: z.number(), hoje: z.number() }))
    .nullable()
    .transform((v) => v ?? []),
  cadencias: z.array(cadenciaSchema),
});

export type PassoDaCadencia = z.infer<typeof passoSchema>;
export type Cadencia = z.infer<typeof cadenciaSchema>;
export type VisaoDasCadencias = z.infer<typeof visaoSchema>;

// ---------------------------------------------------------------------------
// O resumo do dia
// ---------------------------------------------------------------------------

export const MOMENTOS = ['manha', 'noite'] as const;
export type Momento = (typeof MOMENTOS)[number];

const itemDaFilaSchema = z.object({
  motivo: z.string().nullable(),
  titulo: z.string().nullable(),
  organizacao: z.string().nullable(),
  quando: z.string().nullable(),
  atraso_horas: z.union([z.number(), z.string()]).nullable(),
  temperatura: z.string().nullable(),
  tipo: z.string(),
  bairro: z.string().nullable(),
  organization_id: z.string().nullable(),
  deal_id: z.string().nullable(),
  task_id: z.string().nullable(),
});

export const resumoSchema = z.object({
  pessoa: z.object({ id: z.string(), nome: z.string().nullable(), eu_mesmo: z.boolean() }),
  dia: z.string(),
  gerado_em: z.string(),
  momento: z.enum(MOMENTOS),
  momento_do_relogio: z.enum(MOMENTOS),
  dia_de_operacao: z.boolean(),
  entrega: z.object({
    horario_manha: z.string(),
    horario_noite: z.string(),
    envio_automatico: z.boolean(),
    canal_previsto: z.string(),
    worker_whatsapp_ativo: z.boolean(),
  }),
  agenda: z.array(
    z.object({
      task_id: z.string(),
      quando: z.string().nullable(),
      tipo: z.string(),
      titulo: z.string(),
      organizacao: z.string().nullable(),
      bairro: z.string().nullable(),
      organization_id: z.string().nullable(),
      deal_id: z.string().nullable(),
    }),
  ),
  fila: z.array(itemDaFilaSchema),
  toques: z.array(
    z.object({
      id: z.string(),
      canal: canalSchema,
      passo: z.number(),
      titulo: z.string(),
      cadencia: z.string(),
      quando: z.string().nullable(),
      organizacao: z.string().nullable(),
      organization_id: z.string().nullable(),
      task_id: z.string().nullable(),
    }),
  ),
  metas: z.array(
    z.object({
      metrica: z.string(),
      rotulo: z.string().nullable(),
      meta: z.number().nullable(),
      realizado: z.number().nullable(),
      mensuravel: z.boolean(),
    }),
  ),
  feito: z.object({
    registros: z.number(),
    portas_abertas: z.number(),
    portas_batidas: z.number(),
    sem_desfecho: z.number(),
    tarefas_concluidas: z.number(),
    movimentos: z.number(),
    por_tipo: z.array(z.object({ tipo: z.string(), quantos: z.number() })),
  }),
  ontem: z.object({ registros: z.number(), portas_abertas: z.number() }),
  sem_registro: z.boolean(),
});

export type ResumoDoDia = z.infer<typeof resumoSchema>;
export type ItemDaFila = z.infer<typeof itemDaFilaSchema>;

// ---------------------------------------------------------------------------
// Rótulos — o vocabulário do banco vira português de gente
// ---------------------------------------------------------------------------

/**
 * O canal do passo em português.
 *
 * Difere de propósito do `ROTULO_CANAL` de `conversas` ("Telefone", "Presencial"):
 * lá o canal é o MEIO por onde a mensagem chegou; aqui ele é a AÇÃO que alguém vai
 * executar amanhã de manhã. "Ligação" e "Visita" são o que a Heloísa lê na tarefa, e
 * o passo da régua vira exatamente uma tarefa.
 */
const NOME_DO_CANAL: Record<Canal, string> = {
  phone: 'Ligação',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  presencial: 'Visita',
  email: 'E-mail',
  other: 'Outro canal',
};

export function nomeDoCanal(canal: Canal): string {
  return NOME_DO_CANAL[canal];
}

/**
 * "D+3 desde o passo anterior" — a frase que explica quando o toque vence.
 *
 * `data_combinada` é o único que não conta dias: ele lê a data que o parceiro pediu
 * (`deals.next_action_at`), e dizer "D+0" ali seria dizer "hoje" para algo que pode
 * ser daqui a três semanas.
 */
export function quandoOPassoVence(passo: {
  atraso_dias: number;
  atraso_de: OrigemDoAtraso;
}): string {
  if (passo.atraso_de === 'data_combinada') {
    return passo.atraso_dias === 0
      ? 'na data que o parceiro pediu'
      : `${passo.atraso_dias} dia(s) depois da data que o parceiro pediu`;
  }
  const de = passo.atraso_de === 'matricula' ? 'da entrada na cadência' : 'do passo anterior';
  if (passo.atraso_dias === 0) return `no mesmo dia ${de}`;
  if (passo.atraso_dias === 1) return `1 dia depois ${de}`;
  return `${passo.atraso_dias} dias depois ${de}`;
}

/**
 * A condição do passo em português.
 *
 * O vocabulário é fechado e validado por gatilho no banco (`app.cadence_steps_validate`),
 * então a lista aqui é o espelho dele. Chave que este arquivo não conhece aparece
 * como veio, em vez de sumir: um passo com condição invisível é um passo que pula
 * gente sem ninguém entender por quê.
 */
export function condicaoEmPortugues(chave: string, valor: unknown): string {
  const negativo = valor === false;
  switch (chave) {
    case 'tem_telefone':
      return negativo ? 'sem telefone' : 'tem telefone';
    case 'tem_instagram':
      return negativo ? 'sem @instagram' : 'tem @instagram';
    case 'bairro_geocodificado':
      return negativo ? 'bairro sem coordenada' : 'bairro no mapa';
    case 'sem_resposta':
      return negativo ? 'já respondeu' : 'ainda não respondeu';
    case 'claim_link_aberto':
      return negativo ? 'não abriu o link' : 'abriu o link';
    case 'reivindicado':
      return negativo ? 'ainda não reivindicou' : 'já reivindicou';
    case 'tem_gancho':
      return negativo ? 'sem gancho' : 'tem gancho registrado';
    case 'ultimo_desfecho_em':
      return Array.isArray(valor)
        ? `último desfecho: ${valor.map(String).join(' ou ')}`
        : 'último desfecho na lista';
    default:
      return `${chave}: ${JSON.stringify(valor)}`;
  }
}

/** As condições de um passo, já em português e em ordem estável. */
export function condicoesDoPasso(condicao: Record<string, unknown>): string[] {
  return Object.keys(condicao)
    .sort()
    .map((chave) => condicaoEmPortugues(chave, condicao[chave]));
}

/** Quantas organizações estão dentro desta cadência agora. */
export function contatosNaCadencia(cadencia: Cadencia): number {
  return cadencia.matriculas.ativas + cadencia.matriculas.pausadas;
}

/** Uma cadência ligada sem ninguém dentro ainda não fez nada — a tela precisa saber. */
export function cadenciasComGente(cadencias: readonly Cadencia[]): number {
  return cadencias.filter((c) => contatosNaCadencia(c) > 0).length;
}

/** O que a pessoa já fez hoje: métrica mensurável com número maior que zero. */
export function metricasFeitas(metas: ResumoDoDia['metas']): ResumoDoDia['metas'] {
  return metas.filter((m) => m.mensuravel && (m.realizado ?? 0) > 0);
}

/**
 * As métricas que têm meta definida para o período.
 *
 * Hoje a tabela `goals` está vazia, e por isso esta lista volta vazia: o resumo diz
 * "nenhuma meta definida" em vez de inventar um denominador. Cobrar contra uma meta
 * que ninguém combinou é o que transforma um resumo de duas pessoas em relatório de
 * call center.
 */
export function metasDefinidas(metas: ResumoDoDia['metas']): ResumoDoDia['metas'] {
  return metas.filter((m) => m.meta !== null);
}

/**
 * `activities.type` no singular e no plural.
 *
 * O plural vem escrito, e não deduzido: "ligação" vira "ligações" e "mensagem" vira
 * "mensagens" — duas regras diferentes que nenhuma heurística de sufixo acerta sem
 * virar um pequeno dicionário mal feito. São oito palavras; escrever as oito é mais
 * curto e não erra.
 */
const NOME_DA_ATIVIDADE: Record<string, readonly [string, string]> = {
  call: ['ligação', 'ligações'],
  visit: ['visita', 'visitas'],
  meeting: ['reunião', 'reuniões'],
  message: ['mensagem', 'mensagens'],
  email: ['e-mail', 'e-mails'],
  note: ['anotação', 'anotações'],
  stage_change: ['movimento no funil', 'movimentos no funil'],
  system: ['registro do sistema', 'registros do sistema'],
};

/** "3 ligações", "1 visita" — plural em português, sem "(s)". */
export function contagemDeAtividade(tipo: string, quantos: number): string {
  const nomes = NOME_DA_ATIVIDADE[tipo];
  if (!nomes) return tipo;
  return quantos === 1 ? nomes[0] : nomes[1];
}

// ---------------------------------------------------------------------------
// A porta de entrada da cadência
// ---------------------------------------------------------------------------

/**
 * O contrato de `public.cadencias_do_negocio()` e `public.negocios_para_cadencia()`.
 *
 * As duas existem por um motivo só: a régua tem nove recusas nomeadas, e uma tela que
 * oferece "Matricular" sem perguntar antes oferece um caminho que o banco fecha. Quem
 * responde "esta régua aceita este negócio?" é `app.recusa_de_matricula`, o MESMO
 * guarda que a RPC de gravação consulta — não há aqui nenhuma cópia da regra.
 */

const primeiroPassoSchema = z
  .object({ canal: canalSchema, titulo: z.string() })
  .nullable()
  .catch(null);

const cadenciaDoNegocioSchema = z.object({
  slug: z.string(),
  nome: z.string(),
  exige_gancho: z.boolean(),
  exige_autorizacao: z.boolean(),
  nota_de_entrada: z.string().nullable(),
  passos: z.number(),
  primeiro_passo: primeiroPassoSchema,
  /** `null` = o banco aceitaria a matrícula agora. Qualquer outra coisa é recusa nomeada. */
  motivo: z.string().nullable(),
  /** Faz sentido oferecer esta régua na etapa em que o cartão está agora. */
  sugerida: z.boolean(),
});

export const portaDoNegocioSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    papel_matricula: z.boolean(),
    negocio: z.object({
      deal_id: z.string(),
      organization_id: z.string(),
      organizacao: z.string(),
      etapa: z.string(),
      etapa_de_saida: z.boolean(),
    }),
    desligadas: z.number(),
    cadencias: z.array(cadenciaDoNegocioSchema),
  }),
  z.object({ ok: z.literal(false), motivo: z.string() }),
]);

export type CadenciaDoNegocio = z.infer<typeof cadenciaDoNegocioSchema>;
export type PortaDoNegocio = z.infer<typeof portaDoNegocioSchema>;

const negocioParaCadenciaSchema = z.object({
  deal_id: z.string(),
  organization_id: z.string(),
  organizacao: z.string(),
  etapa: z.string(),
  funil: z.string(),
  dono: z.string().nullable(),
  temperatura: z.string().nullable(),
  /** `gancho_obrigatorio` aqui não é "não": é "escreva o gancho antes". */
  motivo: z.string().nullable(),
});

export const listaParaCadenciaSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    cadencia: z.object({
      slug: z.string(),
      nome: z.string(),
      exige_gancho: z.boolean(),
      exige_autorizacao: z.boolean(),
      nota_de_entrada: z.string().nullable(),
    }),
    negocios: z.array(negocioParaCadenciaSchema),
  }),
  z.object({ ok: z.literal(false), motivo: z.string() }),
]);

export type NegocioParaCadencia = z.infer<typeof negocioParaCadenciaSchema>;
export type ListaParaCadencia = z.infer<typeof listaParaCadenciaSchema>;

/** O que `public.matricular_em_cadencia` devolve, do jeito que a tela precisa. */
export const matriculaSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    enrollment_id: z.string(),
    cadencia: z.string(),
    primeiro_toque: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({ ok: z.literal(false), motivo: z.string() }),
]);

export type ResultadoDaMatricula = z.infer<typeof matriculaSchema>;

/**
 * As recusas da matrícula em português.
 *
 * Nenhuma delas culpa quem está lendo, e todas dizem o que fazer em seguida — quem
 * abre esta folha está no meio de outra coisa (acabou de mover um cartão) e não vai
 * investigar um "não foi possível". Motivo que este arquivo não conhece aparece como
 * veio: uma recusa nova precisa ficar visível, não sumir num texto genérico.
 */
const RECUSAS_DA_MATRICULA: Record<string, string> = {
  sem_permissao: 'Matricular em régua é de admin, gestor ou SDR. Peça a quem tem o papel.',
  cadencia_inexistente: 'Esta régua foi desligada. Um gestor precisa religá-la em Cadências.',
  organizacao_inexistente: 'A ficha deste parceiro foi apagada. Não há o que matricular.',
  contato_suprimido:
    'Este contato pediu para não ser procurado. Ninguém entra em régua depois disso.',
  gancho_obrigatorio:
    'Esta régua só nasce com um gancho de gente: escreva o motivo real do novo contato.',
  sem_autorizacao:
    'O onboarding começa depois da autorização registrada. Registre a autorização na ficha primeiro.',
  ja_tem_cadencia_ativa:
    'Este parceiro já está numa régua. Encerre a que está correndo antes de abrir outra.',
  toque_pendente:
    'Já existe um toque pendente para este parceiro. O próximo nasce quando esse for resolvido.',
  toque_pendente_no_contato:
    'Esta mesma pessoa já tem um toque pendente em outro parceiro. Uma abordagem por vez.',
  negocio_nao_encontrado: 'Este negócio não está mais disponível para você.',
};

export function mensagemDaRecusaDeMatricula(motivo: string): string {
  return RECUSAS_DA_MATRICULA[motivo] ?? `O banco recusou: ${motivo}.`;
}

/**
 * A recusa que a pessoa resolve SEM sair da folha.
 *
 * Só uma: falta o gancho, e o campo do gancho está ali. As outras oito dependem de
 * algo fora da folha (um gestor religar a régua, a autorização ser registrada, o
 * toque pendente ser resolvido) e por isso desabilitam a linha em vez de pedir um
 * segundo clique que vai falhar igual.
 */
export function recusaPedeCampo(motivo: string | null): boolean {
  return motivo === 'gancho_obrigatorio';
}

/** A régua aceita este negócio agora, ou aceita assim que o gancho for escrito. */
export function cadenciaAceita(cadencia: Pick<CadenciaDoNegocio, 'motivo'>): boolean {
  return cadencia.motivo === null || recusaPedeCampo(cadencia.motivo);
}

/**
 * O que aconteceu com o primeiro toque, em uma frase.
 *
 * `app.abrir_proximo_toque` responde seis coisas diferentes, e a diferença importa
 * para quem matriculou: um toque CRIADO já está no Meu dia de alguém hoje; um
 * ADIADO só vai aparecer quando a janela do canal abrir; e uma régua que ENCERRA na
 * mesma hora (alvo suprimido, desfecho não reativável) significa que a matrícula não
 * vai gerar trabalho nenhum — dizer só "matriculado" nesse caso seria mentir.
 */
export function fraseDoPrimeiroToque(toque: Record<string, unknown>): string {
  const acao = typeof toque.acao === 'string' ? toque.acao : '';
  const motivo = typeof toque.motivo === 'string' ? toque.motivo : null;
  const canal = typeof toque.canal === 'string' ? toque.canal : null;
  const nome = canal && (CANAIS as readonly string[]).includes(canal)
    ? nomeDoCanal(canal as Canal).toLowerCase()
    : 'contato';

  switch (acao) {
    case 'toque_criado':
      return `O primeiro toque (${nome}) já está na fila de tarefas.`;
    case 'agendado':
    case 'adiado':
      return 'O primeiro toque ficou agendado: ele aparece no Meu dia quando vencer.';
    case 'encerrada':
      return motivo === 'suprimido'
        ? 'A régua encerrou na hora: este contato está suprimido.'
        : 'A régua encerrou na hora — o alvo não pode receber toque agora.';
    case 'concluida':
      return 'A régua não tinha passo aplicável e já foi concluída.';
    default:
      return 'Nenhum toque nasceu agora; a régua confere de novo no próximo ciclo.';
  }
}

/** O contrato de `public.meu_papel()`: o que o papel de quem está logado faz. */
export const meuPapelSchema = z.object({
  papel: z.string(),
  escreve: z.boolean(),
  gerencia: z.boolean(),
  matricula: z.boolean(),
});

export type MeuPapel = z.infer<typeof meuPapelSchema>;
