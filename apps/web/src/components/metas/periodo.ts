import { TIMEZONE, type GoalPeriod } from '@komune/schema';

/**
 * A aritmética de período da tela de Metas (RF-MET-02), em funções puras.
 *
 * O banco é a verdade: `app.goal_bounds` normaliza o início do período (semana na
 * segunda, mês no dia 1) e `app.business_days` conta os dias úteis. Este arquivo
 * repete a MESMA regra do lado do navegador por dois motivos: a tela precisa saber
 * qual dia mandar em `p_ref` antes de a resposta chegar, e o rótulo ("Semana de
 * 31/08 a 06/09") tem de aparecer no esqueleto, enquanto a consulta ainda roda.
 * Quando os dois discordarem, o SQL vence — por isso a tela mostra `periodo_inicio`
 * e `periodo_fim` devolvidos pela função assim que eles chegam.
 *
 * Toda data aqui é um dia do calendário em `America/Fortaleza`, no formato
 * `YYYY-MM-DD`. A conta é feita em UTC de propósito: dia do calendário não tem hora,
 * e somar 7 dias num `Date` local quebraria no horário de verão de outro fuso.
 */

export type Periodo = GoalPeriod;

export const PERIODOS: readonly { valor: Periodo; rotulo: string }[] = [
  { valor: 'day', rotulo: 'Dia' },
  { valor: 'week', rotulo: 'Semana' },
  { valor: 'month', rotulo: 'Mês' },
];

/** Um pedaço de rótulo: `mono` liga a IBM Plex Mono (todo número da interface). */
export type Segmento = { texto: string; mono?: boolean };

const ISO_EM_NATAL = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DIA_DA_SEMANA = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' });
const MES_POR_EXTENSO = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' });

/** Hoje em Natal, como `YYYY-MM-DD`. */
export function hojeEmNatal(agora: Date = new Date()): string {
  return ISO_EM_NATAL.format(agora);
}

/** `YYYY-MM-DD` -> Date à meia-noite UTC (dia de calendário, sem hora). */
function paraData(iso: string): Date {
  const partes = iso.split('-');
  const ano = Number(partes[0]);
  const mes = Number(partes[1]);
  const dia = Number(partes[2]);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function paraIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/**
 * Primeiro dia do período que contém `iso`. Espelha `app.goal_bounds`:
 * dia = ele mesmo; semana = segunda-feira; mês = dia 1.
 */
export function inicioDoPeriodo(iso: string, periodo: Periodo): string {
  const data = paraData(iso);
  if (periodo === 'day') return iso;
  if (periodo === 'month') {
    return paraIso(new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), 1)));
  }
  // getUTCDay(): 0 = domingo. A semana do produto começa na segunda.
  const recuo = (data.getUTCDay() + 6) % 7;
  data.setUTCDate(data.getUTCDate() - recuo);
  return paraIso(data);
}

/** Último dia do período que começa em `inicio`. */
export function fimDoPeriodo(inicio: string, periodo: Periodo): string {
  const data = paraData(inicio);
  if (periodo === 'day') return inicio;
  if (periodo === 'month') {
    return paraIso(new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + 1, 0)));
  }
  data.setUTCDate(data.getUTCDate() + 6);
  return paraIso(data);
}

/** Anda `passos` períodos (negativo volta) a partir de um início já normalizado. */
export function deslocarPeriodo(inicio: string, periodo: Periodo, passos: number): string {
  const data = paraData(inicio);
  if (periodo === 'day') data.setUTCDate(data.getUTCDate() + passos);
  else if (periodo === 'week') data.setUTCDate(data.getUTCDate() + passos * 7);
  else data.setUTCMonth(data.getUTCMonth() + passos, 1);
  return inicioDoPeriodo(paraIso(data), periodo);
}

/** `true` quando o período que começa em `inicio` é o que contém hoje. */
export function ehPeriodoAtual(inicio: string, periodo: Periodo, hoje: string): boolean {
  return inicioDoPeriodo(hoje, periodo) === inicio;
}

/** `true` quando o período inteiro ainda não começou (não há realizado possível). */
export function ehPeriodoFuturo(inicio: string, hoje: string): boolean {
  return inicio > hoje;
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "04/09/2026" */
function dataCurta(iso: string): string {
  const partes = iso.split('-');
  return `${partes[2]}/${partes[1]}`;
}

/**
 * Rótulo do período, em pedaços: só o NÚMERO vai para a IBM Plex Mono. "Sexta-feira"
 * é palavra e fica na Poppins do resto da frase (mesma regra do EmConstrucao).
 */
export function rotuloDoPeriodo(inicio: string, periodo: Periodo, hoje: string): Segmento[] {
  const data = paraData(inicio);
  const ano = inicio.slice(0, 4);

  if (periodo === 'day') {
    const semana = DIA_DA_SEMANA.format(data);
    const abertura = inicio === hoje ? `Hoje, ${semana}, ` : `${capitalizar(semana)}, `;
    return [{ texto: abertura }, { texto: `${dataCurta(inicio)}/${ano}`, mono: true }];
  }

  if (periodo === 'week') {
    const fim = fimDoPeriodo(inicio, periodo);
    return [
      { texto: 'Semana de ' },
      { texto: dataCurta(inicio), mono: true },
      { texto: ' a ' },
      { texto: `${dataCurta(fim)}/${fim.slice(0, 4)}`, mono: true },
    ];
  }

  return [
    { texto: `${capitalizar(MES_POR_EXTENSO.format(data))} de ` },
    { texto: ano, mono: true },
  ];
}
