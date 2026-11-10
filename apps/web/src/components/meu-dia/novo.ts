/**
 * O Meu dia novo da Imova (módulo `meuDiaNovo`, 10/11/2026): a fase 1 do protótipo
 * aprovado. Tudo aqui é conta pura sobre o que a tela já recebe — a fila de
 * `public.meu_dia`, as metas de `public.goal_progress` e a última mensagem de cada
 * conversa —, sem nenhum dado novo no banco. A KOMUNE não passa por este arquivo.
 */

import { iconeDoItem } from './icones';
import type { BlocoPreenchido, IdDoBloco, ItemDoDia, TipoDeItem } from './tipos';

// ---------------------------------------------------------------------------
// A janela de 24 h
// ---------------------------------------------------------------------------

/**
 * A frase que o banco escreve no `motivo` quando a janela já fechou
 * (20261002180000, `public.meu_dia`, item 0). É a única fonte da tela para saber de
 * que lado da janela a conversa está: a fila não devolve `janela_expira_em`, e
 * mudar o retorno da função seria migração nos dois bancos para uma tela que é só
 * da Imova. Se a frase mudar no banco, o teste `novo.test.ts` é quem avisa.
 */
const MOTIVO_JANELA_FECHADA = 'A janela de 24 h fechou';
const MOTIVO_JANELA_FECHA_EM = /^A janela de 24 h fecha em (\d+) h/;

export type LadoDaJanela = 'aberta' | 'fechada';

/**
 * De que lado da janela está a conversa. `null` para tudo que não é conversa.
 *
 * A conversa sem janela conhecida ("Respondeu e ninguém falou com ele desde
 * então", `janela_expira_em` nulo) fica do lado ABERTO: errar para "aberta" manda a
 * pessoa responder e o CRM avisa se só der modelo; errar para "fechada" esconderia
 * uma conversa que ainda dava para responder de graça.
 */
export function ladoDaJanela(item: ItemDoDia): LadoDaJanela | null {
  if (item.tipo !== 'conversa_esperando') return null;
  return item.motivo.startsWith(MOTIVO_JANELA_FECHADA) ? 'fechada' : 'aberta';
}

/** Quantas horas faltam para a janela fechar, lidas do motivo. `null` se não diz. */
export function horasParaFechar(item: ItemDoDia): number | null {
  if (item.tipo !== 'conversa_esperando') return null;
  const achou = MOTIVO_JANELA_FECHA_EM.exec(item.motivo);
  return achou ? Number(achou[1]) : null;
}

/** Até três horas, a janela pede pressa: a pastilha veste o tom de alerta. */
export const HORAS_DE_PRESSA = 3;

/**
 * Os dois blocos que nascem do bloco "Responderam e estão esperando". A explicação
 * é dita UMA vez, no cabeçalho do bloco, e não repetida em cada linha: nos prints
 * da tela de antes, "A janela de 24 h fechou: daqui só sai modelo aprovado"
 * aparecia quinze vezes seguidas.
 */
export const BLOCO_JANELA_ABERTA = {
  id: 'respondeu_aberta',
  titulo: 'Janela aberta: responda antes que feche',
  explicacao:
    'Responderam nas últimas 24 h. Enquanto a janela estiver aberta, dá para escrever o que quiser, sem modelo.',
  prioridades: [0],
} as const;

export const BLOCO_SO_MODELO = {
  id: 'respondeu_modelo',
  titulo: 'Esperando há mais de 24 h',
  explicacao:
    'A janela de 24 h já fechou, então daqui só sai modelo aprovado. Quando a pessoa responder ao modelo, a conversa reabre.',
  prioridades: [0],
} as const;

/**
 * Parte o bloco de quem respondeu em dois, pela janela, mantendo a ordem do banco
 * dentro de cada um e o lugar dos dois no topo. Bloco que ficaria vazio some, como
 * em `agruparFila`. Os outros blocos passam intactos.
 */
export function separarPelaJanela(blocos: readonly BlocoPreenchido[]): BlocoPreenchido[] {
  return blocos.flatMap((bloco) => {
    if (bloco.id !== 'respondeu') return [bloco];
    const abertos = bloco.itens.filter((item) => ladoDaJanela(item) !== 'fechada');
    const fechados = bloco.itens.filter((item) => ladoDaJanela(item) === 'fechada');
    const partes: BlocoPreenchido[] = [];
    if (abertos.length > 0) partes.push({ ...BLOCO_JANELA_ABERTA, itens: abertos });
    if (fechados.length > 0) partes.push({ ...BLOCO_SO_MODELO, itens: fechados });
    return partes;
  });
}

