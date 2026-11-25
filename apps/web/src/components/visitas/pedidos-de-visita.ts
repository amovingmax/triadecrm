/**
 * Os pedidos de visita presencial que a IA combinou (24/11/2026), só na Imova.
 *
 * Pedido do dono: "A visita presencial não deve ser apresentada como link ou como algo
 * certo. Deve ser enviado uma solicitação se dá certo e deve aparecer um aviso para
 * todos os admins." Todos os admins veem o cartão (`vigia-de-visitas.tsx`) e qualquer
 * um decide: aprovar (a visita entra na Agenda com o imóvel e o cliente recebe a
 * confirmação), outro dia (o cliente recebe a proposta) ou recusar (nada sai).
 *
 * O banco é quem decide quem vê e quem pode (`public.visita_pedidos_abertos` e
 * `public.visita_pedido_decidir`, migração 20261124190000): aqui só se lê e se pede.
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
  /** O dia que a IA entendeu (AAAA-MM-DD), ou null. */
  readonly data: string | null;
  readonly periodo: Periodo | null;
  /** O dia pedido por extenso, do banco: "quinta-feira, 26/11, de manhã". */
  readonly diaPedido: string;
  /** As palavras do cliente: "quinta de manhã". */
  readonly comoDisse: string | null;
  readonly criadoEm: string;
}

export const CHAVE_DOS_PEDIDOS_DE_VISITA = ['visita-pedidos'] as const;

const PERIODOS: readonly Periodo[] = ['manha', 'tarde', 'noite'];

const texto = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/** Um pedido como o banco devolve; null quando falta o que o cartão precisa. */
export function lerPedido(valor: unknown): PedidoDeVisita | null {
  if (valor === null || typeof valor !== 'object') return null;
  const v = valor as Record<string, unknown>;
  const id = texto(v.id);
  const conversaId = texto(v.conversa_id);
  const criadoEm = texto(v.criado_em);
  if (id === null || conversaId === null || criadoEm === null) return null;
  const data = texto(v.data);
  const periodo = PERIODOS.find((p) => p === v.periodo) ?? null;
  return {
    id,
    conversaId,
    cliente: texto(v.cliente) ?? 'Um cliente',
    caminho: texto(v.caminho) ?? '/conversas',
    imovel: texto(v.imovel) ?? 'o imóvel',
    data: data !== null && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null,
    periodo,
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

/** A linha do cartão: quem, o quê e quando, como o cliente disse. */
export function linhaDoPedido(p: PedidoDeVisita): string {
  return `${p.cliente} quer ver ${p.imovel} · ${p.comoDisse ?? p.diaPedido}`;
}

/** A hora sugerida para cada período (o admin troca à vontade). */
export const HORA_DO_PERIODO: Readonly<Record<Periodo, string>> = {
  manha: '09:00',
  tarde: '14:00',
  noite: '18:00',
};

/** "AAAA-MM-DD" de hoje e de amanhã em Fortaleza. */
export function diaEmFortaleza(agora: Date, maisDias = 0): string {
  const local = new Date(agora.getTime() - 3 * 60 * 60 * 1000 + maisDias * 24 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/**
 * O dia e a hora que o formulário traz: na aprovação, o que o cliente pediu (ou amanhã,
 * se a IA não soube o dia); em "outro dia", o dia seguinte ao pedido.
 */
export function sugestaoParaDecidir(
  p: PedidoDeVisita,
  decisao: Exclude<Decisao, 'recusada'>,
  agora: Date,
): { dia: string; hora: string } {
  const amanha = diaEmFortaleza(agora, 1);
  const hora = p.periodo === null ? HORA_DO_PERIODO.manha : HORA_DO_PERIODO[p.periodo];
  const pedido = p.data !== null && p.data >= diaEmFortaleza(agora) ? p.data : amanha;
  if (decisao === 'aprovada') return { dia: pedido, hora };
  const seguinte = new Date(`${pedido}T12:00:00Z`);
  seguinte.setUTCDate(seguinte.getUTCDate() + 1);
  return { dia: seguinte.toISOString().slice(0, 10), hora };
}

/** O instante em Fortaleza (UTC−3, sem horário de verão) que vai ao banco. */
export function quandoEmFortaleza(dia: string, hora: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^\d{2}:\d{2}$/.test(hora)) return null;
  return `${dia}T${hora}:00-03:00`;
}

export interface ResultadoDaDecisao {
  readonly ok: boolean;
  readonly motivo: string | null;
  readonly mensagemSaiu: boolean;
  readonly naAgenda: boolean;
  /** Quem decidiu antes (no `ja_decidido`). */
  readonly por: string | null;
}

export function lerResultado(valor: unknown): ResultadoDaDecisao {
  const v = (valor ?? {}) as Record<string, unknown>;
  return {
    ok: v.ok === true,
    motivo: texto(v.motivo),
    mensagemSaiu: v.mensagem_saiu === true,
    naAgenda: v.na_agenda === true,
    por: texto(v.por),
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

/** O que o cartão diz depois da decisão. */
export function textoDaDecisao(
  decisao: Decisao,
  r: ResultadoDaDecisao,
): { titulo: string; descricao: string | null; tom: 'sucesso' | 'aviso' | 'erro' } {
  if (!r.ok) {
    if (r.motivo === 'ja_decidido') {
      return {
        titulo: 'Esse pedido já foi decidido',
        descricao: r.por === null ? null : `Quem decidiu foi ${r.por}.`,
        tom: 'aviso',
      };
    }
    const porque: Record<string, string> = {
      sem_permissao: 'Só admin decide pedido de visita.',
      quando_invalido: 'Escolha um dia e uma hora que ainda não passaram.',
      nao_existe: 'O pedido não existe mais.',
    };
    return {
      titulo: 'Não deu para decidir',
      descricao: porque[r.motivo ?? ''] ?? r.motivo,
      tom: 'erro',
    };
  }
  const semMensagem =
    'A mensagem não saiu (a janela de 24 h pode ter fechado): fale com o cliente pela conversa.';
  if (decisao === 'aprovada') {
    return {
      titulo: 'Visita aprovada',
      descricao: !r.mensagemSaiu
        ? semMensagem
        : r.naAgenda
          ? 'O cliente recebeu a confirmação e a visita está na Agenda.'
          : 'O cliente recebeu a confirmação. Marque a visita na Agenda: a conversa não tem ficha.',
      tom: r.mensagemSaiu && r.naAgenda ? 'sucesso' : 'aviso',
    };
  }
  if (decisao === 'outro_dia') {
    return {
      titulo: 'Outro dia proposto',
      descricao: r.mensagemSaiu
        ? 'O cliente recebeu a proposta; a resposta dele chega na conversa.'
        : semMensagem,
      tom: r.mensagemSaiu ? 'sucesso' : 'aviso',
    };
  }
  return {
    titulo: 'Pedido recusado',
    descricao: 'Nada foi enviado. Fale com o cliente pela conversa.',
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
