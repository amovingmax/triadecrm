/**
 * Os pedidos de visita presencial que a IA combinou (24/11/2026), só na Imova.
 *
 * Pedido do dono: "A visita presencial não deve ser apresentada como link ou como algo
 * certo. Deve ser enviado uma solicitação se dá certo e deve aparecer um aviso para
 * todos os admins." Em 25/11/2026, depois do protótipo, o aviso mostra o nome do
 * cliente, o local da visita e o dia e o horário que o cliente pediu, com três botões
 * (`vigia-de-visitas.tsx`):
 * - Aceitar: no dia e no horário pedidos (se ele disse só o período, o admin escolhe a
 *   hora dentro dele). A visita entra na Agenda e o cliente recebe a confirmação.
 * - Agendar: o admin escolhe o dia e o horário. Dentro do que o cliente pediu, vale
 *   como aceitar; fora, o cliente recebe a proposta e o horário fica reservado na Agenda
 *   até ele responder ("Cliente confirmou" ou "Cliente não pode").
 * - Não é possível: o motivo fica só para a equipe; nada sai ao cliente.
 *
 * O banco é quem decide quem vê e quem pode, e é quem escreve a mensagem
 * (`public.visita_pedido_decidir`, migrações 20261124190000 e 20261125180000). Os textos
 * daqui são a prévia: escritos igual aos do banco (`app.visita_pedido_texto`).
 */
import { createClient } from '@/lib/supabase/client';

export type Periodo = 'manha' | 'tarde' | 'noite';
export type Decisao = 'aprovada' | 'outro_dia' | 'recusada';

export interface PedidoDeVisita {
  readonly id: string;
  readonly conversaId: string;
  readonly cliente: string;
  /** Para onde vai "Ver conversa". */
  readonly caminho: string;
  /** Como o cliente reconhece: "o terreno em Tabatinga". */
  readonly imovel: string;
  /** O título do cartão: "Terreno em Tabatinga". */
  readonly titulo: string;
  /** "Nísia Floresta/RN", quando o anúncio tem a cidade. */
  readonly lugar: string | null;
  /** O código do anúncio, para o admin. */
  readonly codigo: string | null;
  /** O dia que a IA entendeu (AAAA-MM-DD), ou null. */
  readonly data: string | null;
  readonly periodo: Periodo | null;
  /** A hora exata que o cliente pediu (HH:MM), ou null. */
  readonly hora: string | null;
  /** O dia pedido por extenso, do banco: "quinta-feira, 26/11, de manhã". */
  readonly diaPedido: string;
  /** As palavras do cliente: "quinta de manhã". */
  readonly comoDisse: string | null;
  readonly criadoEm: string;
}

export const CHAVE_DOS_PEDIDOS_DE_VISITA = ['visita-pedidos'] as const;
export const CHAVE_DOS_AGUARDANDO = ['visita-pedidos-aguardando'] as const;

export const PERIODOS: Readonly<
  Record<Periodo, { rotulo: string; padrao: string; de: number; ate: number }>
> = {
  manha: { rotulo: 'de manhã', padrao: '09:00', de: 8, ate: 12 },
  tarde: { rotulo: 'à tarde', padrao: '14:00', de: 13, ate: 18 },
  noite: { rotulo: 'à noite', padrao: '18:00', de: 18, ate: 21 },
};

/** Os motivos de "Não é possível" (só a equipe vê). */
export const MOTIVOS_DE_NAO = [
  'Ninguém disponível nesse dia',
  'Imóvel indisponível para visita',
  'Outro motivo',
] as const;

const DIAS = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

const PERIODOS_VALIDOS: readonly Periodo[] = ['manha', 'tarde', 'noite'];
const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA_HHMM = /^\d{2}:\d{2}$/;

const texto = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