/**
 * O motivo que a linha ainda precisa mostrar no Meu dia novo. O da janela sai das
 * duas formas: a janela fechada já está dita no cabeçalho do bloco, e a aberta vira
 * a pastilha "fecha em 3 h" (`pastilhaDaJanela`), no lugar de "há 21 h".
 */
export function motivoQueSobra(item: ItemDoDia): string | null {
  if (item.tipo === 'conversa_esperando') {
    return ladoDaJanela(item) === 'fechada' || horasParaFechar(item) !== null ? null : item.motivo;
  }
  return item.motivo;
}

/** A pastilha da conversa com janela aberta: quanto falta, e não quanto passou. */
export function pastilhaDaJanela(
  item: ItemDoDia,
): { texto: string; numero: string; pressa: boolean } | null {
  const horas = horasParaFechar(item);
  if (horas === null) return null;
  return { texto: 'fecha em ', numero: `${horas} h`, pressa: horas <= HORAS_DE_PRESSA };
}

// ---------------------------------------------------------------------------
// A ação escrita na linha
// ---------------------------------------------------------------------------

/**
 * O que a linha manda fazer, escrito num botão à direita. A linha inteira continua
 * sendo o alvo de toque (ver `ItemDaFila`); o rótulo só diz em palavras o que o
 * toque faz, que antes era uma seta. Vale o mesmo destino de `destinoDoItem`.
 */
/** O desenho do botão da linha; quem desenha troca a chave pelo ícone. */
export type IconeDaAcao = 'responder' | 'modelo' | 'ligar' | 'registrar' | 'combinar' | 'abrir';

export type AcaoDoItem = {
  rotulo: string;
  icone: IconeDaAcao;
  /** O botão cheio, no laranja: só a conversa com a janela aberta, como no protótipo. */
  destaque: boolean;
};

/** Os tipos que são tarefa ou próxima ação: só neles o verbo do título vira o botão. */
const TIPOS_DE_TAREFA: readonly TipoDeItem[] = [
  'tarefa_atrasada',
  'tarefa_hoje',
  'proxima_acao_atrasada',
  'proxima_acao_hoje',
  'tarefa_futura',
  'tarefa_sem_data',
];

/**
 * O que o botão da linha diz e desenha. A linha inteira continua sendo o link
 * (`destinoDoItem`), e o rótulo diz o que se faz do outro lado: "Responder" e
 * "Enviar modelo" abrem a conversa, "Registrar resultado" abre o Registrar, e
 * "Combinar próximo passo" abre o funil.
 *
 * "Ligar" é a tarefa cujo título começa por ligar (a mesma regra do ícone, em
 * `iconeDoItem`): ela leva à ficha, onde o botão Ligar é o primeiro da tela. As
 * outras tarefas e a reunião dizem "Abrir ficha", e não "Ver compromisso", que
 * prometeria a Agenda.
 */
export function acaoDoItem(
  item: ItemDoDia,
  { somenteLeitura = false }: { somenteLeitura?: boolean } = {},
): AcaoDoItem {
  if (somenteLeitura) return { rotulo: 'Ver ficha', icone: 'abrir', destaque: false };
  switch (item.tipo) {
    case 'conversa_esperando':
      return ladoDaJanela(item) === 'fechada'
        ? { rotulo: 'Enviar modelo', icone: 'modelo', destaque: false }
        : { rotulo: 'Responder', icone: 'responder', destaque: true };
    case 'desfecho_pendente':
      return { rotulo: 'Registrar resultado', icone: 'registrar', destaque: false };
    case 'sem_proxima_acao':
    case 'negocio_parado':
      return { rotulo: 'Combinar próximo passo', icone: 'combinar', destaque: false };
    default:
      return TIPOS_DE_TAREFA.includes(item.tipo) && iconeDoItem(item) === 'ligar'
        ? { rotulo: 'Ligar', icone: 'ligar', destaque: false }
        : { rotulo: 'Abrir ficha', icone: 'abrir', destaque: false };
  }
}

export function rotuloDaAcao(item: ItemDoDia, opcoes: { somenteLeitura?: boolean } = {}): string {
  return acaoDoItem(item, opcoes).rotulo;
}

// ---------------------------------------------------------------------------
// Os grupos em cartão e os filtros (protótipo aprovado em 10/11/2026)
// ---------------------------------------------------------------------------

/** O nome do grupo no filtro, curto o bastante para caber numa pílula. */
export const ROTULO_CURTO_DO_BLOCO: Record<IdDoBloco, string> = {
  respondeu: 'Responderam',
  respondeu_aberta: 'Janela aberta',
  respondeu_modelo: 'Esperando modelo',
  agora: 'Urgente',
  hoje: 'Para hoje',
  sem_proxima_acao: 'Sem próxima ação',
  parados: 'Parados',
  depois: 'Depois',
  sistema: 'Avisos',
};

