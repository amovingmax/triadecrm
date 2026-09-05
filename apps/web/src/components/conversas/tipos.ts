import type {
  ActivityType,
  Channel,
  MsgStatus,
  MsgType,
  Temperature,
} from '@komune/schema';

/**
 * Contrato da tela de Conversas (PRD §7.4, RF-CON-05/06/12; anexo R04).
 *
 * ===========================================================================
 * O QUE ESTA TELA É HOJE, E POR QUÊ
 * ===========================================================================
 * Até a migração 20260905000200 esta tela era o inbox SEM as mensagens: não havia
 * tabela onde guardá-las. O que havia, e já tinha valor sozinho, era o histórico do
 * relacionamento — 147 linhas em `activities` e 132 em `deal_stage_history` —, que é
 * a metade do RF-CON-06 que não dependia da Meta, mais um aviso dizendo o que faltava.
 *
 * Agora há tabela: `conversations`, `messages` e `message_drafts`. Então a tela é o
 * inbox inteiro — mensagem nos dois sentidos, estado de entrega, o relógio da janela
 * de 24 h e a fila de aprovação do ADR-05 —, e a promessa que este arquivo fazia foi
 * cumprida ao pé da letra: cada mensagem virou mais um evento da MESMA coluna, com o
 * mesmo separador de dia, sem tirar de lá nada do que já estava.
 *
 * O que continua não existindo é o lado de fora. O worker que fala com a Meta
 * (`apps/workers/src/workers/wa.ts`) EXISTE e envia de verdade — o que falta é a
 * credencial: o número "Heloísa · Komune" espera a verificação do CNPJ no Meta
 * Business, o token não está (nem deve estar) neste repositório e nenhum modelo
 * foi aprovado (RF-CON-02). Ou seja: o que a pessoa aprova aqui ENTRA NA FILA, e
 * a fila anda no dia em que o worker subir com o número. A tela diz isso com
 * números lidos do banco (`DependenciasDaMeta`, incluindo o ponto que o worker
 * bate em `worker_heartbeats`), e não num parágrafo fixo que continuaria escrito
 * depois de deixar de ser verdade.
 *
 * ===========================================================================
 * DONO DESTE ARQUIVO
 * ===========================================================================
 * `components/conversas/**` e `app/(app)/conversas/**`. Nada aqui é importado por
 * outro módulo; o que vem de fora (escala térmica, rótulos do catálogo de desfechos,
 * formatos de parceiros) é importado, nunca copiado.
 */

// ---------------------------------------------------------------------------
// Rótulos dos enums do banco
// ---------------------------------------------------------------------------

/** Ordem dos canais na barra de filtros: a frequência de quem está na rua. */
export const CANAIS_EM_ORDEM = [
  'phone',
  'presencial',
  'whatsapp',
  'instagram',
  'email',
  'other',
] as const satisfies readonly Channel[];

/** `app.channel` em pt-BR. */
export const ROTULO_CANAL: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  email: 'E-mail',
  phone: 'Telefone',
  presencial: 'Presencial',
  other: 'Outro',
};

/** `app.activity_type` em pt-BR. */
export const ROTULO_TIPO: Record<ActivityType, string> = {
  call: 'Ligação',
  visit: 'Visita',
  meeting: 'Reunião',
  message: 'Mensagem',
  note: 'Nota',
  email: 'E-mail',
  stage_change: 'Mudança de etapa',
  system: 'Registro do sistema',
};

/** `activities.author_kind`: quem escreveu a linha. */
export type AutorTipo = 'human' | 'bot_fixed' | 'bot_ai' | 'system';

export const ROTULO_AUTOR: Record<AutorTipo, string> = {
  human: 'pessoa do time',
  bot_fixed: 'robô, texto fixo',
  bot_ai: 'robô, texto de IA',
  system: 'sistema',
};

// ---------------------------------------------------------------------------
// A conversa (uma linha da lista da esquerda)
// ---------------------------------------------------------------------------

