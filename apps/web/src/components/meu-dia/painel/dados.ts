'use client';

import { createClient } from '@/lib/supabase/client';

import { ErroDoDia } from '../consultas';

/**
 * O Painel do dia (17/11/2026, só da Imova): uma leitura só,
 * `public.meu_dia_painel`, que devolve cada bloco pronto. Aqui a resposta crua
 * vira tipos honestos (nada é confiado como não-nulo) em `lerPainel`, uma função
 * pura que os testes medem sem banco.
 */

export type PeriodoDoPainel = 'hoje' | 'semana' | 'mes';
export const PERIODOS: readonly PeriodoDoPainel[] = ['hoje', 'semana', 'mes'];

export type Contagem = { agora: number; antes: number; serie: number[] };

export type NumerosDoPainel = {
  dias: string[];
  leads: Contagem;
  visitas: Contagem & { pelaIa: number };
  fechados: {
    agora: number;
    antes: number;
    noMes: number;
    metaMes: number | null;
    ultimo: { nome: string | null; por: string | null; quando: string } | null;
  };
};

export type AcaoDaIa = 'passou_para_pessoa' | 'marcou_visita' | 'retomou';

export type EventoDaIa = {
  quando: string;
  acao: AcaoDaIa;
  nome: string;
  caminho: string | null;
  motivo: string | null;
  visitaEm: string | null;
  codigo: string | null;
};

export type IaDoPainel = {
  conversas: number;
  visitas: number;
  passadas: number;
  atendendo: number;
  eventos: EventoDaIa[];
};

export type SituacaoDoLead = 'visita' | 'ia' | 'equipe' | 'esperando' | 'conversando';

export type LeadDoPainel = {
  conversationId: string;
  nome: string;
  caminho: string | null;
  chegou: string;
  canal: string | null;
  subcanal: string | null;
  codigo: string | null;
  interesse: string | null;
  situacao: SituacaoDoLead;
};

export type ImovelEmAlta = {
  codigo: string;
  titulo: string | null;
  bairro: string | null;
  tipo: string | null;
  interessados: number;
  foto: string | null;
  anuncioId: string | null;
};

export type ImovelDaVisita = {
  codigo: string;
  titulo: string | null;
  tipo: string | null;
  bairro: string | null;
  cidade: string | null;
  endereco: string | null;
  foto: string | null;
};

export type Confirmacao = 'confirmou' | 'remarcar' | 'aguardando';

export type VisitaDeHoje = {
  taskId: string;
  quando: string;
  tipo: 'visit' | 'meeting';
  titulo: string;
  feito: boolean;
  cliente: string;
  organizationId: string | null;
  caminho: string | null;
  local: string | null;
  imovel: ImovelDaVisita | null;
  confirmacao: Confirmacao | null;
  marcadaPor: 'ia' | 'calendly' | null;
};

export type TipoDePendencia = 'ia' | 'venceu' | 'hoje';

export type Pendencia = {
  tipo: TipoDePendencia;
  titulo: string;
  detalhe: string | null;
  quando: string | null;
  caminho: string | null;
  acao: 'responder' | 'abrir' | 'ligar';
};

export type PainelDoDia = {
  periodo: { nome: PeriodoDoPainel; de: string; ate: string };
  veTudo: boolean;
  numeros: NumerosDoPainel | null;
  ia: IaDoPainel | null;
  leads: LeadDoPainel[] | null;
  imoveis: ImovelEmAlta[] | null;
  agenda: VisitaDeHoje[];
  precisa: { total: number; itens: Pendencia[] };
};

// ---------------------------------------------------------------------------
// A leitura defensiva
// ---------------------------------------------------------------------------

type Cru = Record<string, unknown>;

function objeto(v: unknown): Cru | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Cru) : null;
}

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function numero(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}

function numeroOuNulo(v: unknown): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function umDe<T extends string>(v: unknown, valores: readonly T[]): T | null {
  return typeof v === 'string' && (valores as readonly string[]).includes(v) ? (v as T) : null;
}

function contagem(v: unknown): Contagem {
  const o = objeto(v) ?? {};
  return { agora: numero(o.agora), antes: numero(o.antes), serie: lista(o.serie).map(numero) };
}

function lerNumeros(v: unknown): NumerosDoPainel | null {
  const o = objeto(v);
  if (!o) return null;
  const f = objeto(o.fechados) ?? {};
  const ultimo = objeto(f.ultimo);
  const quandoUltimo = ultimo ? texto(ultimo.quando) : null;
  return {
    dias: lista(o.dias).flatMap((d) => texto(d) ?? []),
    leads: contagem(o.leads),
    visitas: { ...contagem(o.visitas), pelaIa: numero(objeto(o.visitas)?.pela_ia) },
    fechados: {
      agora: numero(f.agora),
      antes: numero(f.antes),
      noMes: numero(f.no_mes),
      metaMes: numeroOuNulo(f.meta_mes),
      ultimo:
        ultimo && quandoUltimo
          ? { nome: texto(ultimo.nome), por: texto(ultimo.por), quando: quandoUltimo }
          : null,
    },
  };
}

const ACOES_DA_IA: readonly AcaoDaIa[] = ['passou_para_pessoa', 'marcou_visita', 'retomou'];