/**
 * O tom do ícone do grupo. O laranja da marca só para a janela aberta, que é o
 * único relógio que não é nosso; o alerta para o que já passou da hora.
 */
export type TomDoBloco = 'acento' | 'alerta' | 'neutro';

export const TOM_DO_BLOCO: Record<IdDoBloco, TomDoBloco> = {
  respondeu: 'acento',
  respondeu_aberta: 'acento',
  respondeu_modelo: 'alerta',
  agora: 'alerta',
  hoje: 'neutro',
  sem_proxima_acao: 'neutro',
  parados: 'neutro',
  depois: 'neutro',
  sistema: 'neutro',
};

/** Quantas linhas cada grupo mostra antes do "Mostrar mais". */
export const LINHAS_POR_GRUPO = 5;

/** O filtro escolhido, ou "tudo" quando o grupo dele saiu da fila. */
export type FiltroDaFila = 'tudo' | IdDoBloco;

export function blocosDoFiltro(
  blocos: readonly BlocoPreenchido[],
  filtro: FiltroDaFila,
): readonly BlocoPreenchido[] {
  if (filtro === 'tudo') return blocos;
  const escolhidos = blocos.filter((bloco) => bloco.id === filtro);
  return escolhidos.length > 0 ? escolhidos : blocos;
}

/**
 * A linha que ganha o selo "Comece por aqui": a primeira do que está na tela,
 * que é a primeira na ordem do banco. Aviso do sistema não ganha: ele não é
 * trabalho de carteira.
 */
export function primeiraDaFila(blocos: readonly BlocoPreenchido[]): ItemDoDia | null {
  const primeiro = blocos[0];
  if (!primeiro || primeiro.id === 'sistema') return null;
  return primeiro.itens[0] ?? null;
}