export type ItemConversa = {
  /** É o id da organização: a conversa é com o parceiro, não com o negócio. */
  id: string;
  nome: string;
  categoria: string | null;
  bairro: string | null;
  cidade: string | null;
  temperatura: Temperature;
  /** `deals.needs_attention`: engrossa a barra térmica e pesa os dias. */
  precisaAtencao: boolean;
  /** Já vem mascarado do banco para sdr e embaixador (RF-BAS-14). */
  telefone: string | null;
  /** Espelho de `organizations_view.phone_is_masked`: liga o botão "Revelar". */
  telefoneMascarado: boolean;
  naoContatar: boolean;
  etapa: string | null;
  funil: string | null;
  /** Dono do negócio em foco (`deals.owner_id`). */
  responsavelId: string | null;
  responsavel: string | null;
  /** ISO da interação humana mais recente; `null` quando ninguém falou ainda. */
  ultimaEm: string | null;
  /** Dias inteiros desde `ultimaEm`; `null` quando nunca houve contato. */
  diasSemContato: number | null;
  /** Uma linha do que aconteceu por último ("Não atendeu", "Reunião marcada"). */
  resumo: string | null;
  /** Canal da última interação, para o ícone da linha. */
  ultimoCanal: Channel | null;
  /** Todos os canais já usados com este parceiro (alimenta o filtro). */
  canais: Channel[];
  /** Ids de quem já registrou alguma interação (alimenta o filtro de responsável). */
  quemFalou: string[];
  /** Quantas interações humanas existem (o import da lista-semente não conta). */
  interacoes: number;

  // -- O que o inbox acrescentou (migração 20260905000200) -------------------
  /** O fio de WhatsApp deste parceiro; `null` quando ninguém nunca escreveu. */
  fio: FioDaConversa | null;
  /** Mensagens não lidas (`conversations.unread_count`). */
  naoLidas: number;
  /** Rascunho da IA à espera de aprovação. Um por fio (índice único no banco). */
  rascunhoPendente: RascunhoDaIa | null;
};

// ---------------------------------------------------------------------------
// A linha do tempo (a coluna da direita)
// ---------------------------------------------------------------------------

/**
 * Um evento da coluna. `genero` separa as três origens porque elas pedem leituras
 * diferentes: `interacao` é alguém falando com o parceiro, `etapa` é o negócio
 * andando no funil e `origem` é de onde o parceiro veio parar na base.
 */
export type GeneroDoEvento = 'interacao' | 'etapa' | 'origem' | 'mensagem';

export type EventoDaLinha = {
  /** Único dentro da linha do tempo (prefixado pela origem, não é o id da tabela). */
  id: string;
  genero: GeneroDoEvento;
  /** ISO em UTC; a tela formata no fuso de Natal. */
  em: string;
  /** "Ligação", "Visita", "Mudou para Demonstração marcada". */
  titulo: string;
  /** Nome do desfecho do catálogo (`interaction_outcomes.name`), quando houver. */
  desfecho: string | null;
  /** Observação da atividade ou motivo da mudança de etapa. */
  detalhe: string | null;
  canal: Channel | null;
  tipo: ActivityType | null;
  autor: string | null;
  autorTipo: AutorTipo;
  /** `metadata.com_quem` já traduzido ("O dono / decisor"); `null` quando não afirma. */
  comQuem: string | null;
  duracaoMin: number | null;
  /** `metadata.door_opened` (RF-MET-01): porta aberta é diferente de porta batida. */
  portaAberta: boolean;
  /**
   * A mensagem, quando `genero` é `'mensagem'`.
   *
   * Ela entra na MESMA coluna das ligações e das mudanças de etapa porque a
   * ligação de terça e o WhatsApp que a confirmou vinte minutos depois são a
   * mesma conversa. Separar em abas apagaria a causa — que é a razão pela qual
   * esta coluna nasceu cronológica ascendente, e não como pilha de auditoria.
   */
  mensagem: MensagemDoFio | null;
};

/** Eventos de um mesmo dia, para o separador de data da coluna. */
export type DiaDaLinha = {
  /** `aaaa-mm-dd` no fuso de Natal. */
  chave: string;
  /** ISO do primeiro evento do dia, para o separador formatar a data. */
  em: string;
  eventos: EventoDaLinha[];
};

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

/**
 * Recorte por quanto tempo faz que ninguém fala com o parceiro. São faixas, e não
 * um campo de número: em campo a pergunta é "quem está esfriando?", nunca "quem
 * está com exatamente 9 dias?".
 */