const maiuscula = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Um pedido como o banco devolve; null quando falta o que o cartão precisa. */
export function lerPedido(valor: unknown): PedidoDeVisita | null {
  if (valor === null || typeof valor !== 'object') return null;
  const v = valor as Record<string, unknown>;
  const id = texto(v.id);
  const conversaId = texto(v.conversa_id);
  const criadoEm = texto(v.criado_em);
  if (id === null || conversaId === null || criadoEm === null) return null;
  const data = texto(v.data);
  const hora = texto(v.hora);
  const imovel = texto(v.imovel) ?? 'o imóvel';
  return {
    id,
    conversaId,
    cliente: texto(v.cliente) ?? 'Um cliente',
    caminho: texto(v.caminho) ?? '/conversas',
    imovel,
    titulo: texto(v.titulo) ?? maiuscula(imovel.replace(/^(o|a) /, '')),
    lugar: texto(v.lugar),
    codigo: texto(v.imovel_codigo),
    data: data !== null && DIA_ISO.test(data) ? data : null,
    periodo: PERIODOS_VALIDOS.find((p) => p === v.periodo) ?? null,
    hora: hora !== null && HORA_HHMM.test(hora) ? hora : null,
    diaPedido: texto(v.dia_pedido) ?? 'dia a combinar',
    comoDisse: texto(v.como_disse),
    criadoEm,
  };
}

/** Os pedidos abertos, do mais antigo ao mais novo. Quem não é admin recebe lista vazia. */
export async function lerPedidosDeVisita(): Promise<PedidoDeVisita[]> {
  const { data, error } = await createClient().rpc('visita_pedidos_abertos');
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : [])
    .map(lerPedido)
    .filter((p): p is PedidoDeVisita => p !== null);
}

/** A linha da notificação do sistema: quem, o quê e quando, como o cliente disse. */
export function linhaDoPedido(p: PedidoDeVisita): string {
  return `${p.cliente} quer ver ${p.imovel} · ${p.comoDisse ?? p.diaPedido}`;
}

// ------------------------------------------------------------------ dias e horas

/** "quinta-feira, 26/11". */
export function diaExtenso(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()] ?? ''}, ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** "10h", "10h30". */
export function horaTexto(hora: string): string {
  const [h = '0', m = '00'] = hora.split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
}

/** O dia e o horário pedidos, como o cartão mostra: "Quinta-feira, 26/11 · de manhã". */
export function quandoPedido(p: PedidoDeVisita): string {
  if (p.data === null) return 'Dia a combinar';
  const quando =
    p.hora !== null ? horaTexto(p.hora) : p.periodo !== null ? PERIODOS[p.periodo].rotulo : null;
  return quando === null
    ? maiuscula(diaExtenso(p.data))
    : `${maiuscula(diaExtenso(p.data))} · ${quando}`;
}

/** Os horários de meia em meia hora dentro do período (ou do dia comercial, sem período). */
export function horariosDoPeriodo(periodo: Periodo | null): string[] {
  const de = periodo === null ? 8 : PERIODOS[periodo].de;
  const ate = periodo === null ? 18 : PERIODOS[periodo].ate;
  const lista: string[] = [];
  for (let h = de; h < ate; h += 1) {
    const hh = String(h).padStart(2, '0');
    lista.push(`${hh}:00`, `${hh}:30`);
  }
  return lista;
}

