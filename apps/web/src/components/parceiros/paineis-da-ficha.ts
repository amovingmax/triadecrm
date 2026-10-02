import { TIMEZONE } from '@komune/schema';

import {
  faixaDoScore,
  rotuloDaIntencao,
  rotuloDoAlerta,
  ROTULO_DA_FAIXA,
} from '@/components/conversas/leitura-da-ia-formatos';
import { separarAssinatura, type MensagemCrua } from '@/components/conversas/mensagens';
import {
  montarLinhaDoTempo,
  procedenciaDoEvento,
  type AtividadeCrua,
  type HistoricoCru,
} from '@/components/conversas/montagem';
import type { EventoDaLinha } from '@/components/conversas/tipos';

import { diasDeDiferenca } from './formatos';

/**
 * Os três painéis da ficha do parceiro, em funções puras: a atividade, os
 * próximos passos e a leitura da IA.
 *
 * ===========================================================================
 * A ENTREGA 2 DA FICHA NOVA (02/10/2026)
 * ===========================================================================
 * A entrega 1 pôs no cabeçalho em que pé o parceiro está. Faltava o que só se
 * via abrindo outros três módulos: o que foi dito por último (Conversas), o que
 * está marcado (Agenda) e o que a IA leu da conversa (dentro da conversa, numa
 * linha fechada). A ficha passa a juntar os três — e SÓ LÊ: nada aqui grava,
 * conclui tarefa ou fala com a Meta.
 *
 * A regra de ouro é a de `conversas/montagem.ts`: nada é inventado. Sem leitura
 * não há nota; sem reunião não há "próximo compromisso"; e a atividade é a
 * mesma linha do tempo de Conversas (`montarLinhaDoTempo`), só que curta e de
 * trás para a frente.
 */

// ---------------------------------------------------------------------------
// Datas, do jeito que se fala
// ---------------------------------------------------------------------------

/** A data em pedaços: só os dígitos vão para o utilitário `numerico`. */
export type Quando = {
  /** "hoje", "amanhã", "ontem" ou "seg, " (com a vírgula, antes da data). */
  palavra: string;
  /** "05/10" — `null` quando a palavra já diz o dia. */
  data: string | null;
  /** "14:00" — `null` quando a hora não foi pedida. */
  hora: string | null;
  /** A frase inteira, para `title`, leitor de tela e teste. */
  texto: string;
};

const DIA_MES = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: TIMEZONE,
});
const DIA_MES_ANO = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: TIMEZONE,
});
const SEMANA = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: TIMEZONE });
const HORA = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});
const ANO = new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: TIMEZONE });

/**
 * "hoje às 14:00", "amanhã", "seg, 05/10 às 14:00", "30/09". O dia da semana só
 * entra na semana que vem pela frente: para o passado, "ter, 30/09" faz a pessoa
 * contar para trás, e "30/09" não.
 */
export function quando(iso: string, agora: Date, comHora: boolean): Quando {
  const alvo = new Date(iso);
  const dias = diasDeDiferenca(agora, alvo);
  const hora = comHora ? HORA.format(alvo) : null;

  let palavra = '';
  let data: string | null = null;
  if (dias === 0) palavra = 'hoje';
  else if (dias === 1) palavra = 'amanhã';
  else if (dias === -1) palavra = 'ontem';
  else {
    const mesmoAno = ANO.format(alvo) === ANO.format(agora);
    data = mesmoAno ? DIA_MES.format(alvo) : DIA_MES_ANO.format(alvo);
    // "seg." vem com ponto do Intl; a vírgula já separa, o ponto sobra.
    if (dias > 1 && dias < 7) palavra = `${SEMANA.format(alvo).replace('.', '')}, `;
  }

  const dia = `${palavra}${data ?? ''}`;
  // Com a data em dígitos a hora encosta nela ("30/09 13:06"); com a palavra ou
  // o dia da semana, pede a preposição ("hoje às 12:14", "seg, 05/10 às 14:00").
  const junta = palavra === '' ? ' ' : ' às ';
  return { palavra, data, hora, texto: hora ? `${dia}${junta}${hora}` : dia };
}

