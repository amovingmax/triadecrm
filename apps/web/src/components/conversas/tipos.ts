import type { ActivityType, Channel, Temperature } from '@komune/schema';

/**
 * Contrato da tela de Conversas (PRD §7.4, RF-CON-05/06/12; anexo R04).
 *
 * ===========================================================================
 * O QUE ESTA TELA É HOJE, E POR QUÊ
 * ===========================================================================
 * O RF-CON-05 descreve um inbox de WhatsApp. Ele não pode existir ainda: o número
 * "Heloísa · Komune" depende da verificação do CNPJ da Komune no Meta Business e da
 * aprovação dos modelos de mensagem (RF-CON-02), e não existe nenhuma tabela de
 * mensagens no banco — as Edge Functions do RF-CON-03 ainda não recebem webhook
 * nenhum da Meta. Simular um inbox aqui seria encher a tela de conversa inventada.
 *
 * O que JÁ existe é o histórico real do relacionamento: 147 linhas em `activities`
 * (100 do import da lista-semente R09 e 47 registradas pela Heloísa na tela de
 * Registrar contato) e 132 em `deal_stage_history`. Juntas elas são exatamente a
 * "linha do tempo por parceiro" que o RF-CON-06 pede — a mesma coluna onde as
 * mensagens vão entrar quando o número for aprovado, no mesmo formato.
 *
 * Então esta tela é o inbox **sem as mensagens**: lista de parceiros à esquerda,
 * ordenada pela interação mais recente; a linha do tempo à direita; e um aviso, em
 * português, dizendo o que falta e de que depende. Quando o WhatsApp entrar, cada
 * mensagem vira mais um evento desta mesma coluna, sem mudar o que já está aqui.
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
};

// ---------------------------------------------------------------------------
// A linha do tempo (a coluna da direita)
// ---------------------------------------------------------------------------

/**
 * Um evento da coluna. `genero` separa as três origens porque elas pedem leituras
 * diferentes: `interacao` é alguém falando com o parceiro, `etapa` é o negócio
 * andando no funil e `origem` é de onde o parceiro veio parar na base.
 */
export type GeneroDoEvento = 'interacao' | 'etapa' | 'origem';

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

/** Lê o recorte e a conversa aberta da query string (no servidor, de `searchParams`). */
export function estadoDaUrl(params: Record<string, string | string[] | undefined>): {
  filtros: FiltrosConversas;
  organizacaoId: string | null;
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
  };
}

/** Escreve o recorte e a conversa aberta na query string, omitindo o que está no padrão. */
export function urlDoEstado(f: FiltrosConversas, organizacaoId: string | null): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.responsavelId) p.set('responsavel', f.responsavelId);
  if (f.canal) p.set('canal', f.canal);
  if (f.janela !== 'qualquer') p.set('janela', f.janela);
  if (organizacaoId) p.set('org', organizacaoId);
  const busca = p.toString();
  return busca ? `?${busca}` : '';
}