export type JanelaSemContato = 'qualquer' | 'hoje' | 'ate3' | 'mais7' | 'mais14' | 'nunca';

export const JANELAS_EM_ORDEM = [
  'hoje',
  'ate3',
  'mais7',
  'mais14',
  'nunca',
] as const satisfies readonly Exclude<JanelaSemContato, 'qualquer'>[];

export const ROTULO_JANELA: Record<JanelaSemContato, string> = {
  qualquer: 'Tempo sem contato',
  hoje: 'Falei hoje',
  ate3: 'Até 3 dias',
  mais7: 'Mais de 7 dias',
  mais14: 'Mais de 14 dias',
  nunca: 'Nunca falei',
};

/**
 * As duas listas da esquerda.
 *
 * `conversas` é o inbox por parceiro; `aprovar` é a fila do ADR-05 — os rascunhos
 * que a IA escreveu e ninguém leu ainda, de todos os parceiros juntos. São duas
 * perguntas diferentes ("com quem eu falo agora?" e "o que está esperando por
 * mim?") e uma lista só não responde as duas: a fila de aprovação some no meio de
 * cem parceiros ordenados por recência, que é exatamente como um rascunho expira
 * sem ninguém ver.
 */
export type AbaDaEsquerda = 'conversas' | 'aprovar';

export type FiltrosConversas = {
  /** Texto livre sobre o nome, a categoria e o bairro do parceiro. */
  q: string;
  /** Dono do negócio ou quem registrou alguma interação (`profiles.id`). */
  responsavelId: string | null;
  canal: Channel | null;
  janela: JanelaSemContato;
};

export const FILTROS_VAZIOS: FiltrosConversas = {
  q: '',
  responsavelId: null,
  canal: null,
  janela: 'qualquer',
};

/** Há algum recorte ligado? Separa "a base está vazia" de "o filtro não achou nada". */
export function temRecorte(f: FiltrosConversas): boolean {
  return f.q.trim() !== '' || f.responsavelId !== null || f.canal !== null || f.janela !== 'qualquer';
}

/** Quantos filtros de lista (fora a busca) estão ligados: alimenta o contador. */
export function contarFiltros(f: FiltrosConversas): number {
  return [f.responsavelId, f.canal, f.janela === 'qualquer' ? null : f.janela].filter(
    (v) => v !== null,
  ).length;
}

// ---------------------------------------------------------------------------
// Estado na URL (`?org=…&q=…&responsavel=…&canal=…&janela=…`)
// ---------------------------------------------------------------------------

function ehJanela(v: string): v is JanelaSemContato {
  return v in ROTULO_JANELA;
}

function ehCanal(v: string): v is Channel {
  return v in ROTULO_CANAL;
}

/** Lê o recorte, a aba e a conversa aberta da query string (de `searchParams`). */
export function estadoDaUrl(params: Record<string, string | string[] | undefined>): {
  filtros: FiltrosConversas;
  organizacaoId: string | null;
  aba: AbaDaEsquerda;
} {
  const texto = (chave: string): string => {
    const v = params[chave];
    return typeof v === 'string' ? v : '';
  };

  const canal = texto('canal');
  const janela = texto('janela');

  return {
    filtros: {
      ...FILTROS_VAZIOS,
      q: texto('q'),
      responsavelId: texto('responsavel') || null,
      canal: ehCanal(canal) ? canal : null,
      janela: ehJanela(janela) ? janela : 'qualquer',
    },
    organizacaoId: texto('org') || null,
    aba: texto('aba') === 'aprovar' ? 'aprovar' : 'conversas',
  };
}

/** Escreve o recorte, a aba e a conversa aberta na query string, omitindo o padrão. */
export function urlDoEstado(
  f: FiltrosConversas,
  organizacaoId: string | null,
  aba: AbaDaEsquerda = 'conversas',
): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.responsavelId) p.set('responsavel', f.responsavelId);
  if (f.canal) p.set('canal', f.canal);
  if (f.janela !== 'qualquer') p.set('janela', f.janela);
  if (aba !== 'conversas') p.set('aba', aba);
  if (organizacaoId) p.set('org', organizacaoId);
  const busca = p.toString();
  return busca ? `?${busca}` : '';
}