function primeiroNome(nome: string | null | undefined): string | null {
  const limpo = (nome ?? '').trim();
  return limpo ? (limpo.split(/\s+/)[0] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Atividade
// ---------------------------------------------------------------------------

export type TipoDeAtividade = 'recebida' | 'enviada' | 'interacao' | 'etapa' | 'origem';

export type ItemDeAtividade = {
  id: string;
  tipo: TipoDeAtividade;
  /** "Mensagem recebida", "Heloísa respondeu", "Mudou de etapa". */
  titulo: string;
  detalhe: string | null;
  /** O detalhe é fala de alguém: a tela põe entre aspas. */
  citacao: boolean;
  em: string;
};

export type Atividade = { itens: ItemDeAtividade[]; haMais: boolean };

/** Quantas linhas a ficha mostra; o resto está a um toque, em Conversas. */
export const LINHAS_DE_ATIVIDADE = 5;

const TAMANHO_DA_PREVIA = 120;

const SEM_TEXTO: Record<string, string> = {
  audio: 'Mensagem de áudio',
  image: 'Imagem',
  video: 'Vídeo',
  document: 'Documento',
  template: 'Modelo de mensagem',
  reaction: 'Reagiu a uma mensagem',
};

function encurtar(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > TAMANHO_DA_PREVIA
    ? `${limpo.slice(0, TAMANHO_DA_PREVIA - 1).trimEnd()}…`
    : limpo;
}

function daMensagem(evento: EventoDaLinha): ItemDeAtividade | null {
  const m = evento.mensagem;
  if (!m) return null;

  // A assinatura que o banco põe no texto livre ("*Heloísa:*") não é fala: o
  // nome de quem escreveu já está no título da linha.
  const fala = m.texto ? separarAssinatura(m.texto).resto : (m.transcricao ?? '');
  const temFala = fala.trim() !== '';
  const detalhe = temFala ? encurtar(fala) : (SEM_TEXTO[m.tipo] ?? null);

  let titulo: string;
  if (m.entrada) titulo = 'Mensagem recebida';
  else if (m.status === 'failed') titulo = 'Mensagem não entregue';
  else if (m.autorTipo === 'human') {
    const nome = primeiroNome(m.autor);
    // "Respondeu" só quando havia a quem responder: o que saiu com a janela
    // fechada foi a empresa que puxou a conversa.
    const verbo = m.porModelo
      ? 'enviou um modelo'
      : m.iniciadaPelaEmpresa
        ? 'escreveu'
        : 'respondeu';
    titulo = nome ? `${nome} ${verbo}` : m.porModelo ? 'Modelo enviado' : 'Mensagem enviada';
  } else if (m.autorTipo === 'system') titulo = 'Mensagem enviada';
  else titulo = 'Resposta automática';

  return {
    id: evento.id,
    tipo: m.entrada ? 'recebida' : 'enviada',
    titulo,
    detalhe,
    citacao: temFala,
    em: evento.em,
  };
}

function daInteracao(evento: EventoDaLinha): ItemDeAtividade {
  if (evento.genero === 'origem') {
    return {
      id: evento.id,
      tipo: 'origem',
      titulo: 'Entrou na base',
      detalhe: evento.detalhe ? encurtar(evento.detalhe) : null,
      citacao: false,
      em: evento.em,
    };
  }
  // "Ligação · Atendeu, retorna depois": a superfície e o desfecho, que é o que
  // a tela de registro grava. A observação de quem registrou vai embaixo.
  const superficie = procedenciaDoEvento(evento).join(' · ') || evento.titulo;
  const autor = primeiroNome(evento.autor);
  return {
    id: evento.id,
    tipo: 'interacao',
    titulo: evento.desfecho ? `${superficie} · ${evento.desfecho}` : superficie,
    detalhe: evento.detalhe ? encurtar(evento.detalhe) : autor ? `por ${autor}` : null,
    citacao: false,
    em: evento.em,
  };
}

/** Dois registros no mesmo minuto são o mesmo ato (o import cria a ficha e o negócio). */
const MESMO_ATO_MS = 60_000;

/**
 * A atividade recente do parceiro: mensagens, registros e mudanças de etapa numa
 * lista só, do mais novo para o mais antigo.
 *
 * As mensagens e os registros passam por `montarLinhaDoTempo`, a mesma função da
 * tela de Conversas — é ela que sabe que a atividade que espelha uma mensagem não
 * aparece duas vezes. A ficha mostra as últimas; a conversa inteira continua lá.
 */
export function montarAtividade(
  entrada: {
    atividades: AtividadeCrua[];
    historico: HistoricoCru[];
    mensagens: MensagemCrua[];
    pessoas: { id: string; nome: string }[];
    desfechos: { id: number; nome: string }[];
    /** O nome de cada etapa, por id. */
    etapas: ReadonlyMap<number, string>;
  },
  limite: number = LINHAS_DE_ATIVIDADE,
): Atividade {
  const eventos = montarLinhaDoTempo({
    atividades: entrada.atividades,
    historico: [],
    mensagens: entrada.mensagens,
    catalogos: { pessoas: entrada.pessoas, etapas: [], desfechos: entrada.desfechos },
  });

  const itens: ItemDeAtividade[] = [];
  const origens: number[] = [];
  for (const evento of eventos) {
    if (evento.genero === 'origem') origens.push(Date.parse(evento.em));
    const item = evento.genero === 'mensagem' ? daMensagem(evento) : daInteracao(evento);
    if (item) itens.push(item);
  }

  for (const h of entrada.historico) {
    const para = entrada.etapas.get(h.to_stage_id) ?? 'outra etapa';
    if (h.from_stage_id === null) {
      // Entrar na base e entrar no funil, no mesmo instante, é uma coisa só para
      // quem lê: "Entrou na base" já contou.
      const quandoFoi = Date.parse(h.changed_at);
      if (origens.some((o) => Math.abs(o - quandoFoi) <= MESMO_ATO_MS)) continue;
      itens.push({
        id: `etapa:${h.id}`,
        tipo: 'etapa',
        titulo: 'Entrou no funil',
        detalhe: para,
        citacao: false,
        em: h.changed_at,
      });
      continue;
    }
    const de = entrada.etapas.get(h.from_stage_id) ?? 'outra etapa';
    itens.push({
      id: `etapa:${h.id}`,
      tipo: 'etapa',
      titulo: 'Mudou de etapa',
      detalhe: `${de} → ${para}`,
      citacao: false,
      em: h.changed_at,
    });
  }

  // Do mais novo para o mais antigo. No empate, a consequência em cima: a etapa
  // mudou POR CAUSA da mensagem ou da ligação daquele mesmo segundo.
  const peso: Record<TipoDeAtividade, number> = {
    etapa: 0,
    recebida: 1,
    enviada: 1,
    interacao: 2,
    origem: 3,
  };
  itens.sort((a, b) => Date.parse(b.em) - Date.parse(a.em) || peso[a.tipo] - peso[b.tipo]);

  return { itens: itens.slice(0, limite), haMais: itens.length > limite };
}

/**
 * O que foi o último contato, para a linha de apoio do cabeçalho: "mensagem
 * recebida às 12:14". Só quando a atividade mais recente é do MESMO dia que o
 * último contato do negócio — senão a ficha diria a hora de uma coisa sob a data
 * de outra, e é melhor mostrar só a data.
 */
export function oQueFoiOUltimoContato(
  atividade: Atividade | null,
  ultimoContatoEm: string | null | undefined,
): { texto: string; hora: string } | null {
  if (!atividade || !ultimoContatoEm) return null;
  const item = atividade.itens.find((i) => i.tipo !== 'etapa' && i.tipo !== 'origem');
  if (!item) return null;
  if (diasDeDiferenca(new Date(item.em), new Date(ultimoContatoEm)) !== 0) return null;

  const texto =
    item.tipo === 'recebida'
      ? 'mensagem recebida'
      : item.tipo === 'enviada'
        ? 'mensagem enviada'
        : (item.titulo.split(' · ')[0] ?? item.titulo).toLowerCase();
  return { texto, hora: HORA.format(new Date(item.em)) };
}

// ---------------------------------------------------------------------------
// Próximos passos
// ---------------------------------------------------------------------------

export type ReuniaoCrua = {
  id: string;
  formato: string;
  inicio: string;
  fim: string;
  estado: string;
  link: string | null;
  local: string | null;
  dono_id: string;
  task_id: string | null;
};

export type TarefaCrua = {
  id: string;
  title: string;
  kind: string;
  status: string;
  due_at: string | null;
  assignee_id: string | null;
};

/** Os estados em que a reunião ainda está de pé (`reunioes_estado_check`). */
const REUNIAO_DE_PE: readonly string[] = ['a_confirmar', 'marcada', 'confirmada'];

const ROTULO_DA_TAREFA: Record<string, string> = {
  call: 'Ligação',
  visit: 'Visita',
  meeting: 'Reunião',
  message: 'Mensagem',
  follow_up: 'Tarefa',
  other: 'Tarefa',
};

export type Passo = {
  id: string;
  tipo: 'reuniao' | 'tarefa';
  titulo: string;
  /** "com Heloísa", "Tarefa · Heloísa". */
  apoio: string;
  quando: Quando | null;
  /** O que pede atenção nesta linha; `null` quando o prazo é só uma data. */
  selo: 'a confirmar' | 'aguarda resultado' | 'vence hoje' | 'atrasada' | null;
  /** O link da sala, só para reunião on-line que ainda não passou. */
  sala: string | null;
  /** Reunião no endereço do parceiro, e não numa sala on-line. */
  presencial: boolean;
};

export type ProximosPassos = {
  passos: Passo[];
  /** Quantos ficaram fora da lista (a ficha mostra os primeiros). */
  ocultos: number;
  reunioes: number;
  tarefas: number;
  /** A próxima reunião que ainda não começou: é ela que sobe para o cabeçalho. */
  proximaReuniao: Passo | null;
};

/** Quantos passos a ficha lista antes de dizer "e mais N". */
export const LINHAS_DE_PASSOS = 5;

/**
 * O que está marcado com este parceiro: as reuniões de pé e as tarefas abertas.
 *
 * SÓ LISTA. Concluir tarefa, confirmar ou remarcar reunião continuam na Agenda e
 * no Meu dia, que é onde o desfecho é registrado com as regras dele.
 *
 * A tarefa que é só o "eco" de uma reunião (`reunioes.task_id`, ADR-15) não
 * entra: listaria a mesma reunião duas vezes.
 */
export function montarProximosPassos(
  entrada: {
    /** TODAS as reuniões do parceiro, inclusive as encerradas: é delas que sai o eco. */
    reunioes: ReuniaoCrua[];
    tarefas: TarefaCrua[];
    pessoas: ReadonlyMap<string, string>;
  },
  agora: Date = new Date(),
): ProximosPassos {
  const ecos = new Set(entrada.reunioes.map((r) => r.task_id).filter((id) => id !== null));
  const nomeDe = (id: string | null) => primeiroNome(id ? entrada.pessoas.get(id) : null);

  const reunioes = entrada.reunioes
    .filter((r) => REUNIAO_DE_PE.includes(r.estado))
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
    .map((r): Passo & { futura: boolean } => {
      const passou = Date.parse(r.fim) < agora.getTime();
      const dono = nomeDe(r.dono_id);
      const online = r.formato === 'online';
      return {
        id: `reuniao:${r.id}`,
        tipo: 'reuniao',
        titulo: online ? 'Reunião on-line' : 'Reunião presencial',
        apoio: [dono ? `com ${dono}` : null, online ? null : r.local].filter(Boolean).join(' · '),
        quando: quando(r.inicio, agora, true),
        // Reunião que já passou e continua "marcada" é uma reunião sem desfecho:
        // o passo que falta é registrar o que houve.
        selo: passou ? 'aguarda resultado' : r.estado === 'a_confirmar' ? 'a confirmar' : null,
        sala: online && !passou && r.link ? r.link : null,
        presencial: !online,
        futura: Date.parse(r.inicio) >= agora.getTime(),
      };
    });

  const tarefas = entrada.tarefas
    .filter((t) => (t.status === 'todo' || t.status === 'doing') && !ecos.has(t.id))
    .sort((a, b) => (a.due_at ?? '9').localeCompare(b.due_at ?? '9'))
    .map((t): Passo => {
      const dias = t.due_at ? diasDeDiferenca(agora, new Date(t.due_at)) : null;
      const dono = nomeDe(t.assignee_id);
      return {
        id: `tarefa:${t.id}`,
        tipo: 'tarefa',
        titulo: t.title,
        apoio: [ROTULO_DA_TAREFA[t.kind] ?? 'Tarefa', dono].filter(Boolean).join(' · '),
        quando: t.due_at ? quando(t.due_at, agora, false) : null,
        selo: dias === null ? null : dias < 0 ? 'atrasada' : dias === 0 ? 'vence hoje' : null,
        sala: null,
        presencial: false,
      };
    });

  const proxima = reunioes.find((r) => r.futura) ?? null;
  const todos: Passo[] = [...reunioes.map(({ futura: _futura, ...passo }) => passo), ...tarefas];

  return {
    passos: todos.slice(0, LINHAS_DE_PASSOS),
    ocultos: Math.max(0, todos.length - LINHAS_DE_PASSOS),
    reunioes: reunioes.length,
    tarefas: tarefas.length,
    proximaReuniao: proxima ? (todos.find((p) => p.id === proxima.id) ?? null) : null,
  };
}

/** "1 reunião · 2 tarefas", sem a parte que for zero. */
export function contagemDosPassos(p: Pick<ProximosPassos, 'reunioes' | 'tarefas'>): string {
  const partes: string[] = [];
  if (p.reunioes > 0) partes.push(`${p.reunioes} ${p.reunioes === 1 ? 'reunião' : 'reuniões'}`);
  if (p.tarefas > 0) partes.push(`${p.tarefas} ${p.tarefas === 1 ? 'tarefa' : 'tarefas'}`);
  return partes.join(' · ');
}

// ---------------------------------------------------------------------------
// A leitura da IA
// ---------------------------------------------------------------------------

/** A linha de `ficha_da_conversa`, como o PostgREST entrega. */
export type LeituraCruaDaFicha = {
  resumo: string | null;
  intencao: string | null;
  score_intencao: number | null;
  sentimento: string | null;
  sinais: unknown;
  objecoes: string[] | null;
  alertas: string[] | null;
  proxima_acao: string | null;
  dados_insuficientes: boolean | null;
  analisada_em: string | null;
};

export type LeituraDaFicha = {
  /** 0 a 100: quanto a conversa indica intenção de fechar. NÃO é a temperatura. */
  nota: number | null;
  /** A faixa da rubrica: "engajado", "quer fechar". */
  faixa: string | null;
  resumo: string | null;
  etiquetas: { rotulo: string; valor: string }[];
  sugestao: string | null;
  analisadaEm: string | null;
  /** Conversa curta demais: há linha no banco, mas não há o que mostrar. */
  curtaDemais: boolean;
  /** O parceiro escreveu depois desta leitura: o conselho pode estar velho. */
  desatualizada: boolean;
};

const ROTULO_DO_SENTIMENTO: Record<string, string> = {
  positivo: 'positivo',
  neutro: 'neutro',
  negativo: 'negativo',
};

/** Depois disto sem reanálise, a leitura conta como velha (o debounce é de 10 min). */
const FOLGA_DA_LEITURA_MS = 30 * 60_000;

/**
 * A leitura que a IA fez da conversa, pronta para a ficha.
 *
 * A ficha NÃO chama a IA: lê o que o worker já gravou em `ficha_da_conversa`. É a
 * mesma leitura que aparece dentro da conversa, com os mesmos rótulos
 * (`leitura-da-ia-formatos.ts`) — só o desenho muda.
 */
export function montarLeituraDaFicha(
  crua: LeituraCruaDaFicha | null,
  ultimaEntradaEm: string | null = null,
): LeituraDaFicha | null {
  if (crua === null) return null;

  const limpo = (v: string | null | undefined) => (v ?? '').trim() || null;
  const nota = typeof crua.score_intencao === 'number' ? crua.score_intencao : null;
  const faixa = faixaDoScore(nota);
  const semSinais = !Array.isArray(crua.sinais) || crua.sinais.length === 0;

  const etiquetas: LeituraDaFicha['etiquetas'] = [];
  const intencao = rotuloDaIntencao(crua.intencao) ?? (faixa ? ROTULO_DA_FAIXA[faixa] : null);
  if (intencao) etiquetas.push({ rotulo: 'Intenção', valor: intencao });
  const sentimento = crua.sentimento ? ROTULO_DO_SENTIMENTO[crua.sentimento] : null;
  if (sentimento) etiquetas.push({ rotulo: 'Sentimento', valor: sentimento });
  for (const objecao of (crua.objecoes ?? []).slice(0, 2)) {
    const texto = limpo(objecao);
    if (texto) etiquetas.push({ rotulo: 'Objeção', valor: texto });
  }
  for (const alerta of (crua.alertas ?? []).slice(0, 2)) {
    if (limpo(alerta)) etiquetas.push({ rotulo: 'Alerta', valor: rotuloDoAlerta(alerta) });
  }

  const analisada = crua.analisada_em ? Date.parse(crua.analisada_em) : NaN;
  const entrada = ultimaEntradaEm ? Date.parse(ultimaEntradaEm) : NaN;

  return {
    nota,
    faixa: faixa ? ROTULO_DA_FAIXA[faixa] : null,
    resumo: limpo(crua.resumo),
    etiquetas,
    sugestao: limpo(crua.proxima_acao),
    analisadaEm: crua.analisada_em,
    curtaDemais: crua.dados_insuficientes !== false && semSinais,
    desatualizada:
      !Number.isNaN(analisada) &&
      !Number.isNaN(entrada) &&
      entrada - analisada > FOLGA_DA_LEITURA_MS,
  };
}

/**
 * O arco do medidor: o raio, o perímetro e quanto dele a nota preenche. A conta
 * fica aqui para o desenho não ter número solto.
 */
export function arcoDaNota(nota: number, raio: number): { perimetro: number; preenchido: number } {
  const perimetro = 2 * Math.PI * raio;
  const fracao = Math.min(100, Math.max(0, nota)) / 100;
  return { perimetro, preenchido: perimetro * fracao };
}
