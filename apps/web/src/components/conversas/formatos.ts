import { TIMEZONE } from '@komune/schema';

/**
 * Formatação da linha do tempo. Tudo no fuso `America/Fortaleza` (CLAUDE.md): o time
 * está em Natal, e "a ligação de ontem às 17h" tem de ser ontem às 17h para todo mundo,
 * inclusive para quem abrir o CRM de outro fuso.
 *
 * Regra do sistema visual: mono é para NÚMERO, não para frase. Por isso as funções
 * daqui devolvem a data em pedaços — o dígito separado da palavra —, como
 * `formatarDiasSemContato` e `formatarProximaAcao` já fazem nos outros módulos.
 * Zero travessão em texto visível.
 */

const HORA = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});

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

const DIA_SEMANA = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  timeZone: TIMEZONE,
});

const ISO_LOCAL = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: TIMEZONE,
});

/** `aaaa-mm-dd` no fuso de Natal: é a chave que agrupa os eventos por dia. */
export function chaveDoDia(iso: string): string {
  return ISO_LOCAL.format(new Date(iso));
}

/** "14:59" no fuso de Natal. Sai inteiro em mono (é só dígito e dois-pontos). */
export function hora(iso: string): string {
  return HORA.format(new Date(iso));
}

/** "04/09/2026, 14:59" para `title` e leitor de tela. */
export function dataHoraCompleta(iso: string): string {
  return `${DIA_MES_ANO.format(new Date(iso))}, ${HORA.format(new Date(iso))}`;
}

/**
 * Rótulo do separador de dia, em três pedaços para o dígito ir sozinho para a mono:
 * "hoje", "ontem", "sexta-feira, 04/09" ou "04/09/2026" (fora do ano corrente).
 */
export function rotuloDoDia(
  iso: string,
  agora: Date = new Date(),
): { palavra: string; numero: string | null; completo: string } {
  const dias = diasDeCalendario(agora, new Date(iso));
  const completo = DIA_MES_ANO.format(new Date(iso));

  if (dias === 0) return { palavra: 'hoje', numero: null, completo };
  if (dias === -1) return { palavra: 'ontem', numero: null, completo };

  const mesmoAno = ISO_LOCAL.format(agora).slice(0, 4) === ISO_LOCAL.format(new Date(iso)).slice(0, 4);
  if (mesmoAno && dias > -7) {
    return { palavra: `${DIA_SEMANA.format(new Date(iso))}, `, numero: DIA_MES.format(new Date(iso)), completo };
  }
  return { palavra: '', numero: mesmoAno ? DIA_MES.format(new Date(iso)) : completo, completo };
}

/**
 * Diferença em dias de CALENDÁRIO no fuso de Natal (negativo para o passado), e não
 * em blocos de 24 horas: às 00h30, a ligação das 23h de ontem é "ontem", não "hoje".
 */
export function diasDeCalendario(de: Date, para: Date): number {
  const dia = (d: Date) => Date.parse(`${ISO_LOCAL.format(d)}T00:00:00Z`);
  return Math.round((dia(para) - dia(de)) / 86_400_000);
}

/** "23 min" — duração da ligação ou da reunião, com o dígito separado da unidade. */
export function duracao(minutos: number | null): { numero: string; unidade: string } | null {
  if (minutos === null || minutos <= 0) return null;
  if (minutos < 60) return { numero: String(minutos), unidade: ' min' };
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0
    ? { numero: String(horas), unidade: horas === 1 ? ' hora' : ' horas' }
    : { numero: `${horas}h${String(resto).padStart(2, '0')}`, unidade: '' };
}

/** "Ponta Negra, Natal" — sem repetir nada quando um dos dois falta. */
export function local(bairro: string | null, cidade: string | null): string {
  return [bairro, cidade].filter(Boolean).join(', ');
}

const NUMERO = new Intl.NumberFormat('pt-BR');

export function numero(n: number): string {
  return NUMERO.format(n);
}

/** "1 interação" / "12 interações", com o dígito separado para ir à mono. */
export function contagemDeInteracoes(n: number): { numero: string; palavra: string } {
  return { numero: NUMERO.format(n), palavra: n === 1 ? ' interação' : ' interações' };
}