// ===========================================================================
// AS MENSAGENS (migração 20260905000200; RF-CON-03 a RF-CON-06, RF-CON-22)
// ===========================================================================
//
// O aviso que esta tela carregava desde o D5 — "as mensagens de WhatsApp ainda
// não chegam aqui" — vencia por uma razão simples: não existia tabela. Agora
// existe (`conversations`, `messages`, `message_drafts`), e o que continua não
// existindo é o LADO DE FORA: número aprovado na Meta, modelo aprovado, e o
// worker de envio, que existe mas está parado — sem número nem token da Meta.
//
// A diferença importa para o texto da tela. Antes era "não há onde guardar";
// agora é "há onde guardar, e o que sai daqui fica na fila". O aviso mudou de
// frase por isso, e os números dele saem do banco (ver `dependenciasDaMeta`),
// não de um parágrafo escrito à mão que envelhece calado.

/** `app.msg_status` em pt-BR — o estado de entrega, na palavra da pessoa. */
export const ROTULO_ENTREGA: Record<MsgStatus, string> = {
  queued: 'na fila',
  sent: 'enviada',
  delivered: 'entregue',
  read: 'lida',
  failed: 'não saiu',
  received: 'recebida',
};

/** `app.msg_type` em pt-BR. */
export const ROTULO_TIPO_MENSAGEM: Record<MsgType, string> = {
  text: 'Texto',
  audio: 'Áudio',
  image: 'Imagem',
  video: 'Vídeo',
  document: 'Documento',
  template: 'Modelo aprovado',
  interactive: 'Botões',
  reaction: 'Reação',
  system: 'Aviso do WhatsApp',
};

/** `messages.origin`: quem pediu esta linha. */
export type OrigemDaMensagem = 'crm' | 'echo' | 'import';

export const ROTULO_ORIGEM: Record<OrigemDaMensagem, string> = {
  crm: 'pelo Tríade',
  echo: 'pelo celular',
  import: 'carga histórica',
};

/** `message_drafts.kind`: para que serve o rascunho (vocabulário do R08 e do R13). */
export type TipoDeRascunho =
  | 'followup_ligacao'
  | 'resposta'
  | 'objecao'
  | 'onboarding'
  | 'reativacao'
  | 'outro';

export const ROTULO_TIPO_RASCUNHO: Record<TipoDeRascunho, string> = {
  followup_ligacao: 'Follow-up de ligação',
  resposta: 'Resposta',
  objecao: 'Objeção',
  onboarding: 'Onboarding',
  reativacao: 'Reativação',
  outro: 'Outro',
};

/** `message_drafts.status`. */
export type EstadoDoRascunho = 'pendente' | 'aprovado' | 'enviado' | 'descartado' | 'expirado';

/** `conversations.status`. */
export type EstadoDoFio = 'aguardando_nos' | 'aguardando_parceiro' | 'robo' | 'resolvida';

export const ROTULO_ESTADO_DO_FIO: Record<EstadoDoFio, string> = {
  aguardando_nos: 'esperando a gente',
  aguardando_parceiro: 'esperando o parceiro',
  robo: 'com o robô',
  resolvida: 'resolvida',
};

/**
 * Uma mensagem, do jeito que a tela precisa dela.
 *
 * `entregaDetalhe` não é decoração: "na fila" sem dizer que a fila não anda
 * enquanto a Meta não aprovar o número é a mesma mentira que esta tela vinha
 * evitando desde o primeiro dia, só que mais difícil de perceber.
 */
export type MensagemDoFio = {
  id: string;
  fioId: string;
  em: string;
  entrada: boolean;
  tipo: MsgType;
  status: MsgStatus;
  texto: string | null;
  /** Caminho do arquivo no Storage privado; `null` enquanto ninguém baixou a mídia. */
  midiaCaminho: string | null;
  midiaTipo: string | null;
  /** Transcrição de máquina (faster-whisper local, RF-CON-27). Nunca conferida por gente. */
  transcricao: string | null;
  autorTipo: AutorTipo;
  autor: string | null;
  /** Quem aprovou o texto, quando foi a IA que redigiu (ADR-05). */
  aprovadoPor: string | null;
  origem: OrigemDaMensagem;
  /** Saiu com a janela de 24 h fechada: é o que a Meta cobra como modelo. */
  iniciadaPelaEmpresa: boolean;
  primeiroContato: boolean;
  confirmacaoDeOptout: boolean;
  porModelo: boolean;
  erroCodigo: string | null;
  erroDetalhe: string | null;
  enviadaEm: string | null;
  entregueEm: string | null;
  lidaEm: string | null;
  falhouEm: string | null;
};

