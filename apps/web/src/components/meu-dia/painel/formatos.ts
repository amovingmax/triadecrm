import {
  CANAIS_DE_CHEGADA,
  ROTULO_DO_CANAL,
  ROTULO_DO_SUBCANAL,
  subcanalValido,
  type CanalDeChegada,
  type SubcanalDeChegada,
} from '@komune/schema';

import type {
  Confirmacao,
  EventoDaIa,
  IaDoPainel,
  PeriodoDoPainel,
  SituacaoDoLead,
  VisitaDeHoje,
} from './dados';

/**
 * Os textos do Painel do dia (17/11/2026), em funções puras. Fuso de Natal em
 * toda hora e dia, como o resto do CRM.
 */

const FUSO = 'America/Fortaleza';

const HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
});
const DIA = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
const DIA_DA_SEMANA = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'short' });
const DATA_CHAVE = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "14:00", no fuso de Natal. */
export function horaDe(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : HORA.format(t);
}

function chaveDoDia(t: number): string {
  return DATA_CHAVE.format(t);
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

// ---------------------------------------------------------------------------
// Período e números
// ---------------------------------------------------------------------------

export const ROTULO_DO_PERIODO: Record<PeriodoDoPainel, string> = {
  hoje: 'Hoje',
  semana: '7 dias',
  mes: 'Mês',
};

const COMPARADO_A: Record<PeriodoDoPainel, string> = {
  hoje: 'que ontem',
  semana: 'que nos 7 dias anteriores',
  mes: 'que no mesmo período do mês passado',
};

export type Variacao = { texto: string; curta: string; tom: 'sobe' | 'desce' | 'igual' };

/** "3 a mais que ontem", "2 a menos que nos 7 dias anteriores", "igual a ontem". */
export function variacao(agora: number, antes: number, periodo: PeriodoDoPainel): Variacao {
  const d = agora - antes;
  if (d === 0) {
    return {
      texto: periodo === 'hoje' ? 'igual a ontem' : 'igual ao período anterior',
      curta: 'igual',
      tom: 'igual',
    };
  }
  return {
    texto: `${Math.abs(d)} a ${d > 0 ? 'mais' : 'menos'} ${COMPARADO_A[periodo]}`,
    curta: `${Math.abs(d)}`,
    tom: d > 0 ? 'sobe' : 'desce',
  };
}

/** O rótulo curto de cada dia da série: "qua", "qui"… e "hoje" no último. */
export function rotulosDosDias(dias: readonly string[], hoje: string): string[] {
  return dias.map((d) => {
    if (d === hoje) return 'hoje';
    const t = Date.parse(`${d}T12:00:00-03:00`);
    return Number.isNaN(t) ? '' : DIA_DA_SEMANA.format(t).replace('.', '');
  });
}

/** A meta do mês, em porcentagem de 0 a 100 (nula sem meta). */
export function progressoDaMeta(noMes: number, meta: number | null): number | null {
  if (meta === null || meta <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((noMes / meta) * 100)));
}

// ---------------------------------------------------------------------------
// Tempo relativo
// ---------------------------------------------------------------------------