function lerIa(v: unknown): IaDoPainel | null {
  const o = objeto(v);
  if (!o) return null;
  return {
    conversas: numero(o.conversas),
    visitas: numero(o.visitas),
    passadas: numero(o.passadas),
    atendendo: numero(o.atendendo),
    eventos: lista(o.eventos).flatMap((e): EventoDaIa[] => {
      const x = objeto(e);
      const acao = x ? umDe(x.acao, ACOES_DA_IA) : null;
      const quando = x ? texto(x.quando) : null;
      if (!x || !acao || !quando) return [];
      return [
        {
          quando,
          acao,
          nome: texto(x.nome) ?? 'Cliente',
          caminho: texto(x.caminho),
          motivo: texto(x.motivo),
          visitaEm: texto(x.visita_em),
          codigo: texto(x.codigo),
        },
      ];
    }),
  };
}

const SITUACOES: readonly SituacaoDoLead[] = ['visita', 'ia', 'equipe', 'esperando', 'conversando'];

function lerLeads(v: unknown): LeadDoPainel[] | null {
  if (!Array.isArray(v)) return null;
  return v.flatMap((l): LeadDoPainel[] => {
    const x = objeto(l);
    const id = x ? texto(x.conversation_id) : null;
    const chegou = x ? texto(x.chegou) : null;
    if (!x || !id || !chegou) return [];
    return [
      {
        conversationId: id,
        nome: texto(x.nome) ?? 'Cliente sem nome',
        caminho: texto(x.caminho),
        chegou,
        canal: texto(x.canal),
        subcanal: texto(x.subcanal),
        codigo: texto(x.codigo),
        interesse: texto(x.interesse),
        situacao: umDe(x.situacao, SITUACOES) ?? 'conversando',
      },
    ];
  });
}

function lerImoveis(v: unknown): ImovelEmAlta[] | null {
  if (!Array.isArray(v)) return null;
  return v.flatMap((i): ImovelEmAlta[] => {
    const x = objeto(i);
    const codigo = x ? texto(x.codigo) : null;
    if (!x || !codigo) return [];
    return [
      {
        codigo,
        titulo: texto(x.titulo),
        bairro: texto(x.bairro),
        tipo: texto(x.tipo),
        interessados: numero(x.interessados),
        foto: texto(x.foto),
        anuncioId: texto(x.anuncio_id),
      },
    ];
  });
}

function lerImovelDaVisita(v: unknown): ImovelDaVisita | null {
  const x = objeto(v);
  const codigo = x ? texto(x.codigo) : null;
  if (!x || !codigo) return null;
  return {
    codigo,
    titulo: texto(x.titulo),
    tipo: texto(x.tipo),
    bairro: texto(x.bairro),
    cidade: texto(x.cidade),
    endereco: texto(x.endereco),
    foto: texto(x.foto),
  };
}

function lerAgenda(v: unknown): VisitaDeHoje[] {
  return lista(v).flatMap((a): VisitaDeHoje[] => {
    const x = objeto(a);
    const id = x ? texto(x.task_id) : null;
    const quando = x ? texto(x.quando) : null;
    if (!x || !id || !quando) return [];
    return [
      {
        taskId: id,
        quando,
        tipo: x.tipo === 'meeting' ? 'meeting' : 'visit',
        titulo: texto(x.titulo) ?? 'Visita',
        feito: x.feito === true,
        cliente: texto(x.cliente) ?? texto(x.titulo) ?? 'Cliente',
        organizationId: texto(x.organization_id),
        caminho: texto(x.caminho),
        local: texto(x.local),
        imovel: lerImovelDaVisita(x.imovel),
        confirmacao: umDe(x.confirmacao, ['confirmou', 'remarcar', 'aguardando'] as const),
        marcadaPor: umDe(x.marcada_por, ['ia', 'calendly'] as const),
      },
    ];
  });
}

function lerPrecisa(v: unknown): PainelDoDia['precisa'] {
  const o = objeto(v) ?? {};
  return {
    total: numero(o.total),
    itens: lista(o.itens).flatMap((p): Pendencia[] => {
      const x = objeto(p);
      const tipo = x ? umDe(x.tipo, ['ia', 'venceu', 'hoje'] as const) : null;
      if (!x || !tipo) return [];
      return [
        {
          tipo,
          titulo: texto(x.titulo) ?? 'Sem título',
          detalhe: texto(x.detalhe),
          quando: texto(x.quando),
          caminho: texto(x.caminho),
          acao: umDe(x.acao, ['responder', 'abrir', 'ligar'] as const) ?? 'abrir',
        },
      ];
    }),
  };
}

/** A resposta crua de `public.meu_dia_painel`, em tipos honestos. */
export function lerPainel(cru: unknown): PainelDoDia {
  const o = objeto(cru) ?? {};
  const p = objeto(o.periodo) ?? {};
  return {
    periodo: {
      nome: umDe(p.nome, PERIODOS) ?? 'hoje',
      de: texto(p.de) ?? '',
      ate: texto(p.ate) ?? '',
    },
    veTudo: o.ve_tudo === true,
    numeros: lerNumeros(o.numeros),
    ia: lerIa(o.ia),
    leads: lerLeads(o.leads),
    imoveis: lerImoveis(o.imoveis),
    agenda: lerAgenda(o.agenda),
    precisa: lerPrecisa(o.precisa),
  };
}

/**
 * A leitura. `pessoaId` só vai quando a gestão abre o dia de outra pessoa
 * (a agenda e as pendências mudam; números, IA, leads e imóveis são da empresa).
 */
export async function buscarPainel(
  periodo: PeriodoDoPainel,
  pessoaId?: string,
): Promise<PainelDoDia> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('meu_dia_painel', {
    p_periodo: periodo,
    ...(pessoaId ? { p_pessoa: pessoaId } : {}),
  });
  if (error) throw new ErroDoDia(error.message, error.code);
  return lerPainel(data);
}