/** Um motivo do validador determinístico de promessas (RF-CON-24). */
export type MotivoDoValidador = {
  codigo: string;
  trecho: string;
  explicacao: string;
};

/** O veredito do validador, como ele saiu de `packages/prompts`. */
export type VereditoDoValidador = {
  situacao: 'aprovado' | 'substituido' | 'bloqueado' | 'sem_registro';
  motivos: MotivoDoValidador[];
  /** Para onde o texto cai quando bloqueia: texto fixo do segmento, ou uma pessoa. */
  queda: 'texto_fixo' | 'humano' | null;
};

/** O rascunho da IA à espera de uma pessoa (ADR-05, RF-CON-22). */
export type RascunhoDaIa = {
  id: string;
  organizacaoId: string;
  fioId: string | null;
  tipo: TipoDeRascunho;
  estado: EstadoDoRascunho;
  /** Imutável: é o que a IA escreveu, e é contra ele que se mede a edição. */
  proposto: string;
  final: string | null;
  foiEditado: boolean;
  /** Ids de fatos da base de conhecimento que o texto diz estar usando. */
  afirmacoes: string[];
  validador: VereditoDoValidador;
  promptVersao: string | null;
  criadoEm: string;
  expiraEm: string;
  revisadoPor: string | null;
  revisadoEm: string | null;
  motivoDoDescarte: string | null;
};

/**
 * A janela de 24 h da Meta (R04 §2.1), que é o que decide se dá para responder
 * livremente ou só por modelo aprovado.
 *
 * Três situações, e a terceira não é um detalhe: com quem nunca escreveu para a
 * gente NÃO EXISTE janela — nada de "fechada há muito tempo". Dizer "fechada"
 * ali seria sugerir que um dia ela esteve aberta.
 */
export type EstadoDaJanela =
  | { situacao: 'aberta'; expiraEm: string; restanteMin: number }
  | { situacao: 'fechada'; expirouEm: string; fechadaHaMin: number }
  | { situacao: 'nunca' };

/** O fio de conversa (uma linha de `conversations`), do jeito que a tela usa. */
export type FioDaConversa = {
  id: string;
  organizacaoId: string | null;
  canal: Channel;
  /** Número do parceiro, em E.164. Vem cru do banco: o inbox não mascara o fio. */
  telefoneParceiro: string;
  /** O número da KOMUNE que fala neste fio (RF-CON-01). */
  numeroDaEmpresa: string;
  responsavelId: string;
  responsavel: string | null;
  estado: EstadoDoFio;
  roboPausado: boolean;
  naoLidas: number;
  ultimaEm: string | null;
  ultimaEntradaEm: string | null;
  janelaExpiraEm: string | null;
  /** O que a IA entendeu da última mensagem recebida (uma das 25 intenções do R08). */
  intencao: string | null;
  confianca: number | null;
  resumo: string | null;
};

/**
 * O que ainda depende da Meta, medido no banco em vez de escrito à mão.
 *
 * Um parágrafo fixo dizendo "faltam os modelos" continua na tela depois de os
 * modelos serem aprovados, e ninguém percebe. Estes três números mudam sozinhos
 * no dia em que a Meta responder.
 */
export type DependenciasDaMeta = {
  /** `app_settings.whatsapp.envio.numero_padrao`: sem ele, nenhum fio nasce. */
  numeroConfigurado: boolean;
  modelosAprovados: number;
  modelosAguardando: number;
  /** Mensagens paradas em `queued`, esperando o worker rodar. */
  naFila: number;
  /**
   * O ponto que o worker-wa bate em `worker_heartbeats`.
   *
   * É a única parte desta caixa que não é configuração e sim SINAL DE VIDA: um
   * worker parado explica a fila que não anda melhor do que qualquer frase, e
   * explica sem que ninguém precise manter a frase atualizada. `nunca` é o
   * estado de quem nunca subiu nesta base.
   */
  worker: { estado: 'ok' | 'degradado' | 'parado' | 'nunca'; ultimaBatidaEm: string | null };
};