/** "há 25 min", "há 3 h", "ontem, 19:40", "12/11". */
export function haQuanto(iso: string, agora: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const min = Math.round((agora - t) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (chaveDoDia(t) === chaveDoDia(agora)) return `há ${Math.floor(min / 60)} h`;
  if (chaveDoDia(t) === chaveDoDia(agora - 86400000)) return `ontem, ${HORA.format(t)}`;
  return DIA.format(t);
}

/** Para a visita de hoje: "em 1 h 20", "em 15 min", "agora" ou "já passou". */
export function faltaPara(iso: string, agora: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const min = Math.round((t - agora) / 60000);
  if (min < -60) return 'já passou';
  if (min <= 5) return 'agora';
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0 ? `em ${h} h` : `em ${h} h ${String(resto).padStart(2, '0')}`;
}

/** A próxima visita ainda por fazer (a do botão principal), ou nula. */
export function proximaVisita(
  agenda: readonly VisitaDeHoje[],
  agora: number = Date.now(),
): string | null {
  const proxima = agenda.find((v) => !v.feito && Date.parse(v.quando) >= agora - 3600000);
  return proxima?.taskId ?? null;
}

// ---------------------------------------------------------------------------
// Imóvel, endereço e origem
// ---------------------------------------------------------------------------

/** "TE0004" de "TE0004_IMOVA": o sufixo da empresa não diz nada na tela. */
export function codigoCurto(codigo: string): string {
  return codigo.replace(/_[A-Z]+$/i, '');
}

const TIPO_DO_IMOVEL: Record<string, string> = {
  apartamento: 'Apartamento',
  casa: 'Casa',
  casa_condominio: 'Casa em condomínio',
  terreno: 'Terreno',
  sala_comercial: 'Sala comercial',
  loja: 'Loja',
  galpao: 'Galpão',
  cobertura: 'Cobertura',
  flat: 'Flat',
  sitio: 'Sítio',
  chacara: 'Chácara',
};

/** "Terreno", "Sala comercial"; o tipo cru com a primeira maiúscula quando não há rótulo. */
export function rotuloDoTipo(tipo: string | null): string | null {
  if (!tipo) return null;
  return TIPO_DO_IMOVEL[tipo] ?? tipo.charAt(0).toUpperCase() + tipo.slice(1).replace(/_/g, ' ');
}

/**
 * O título do imóvel na linha: o do anúncio, sem a parte de preço depois da
 * barra ("Repasse Loja de Plantas + Casa Anexa | R$ 120 mil" vira só o nome),
 * ou o tipo.
 */
export function nomeDoImovel(titulo: string | null, tipo: string | null): string {
  const limpo = titulo?.split('|')[0]?.trim();
  return limpo || rotuloDoTipo(tipo) || 'Imóvel';
}

/** O link do Google Maps para "Como chegar". */
export function linkDoMapa(endereco: string | null): string | null {
  if (!endereco) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`;
}

function ehCanal(v: string | null): v is CanalDeChegada {
  return v !== null && (CANAIS_DE_CHEGADA as readonly string[]).includes(v);
}

/** De onde o lead veio: o subcanal quando diz mais ("Portal ZAP"), senão o canal. */
export function rotuloDaOrigem(canal: string | null, subcanal: string | null): string {
  if (!ehCanal(canal)) return 'Identificando…';
  if (subcanal && subcanal !== 'desconhecido' && subcanalValido(canal, subcanal)) {
    return ROTULO_DO_SUBCANAL[subcanal as SubcanalDeChegada];
  }
  return ROTULO_DO_CANAL[canal];
}

/** As iniciais para o avatar: "JR" de "Juliana Rocha". */
export function iniciais(nome: string): string {
  const partes = nome
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (partes.length === 0) return '?';
  const [primeira, ...resto] = partes;
  const ultima = resto.at(-1);
  return ((primeira?.[0] ?? '') + (ultima?.[0] ?? '')).toUpperCase();
}

// ---------------------------------------------------------------------------
// Selos
// ---------------------------------------------------------------------------

export type Tom = 'ok' | 'aviso' | 'perigo' | 'ia' | 'neutro' | 'marca';

export const SELO_DA_SITUACAO: Record<SituacaoDoLead, { rotulo: string; tom: Tom }> = {
  visita: { rotulo: 'Visita marcada', tom: 'ok' },
  ia: { rotulo: 'IA atendendo', tom: 'ia' },
  equipe: { rotulo: 'Com a equipe', tom: 'marca' },
  esperando: { rotulo: 'Esperando resposta', tom: 'aviso' },
  conversando: { rotulo: 'Em conversa', tom: 'neutro' },
};

/** O selo da visita: a confirmação manda; sem ela, quem marcou. */
export function seloDaVisita(v: VisitaDeHoje): { rotulo: string; tom: Tom } | null {
  if (v.feito) return { rotulo: 'Feita', tom: 'neutro' };
  const porConfirmacao: Record<Confirmacao, { rotulo: string; tom: Tom }> = {
    confirmou: { rotulo: 'Cliente confirmou', tom: 'ok' },
    remarcar: { rotulo: 'Pediu para remarcar', tom: 'perigo' },
    aguardando: { rotulo: 'Ainda não confirmou', tom: 'aviso' },
  };
  if (v.confirmacao) return porConfirmacao[v.confirmacao];
  if (v.marcadaPor === 'ia') return { rotulo: 'Marcada pela IA', tom: 'ia' };
  if (v.marcadaPor === 'calendly') return { rotulo: 'Pelo Calendly', tom: 'ia' };
  return null;
}

// ---------------------------------------------------------------------------
// A IA
// ---------------------------------------------------------------------------

const NO_PERIODO: Record<PeriodoDoPainel, string> = {
  hoje: 'hoje',
  semana: 'nos últimos 7 dias',
  mes: 'neste mês',
};

/** "Atendeu 12 pessoas, marcou 2 visitas e passou 1 cliente para a equipe." */
export function fraseDaIa(ia: IaDoPainel, periodo: PeriodoDoPainel): string {
  if (ia.conversas === 0 && ia.visitas === 0 && ia.passadas === 0) {
    return `Nenhuma conversa ${NO_PERIODO[periodo]} ainda.`;
  }
  const partes = [`atendeu ${plural(ia.conversas, 'pessoa', 'pessoas')}`];
  if (ia.visitas > 0) partes.push(`marcou ${plural(ia.visitas, 'visita', 'visitas')}`);
  if (ia.passadas > 0) {
    partes.push(`passou ${plural(ia.passadas, 'cliente', 'clientes')} para a equipe`);
  }
  const ultima = partes.pop() as string;
  const frase = partes.length > 0 ? `${partes.join(', ')} e ${ultima}` : ultima;
  return `${frase.charAt(0).toUpperCase()}${frase.slice(1)}.`;
}

function minuscula(frase: string): string {
  const limpa = frase.trim().replace(/\.$/, '');
  return limpa.charAt(0).toLowerCase() + limpa.slice(1);
}

/** Uma linha do que a IA fez. */
export function textoDoEvento(e: EventoDaIa, agora: number = Date.now()): string {
  if (e.acao === 'passou_para_pessoa') {
    return e.motivo
      ? `Passou ${e.nome} para a equipe: ${minuscula(e.motivo)}.`
      : `Passou ${e.nome} para a equipe.`;
  }
  if (e.acao === 'marcou_visita') {
    const quando = e.visitaEm ? quandoDaVisita(e.visitaEm, agora) : null;
    const onde = e.codigo ? ` no ${codigoCurto(e.codigo)}` : '';
    return `Marcou visita com ${e.nome}${quando ? ` ${quando}` : ''}${onde}.`;
  }
  return `Retomou a conversa com ${e.nome}.`;
}

/** "hoje às 14:00", "amanhã às 9:30", "em 21/11 às 10:00". */
export function quandoDaVisita(iso: string, agora: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const hora = HORA.format(t);
  if (chaveDoDia(t) === chaveDoDia(agora)) return `hoje às ${hora}`;
  if (chaveDoDia(t) === chaveDoDia(agora + 86400000)) return `amanhã às ${hora}`;
  return `em ${DIA.format(t)} às ${hora}`;
}

/** A linha de baixo do cabeçalho: "3 visitas hoje · a IA atendeu 12 pessoas hoje". */
export function resumoDoCabecalho(
  visitasHoje: number,
  ia: IaDoPainel | null,
  periodo: PeriodoDoPainel,
): string[] {
  const partes: string[] = [];
  partes.push(
    visitasHoje === 0 ? 'nenhuma visita hoje' : `${plural(visitasHoje, 'visita', 'visitas')} hoje`,
  );
  if (ia && ia.conversas > 0) {
    partes.push(`a IA atendeu ${plural(ia.conversas, 'pessoa', 'pessoas')} ${NO_PERIODO[periodo]}`);
  }
  return partes;
}