/** "AAAA-MM-DD" de hoje (ou daqui a `maisDias`) em Fortaleza. */
export function diaEmFortaleza(agora: Date, maisDias = 0): string {
  const local = new Date(agora.getTime() - 3 * 60 * 60 * 1000 + maisDias * 24 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/** "HH:MM" de um instante em Fortaleza. */
export function horaEmFortaleza(instante: Date): string {
  return new Date(instante.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

/** Sábado ou domingo (o feriado o banco confere). */
export function fimDeSemana(dia: string): boolean {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return semana === 0 || semana === 6;
}

/** O dia útil (segunda a sexta) seguinte. */
export function diaUtilSeguinte(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** O instante em Fortaleza (UTC−3, sem horário de verão) que vai ao banco. */
export function quandoEmFortaleza(dia: string, hora: string): string | null {
  if (!DIA_ISO.test(dia) || !HORA_HHMM.test(hora)) return null;
  return `${dia}T${hora}:00-03:00`;
}

/** A hora que o formulário traz: a pedida, a do período ou 9h. */
export function horaSugerida(p: PedidoDeVisita): string {
  return p.hora ?? (p.periodo !== null ? PERIODOS[p.periodo].padrao : '09:00');
}

/**
 * O dia e a hora com que "Agendar" abre: o dia útil seguinte ao pedido (ou a amanhã, se
 * o cliente não disse o dia ou o dia já passou), na hora pedida.
 */
export function sugestaoParaAgendar(p: PedidoDeVisita, agora: Date): { dia: string; hora: string } {
  const hoje = diaEmFortaleza(agora);
  const base = p.data !== null && p.data >= hoje ? p.data : hoje;
  return { dia: diaUtilSeguinte(base), hora: horaSugerida(p) };
}

/** Por que o dia e a hora não servem, ou null quando servem. */
export function problemaDoQuando(dia: string, hora: string, agora: Date): string | null {
  const quando = quandoEmFortaleza(dia, hora);
  if (quando === null) return 'Escolha o dia e o horário.';
  if (new Date(quando).getTime() < agora.getTime()) {
    return 'Escolha um dia e um horário que ainda não passaram.';
  }
  if (fimDeSemana(dia)) return 'A Agenda não aceita sábado nem domingo. Escolha um dia útil.';
  return null;
}

// ------------------------------------------------------------------ o que o cliente recebe

function aoImovel(imovel: string): string {
  if (imovel.startsWith('o ')) return `ao ${imovel.slice(2)}`;
  if (imovel.startsWith('a ')) return `à ${imovel.slice(2)}`;
  return 'ao imóvel';
}

/** A confirmação, igual à do banco. */
export function textoDaConfirmacao(imovel: string, dia: string, hora: string): string {
  return `Combinado! Sua visita ${aoImovel(imovel)} ficou para ${diaExtenso(dia)}, às ${horaTexto(hora)}. Qualquer coisa, é só me chamar por aqui.`;
}

/** A proposta de outro horário, igual à do banco. */
export function textoDaProposta(p: PedidoDeVisita, dia: string, hora: string): string {
  const abertura =
    p.data === null
      ? ''
      : dia === p.data
        ? 'Nesse horário não vamos conseguir. '
        : 'Nesse dia não vamos conseguir. ';
  return `${abertura}Pode ser ${diaExtenso(dia)}, às ${horaTexto(hora)}?`;
}

/** O dia e a hora cabem no que o cliente pediu (o dia e a hora, ou o dia e o período). */
export function dentroDoPedido(p: PedidoDeVisita, dia: string, hora: string): boolean {
  if (p.data === null || dia !== p.data) return false;
  if (p.hora !== null) return hora === p.hora;
  if (p.periodo === null) return true;
  const [h = '0', m = '0'] = hora.split(':');
  const horas = Number(h) + Number(m) / 60;
  return horas >= PERIODOS[p.periodo].de && horas < PERIODOS[p.periodo].ate;
}

/** O que "Agendar" faz com o dia e a hora escolhidos: confirma ou propõe. */
export function oQueSai(
  p: PedidoDeVisita,
  dia: string,
  hora: string,
): { decisao: 'aprovada' | 'outro_dia'; texto: string } {
  return dentroDoPedido(p, dia, hora)
    ? { decisao: 'aprovada', texto: textoDaConfirmacao(p.imovel, dia, hora) }
    : { decisao: 'outro_dia', texto: textoDaProposta(p, dia, hora) };
}

// ------------------------------------------------------------------ a decisão

export interface ResultadoDaDecisao {
  readonly ok: boolean;
  readonly motivo: string | null;
  readonly mensagemSaiu: boolean;
  readonly naAgenda: boolean;
  /** Quem decidiu antes (no `ja_decidido`). */
  readonly por: string | null;
  /** Por que a Agenda recusou (`horario_ocupado`, `dia_nao_util`...). */
  readonly agendaMotivo: string | null;
  /** O que já ocupa o horário. */
  readonly conflitos: readonly string[];
}

export function lerResultado(valor: unknown): ResultadoDaDecisao {
  const v = (valor ?? {}) as Record<string, unknown>;
  const agenda = (v.agenda ?? {}) as Record<string, unknown>;
  const conflitos = Array.isArray(agenda.conflitos) ? agenda.conflitos : [];
  return {
    ok: v.ok === true,
    motivo: texto(v.motivo),
    mensagemSaiu: v.mensagem_saiu === true,
    naAgenda: v.na_agenda === true,
    por: texto(v.por),
    agendaMotivo: texto(agenda.motivo),
    conflitos: conflitos
      .map((c) => texto((c as Record<string, unknown> | null)?.titulo))
      .filter((t): t is string => t !== null),
  };
}

export async function decidirPedidoDeVisita(
  id: string,
  decisao: Decisao,
  quando: string | null,
  motivo: string | null,
): Promise<ResultadoDaDecisao> {
  const { data, error } = await createClient().rpc('visita_pedido_decidir', {
    p_id: id,
    p_decisao: decisao,
    ...(quando === null ? {} : { p_quando: quando }),
    ...(motivo === null || motivo.trim() === '' ? {} : { p_motivo: motivo.trim() }),
  });
  if (error) throw new Error(error.message);
  return lerResultado(data);
}

export interface Aviso {
  readonly titulo: string;
  readonly descricao: string | null;
  readonly tom: 'sucesso' | 'aviso' | 'erro';
}

/** Por que a Agenda recusou, em palavras de quem usa. */
function porQueAAgendaRecusou(r: ResultadoDaDecisao): Aviso {
  if (r.agendaMotivo === 'horario_ocupado') {
    return {
      titulo: 'Esse horário já está ocupado na sua Agenda',
      descricao:
        r.conflitos.length > 0
          ? `Já tem: ${r.conflitos.join(', ')}. Escolha outro horário.`
          : 'Escolha outro horário.',
      tom: 'erro',
    };
  }
  if (r.agendaMotivo === 'dia_nao_util') {
    return {
      titulo: 'A Agenda não aceita esse dia',
      descricao: 'Sábado, domingo e feriado não entram na Agenda. Escolha um dia útil.',
      tom: 'erro',
    };
  }
  if (r.agendaMotivo === 'no_passado') {
    return { titulo: 'Esse horário já passou', descricao: 'Escolha outro horário.', tom: 'erro' };
  }
  if (r.agendaMotivo === 'suprimido') {
    return {
      titulo: 'Esse cliente pediu para não receber mensagens',
      descricao: 'A visita não foi marcada. Fale com a gestão.',
      tom: 'erro',
    };
  }
  return {
    titulo: 'A Agenda não aceitou a visita',
    descricao: r.agendaMotivo === null ? 'Tente outro horário.' : `Motivo: ${r.agendaMotivo}.`,
    tom: 'erro',
  };
}

const SEM_MENSAGEM =
  'A mensagem não saiu (a janela de 24 h pode ter fechado): fale com o cliente pela conversa.';

/** O que o aviso diz depois da decisão. */
export function textoDaDecisao(decisao: Decisao, r: ResultadoDaDecisao): Aviso {
  if (!r.ok) {
    if (r.motivo === 'ja_decidido') {
      return {
        titulo: 'Esse pedido já foi decidido',
        descricao: r.por === null ? null : `Quem decidiu foi ${r.por}.`,
        tom: 'aviso',
      };
    }
    if (r.motivo === 'agenda_recusou') return porQueAAgendaRecusou(r);
    const porque: Record<string, string> = {
      sem_permissao: 'Só admin decide pedido de visita.',
      quando_invalido: 'Escolha um dia e um horário que ainda não passaram.',
      nao_existe: 'O pedido não existe mais.',
    };
    return {
      titulo: 'Não deu para decidir',
      descricao: porque[r.motivo ?? ''] ?? r.motivo,
      tom: 'erro',
    };
  }
  if (decisao === 'aprovada') {
    return {
      titulo: 'Visita aceita',
      descricao: !r.mensagemSaiu
        ? SEM_MENSAGEM
        : r.naAgenda
          ? 'O cliente recebeu a confirmação e a visita está na sua Agenda.'
          : 'O cliente recebeu a confirmação. Marque a visita na Agenda: a conversa não tem ficha.',
      tom: r.mensagemSaiu && r.naAgenda ? 'sucesso' : 'aviso',
    };
  }
  if (decisao === 'outro_dia') {
    return {
      titulo: 'Novo horário enviado',
      descricao: !r.mensagemSaiu
        ? SEM_MENSAGEM
        : r.naAgenda
          ? 'O cliente recebeu a proposta, e o horário ficou reservado na sua Agenda até ele responder.'
          : 'O cliente recebeu a proposta; a resposta dele chega na conversa.',
      tom: r.mensagemSaiu ? 'sucesso' : 'aviso',
    };
  }
  return {
    titulo: 'Marcado como não é possível',
    descricao: 'Nada foi enviado ao cliente. Fale com ele pela conversa.',
    tom: 'sucesso',
  };
}

/** Os pedidos que esta pessoa ainda não viu (para o toque e a notificação). */
export function pedidosNaoVistos(
  lista: readonly PedidoDeVisita[],
  vistos: ReadonlySet<string>,
): PedidoDeVisita[] {
  return lista.filter((p) => !vistos.has(p.id));
}

// ------------------------------------------------------------------ esperando o cliente

/** Uma proposta de outro horário que espera a resposta do cliente. */
export interface PedidoAguardando {
  readonly id: string;
  readonly cliente: string;
  readonly caminho: string;
  readonly imovel: string;
  /** "sexta-feira, 27/11, às 9h". */
  readonly quando: string;
  readonly marcadaPara: string;
  readonly propostoPor: string | null;
  readonly naAgenda: boolean;
}

export function lerAguardando(valor: unknown): PedidoAguardando | null {
  if (valor === null || typeof valor !== 'object') return null;
  const v = valor as Record<string, unknown>;
  const id = texto(v.id);
  const marcadaPara = texto(v.marcada_para);
  if (id === null || marcadaPara === null) return null;
  return {
    id,
    cliente: texto(v.cliente) ?? 'Um cliente',
    caminho: texto(v.caminho) ?? '/conversas',
    imovel: texto(v.imovel) ?? 'o imóvel',
    quando: texto(v.quando) ?? '',
    marcadaPara,
    propostoPor: texto(v.proposto_por),
    naAgenda: v.na_agenda === true,
  };
}

export async function lerPedidosAguardando(): Promise<PedidoAguardando[]> {
  const { data, error } = await createClient().rpc('visita_pedidos_aguardando');
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : [])
    .map(lerAguardando)
    .filter((p): p is PedidoAguardando => p !== null);
}

/** A confirmação que sai quando o cliente aceita a proposta. */
export function confirmacaoDaProposta(a: PedidoAguardando): string {
  const instante = new Date(a.marcadaPara);
  return textoDaConfirmacao(a.imovel, diaEmFortaleza(instante), horaEmFortaleza(instante));
}

export async function responderPeloCliente(
  id: string,
  confirmou: boolean,
): Promise<ResultadoDaDecisao> {
  const { data, error } = await createClient().rpc('visita_pedido_cliente_respondeu', {
    p_id: id,
    p_confirmou: confirmou,
  });
  if (error) throw new Error(error.message);
  return lerResultado(data);
}

/** O que o aviso diz depois de marcar a resposta do cliente. */
export function textoDaResposta(confirmou: boolean, r: ResultadoDaDecisao): Aviso {
  if (!r.ok) {
    if (r.motivo === 'ja_respondido') {
      return {
        titulo: 'A resposta já foi marcada',
        descricao: r.por === null ? null : `Quem marcou foi ${r.por}.`,
        tom: 'aviso',
      };
    }
    if (r.motivo === 'agenda_recusou') return porQueAAgendaRecusou(r);
    if (r.motivo === 'horario_passou') {
      return {
        titulo: 'O horário proposto já passou',
        descricao: 'Combine outro horário com o cliente pela conversa.',
        tom: 'erro',
      };
    }
    return { titulo: 'Não deu para marcar', descricao: r.motivo, tom: 'erro' };
  }
  if (!confirmou) {
    return {
      titulo: 'Reserva tirada da Agenda',
      descricao: 'Nada foi enviado ao cliente. Combine outro horário pela conversa.',
      tom: 'sucesso',
    };
  }
  return {
    titulo: 'Visita confirmada',
    descricao: r.mensagemSaiu
      ? 'O cliente recebeu a confirmação e a visita está na Agenda.'
      : SEM_MENSAGEM,
    tom: r.mensagemSaiu ? 'sucesso' : 'aviso',
  };
}