/** "Paula Ramos" → "PR"; "Imova" → "I". Sem letra nenhuma, vazio. */
export function iniciais(nome: string | null | undefined): string {
  const palavras = (nome ?? '').match(/\p{L}[\p{L}'’-]*/gu) ?? [];
  const primeira = palavras[0];
  if (!primeira) return '';
  const ultima = palavras.length > 1 ? palavras[palavras.length - 1] : null;
  return `${primeira[0]}${ultima ? ultima[0] : ''}`.toLocaleUpperCase('pt-BR');
}

/** Qual das quatro cores do disco de iniciais: a mesma pessoa, sempre a mesma cor. */
export function corDoDisco(nome: string, cores: number): number {
  let soma = 0;
  for (const letra of nome) soma = (soma * 31 + (letra.codePointAt(0) ?? 0)) % 9973;
  return soma % cores;
}

/** A frase da janela no cabeçalho: por onde começar, ou que nenhuma está aberta. */
export function fraseDaJanela(blocos: readonly BlocoPreenchido[]): string {
  return porOndeComecar(blocos) ?? 'Nenhuma janela aberta agora.';
}

/**
 * A frase de abertura, embaixo da saudação: por onde começar. A primeira conversa
 * com janela aberta, se houver, porque é o único relógio da fila que não é nosso.
 */
export function porOndeComecar(blocos: readonly BlocoPreenchido[]): string | null {
  const abertos = blocos.find((bloco) => bloco.id === 'respondeu_aberta');
  const primeiro = abertos?.itens[0];
  if (!primeiro) return null;
  const nome = primeiro.organizacao ?? 'quem escreveu de fora da base';
  const horas = horasParaFechar(primeiro);
  return horas !== null
    ? `Comece por ${nome}: a janela fecha em ${horas} h.`
    : `Comece por ${nome}: respondeu e está esperando.`;
}

// ---------------------------------------------------------------------------
// A última mensagem do lead
// ---------------------------------------------------------------------------

export type MensagemDaPrevia = {
  body: string | null;
  type: string;
  transcript: string | null;
};

/**
 * A última mensagem que o lead mandou, em uma linha. Texto vai entre aspas, para
 * ninguém confundir a fala do lead com um rótulo do CRM; mídia vira frase ("Enviou
 * um áudio"), que é o que a pessoa precisa saber antes de abrir.
 */
export function textoDaPrevia(mensagem: MensagemDaPrevia): string | null {
  const texto = mensagem.body?.trim() || null;
  const aspas = (valor: string) => `“${valor.replace(/\s+/g, ' ')}”`;
  switch (mensagem.type) {
    case 'audio': {
      const transcrito = mensagem.transcript?.trim();
      return transcrito ? `Áudio: ${aspas(transcrito)}` : 'Enviou um áudio';
    }
    case 'image':
      return texto ? `Foto: ${aspas(texto)}` : 'Enviou uma foto';
    case 'video':
      return texto ? `Vídeo: ${aspas(texto)}` : 'Enviou um vídeo';
    case 'document':
      return 'Enviou um documento';
    case 'location':
      return 'Mandou uma localização';
    case 'contacts':
      return 'Mandou um contato';
    case 'reaction':
      return 'Reagiu a uma mensagem';
    case 'system':
      return null;
    default:
      return texto ? aspas(texto) : null;
  }
}

// ---------------------------------------------------------------------------
// O ritmo da meta
// ---------------------------------------------------------------------------

/**
 * O expediente que o ritmo considera, em horas de Fortaleza. É a premissa do
 * protótipo aprovado ("o horário de trabalho vai das 9h às 18h"); se a Imova
 * trabalhar em outro horário, é aqui que muda.
 */
export const EXPEDIENTE = { inicio: 9, fim: 18 } as const;

/** Quanto do expediente de hoje já passou, de 0 a 1, no relógio de Fortaleza. */
export function fracaoDoExpediente(agora: Date): number {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Fortaleza',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? 0);
  const minuto = Number(partes.find((p) => p.type === 'minute')?.value ?? 0);
  const horas = hora + minuto / 60;
  const fracao = (horas - EXPEDIENTE.inicio) / (EXPEDIENTE.fim - EXPEDIENTE.inicio);
  return Math.min(1, Math.max(0, fracao));
}

export type SituacaoDoRitmo = 'sem_meta' | 'batida' | 'cedo' | 'no_ritmo' | 'abaixo';

export type RitmoDaMeta = {
  situacao: SituacaoDoRitmo;
  /** Quanto devia estar feito agora para bater a meta no fim do expediente. */
  esperado: number | null;
  /** Quanto falta para alcançar o ritmo (ou a meta, depois do expediente). */
  falta: number;
  /** Onde fica a marca do ritmo na barra, de 0 a 100. `null` = sem marca. */
  marca: number | null;
  /** A frase embaixo do número. */
  frase: string;
};

/**
 * Onde a pessoa deveria estar agora, num ritmo constante do começo ao fim do
 * expediente, para bater a meta. É a resposta que a barra sozinha não dá: "28 de
 * 40" às 10h é ótimo, às 17h é atraso. Sem meta não há ritmo; meta batida não
 * precisa de marca; antes das 9h a marca ficaria colada no zero e não diria nada.
 */
export function ritmoDaMeta(realizado: number, meta: number | null, fracao: number): RitmoDaMeta {
  if (meta === null || meta <= 0) {
    return { situacao: 'sem_meta', esperado: null, falta: 0, marca: null, frase: 'Só o realizado' };
  }
  if (realizado >= meta) {
    return { situacao: 'batida', esperado: meta, falta: 0, marca: null, frase: 'Meta batida' };
  }
  if (fracao <= 0) {
    return {
      situacao: 'cedo',
      esperado: 0,
      falta: 0,
      marca: null,
      frase: `O ritmo conta a partir das ${EXPEDIENTE.inicio}h`,
    };
  }
  const esperado = Math.floor(meta * fracao);
  const marca = Math.round(Math.min(1, fracao) * 100);
  if (realizado >= esperado) {
    return { situacao: 'no_ritmo', esperado, falta: 0, marca, frase: 'No ritmo' };
  }
  const falta = esperado - realizado;
  return {
    situacao: 'abaixo',
    esperado,
    falta,
    marca,
    frase: fracao >= 1 ? `Faltaram ${falta}` : `${falta} abaixo do ritmo`,
  };
}

// ---------------------------------------------------------------------------
// A saudação
// ---------------------------------------------------------------------------

/**
 * O primeiro nome para a saudação, sem nunca mostrar um e-mail. Nos prints da tela
 * de antes, quem entrou sem nome no perfil lia "Boa tarde, gestor.teste@teste.local.":
 * o CRM falando com um endereço. Com e-mail no lugar do nome, vale o pedaço antes
 * do "@", até o primeiro ponto, com a inicial maiúscula ("gestor.teste@…" → "Gestor").
 */
export function nomeDaSaudacao(nome: string | null | undefined): string {
  const limpo = (nome ?? '').trim();
  if (!limpo) return '';
  const primeiro = limpo.split(/\s+/)[0] ?? '';
  if (!primeiro.includes('@')) return primeiro;
  const local = primeiro.split('@')[0]?.split(/[._+-]/)[0] ?? '';
  return local ? local.charAt(0).toLocaleUpperCase('pt-BR') + local.slice(1) : '';
}
