import { TIMEZONE } from '@komune/schema';

/**
 * Formatação de data e hora da tela de registrar contato.
 *
 * Tudo em `America/Fortaleza` (CLAUDE.md): a Heloísa registra na calçada e o aparelho
 * dela pode estar em qualquer fuso quando ela viaja, mas "amanhã de manhã" é sempre
 * amanhã de manhã em Natal. E tudo curto: quem lê está de pé, com uma mão só.
 */

const DIA_CURTO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});

/**
 * O mesmo dia COM ano, para quando o ano não é o de hoje.
 *
 * Sem isto, o bloqueio permanente do catálogo (`cooldown_days = 36500`, quatro dos 34
 * desfechos) chega à tela como "dom, 11/08" — que quem está na calçada lê como 11 de
 * agosto do ano passado, ou seja, janela VENCIDA, exatamente o contrário do que o
 * dado diz. Ano diferente do de hoje é sempre escrito.
 */
const DIA_CURTO_COM_ANO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const ANO = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric' });

/** `true` quando a data cai em outro ano civil que não o de hoje, em Fortaleza. */
function deOutroAno(quando: Date, agora: Date = new Date()): boolean {
  return ANO.format(quando) !== ANO.format(agora);
}

const HORA_CURTA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
});

const DIA_LONGO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  weekday: 'long',
  day: '2-digit',
  month: 'long',
});

const DIA_LONGO_COM_ANO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

/** `2026-09-08T09:00:00-03:00` → "ter 08/09, 09:00". Hoje e amanhã viram palavra. */
export function formatarQuando(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return null;

  const hora = HORA_CURTA.format(quando);
  const dias = distanciaEmDias(quando);
  if (dias === 0) return `hoje, ${hora}`;
  if (dias === 1) return `amanhã, ${hora}`;
  // `replace` tira o ponto que o pt-BR põe no dia da semana abreviado ("ter." → "ter").
  const formato = deOutroAno(quando) ? DIA_CURTO_COM_ANO : DIA_CURTO;
  return `${formato.format(quando).replace('.', '')}, ${hora}`;
}

/** A mesma data por extenso, para o `title` e o leitor de tela. */
export function formatarQuandoPorExtenso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return null;
  const formato = deOutroAno(quando) ? DIA_LONGO_COM_ANO : DIA_LONGO;
  return `${formato.format(quando)}, às ${HORA_CURTA.format(quando)}`;
}

/** Dias civis de diferença entre um instante e agora, contados em Fortaleza. */
export function distanciaEmDias(quando: Date, agora: Date = new Date()): number {
  const dia = (d: Date) =>
    Date.parse(
      `${new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d)}T00:00:00Z`,
    );
  return Math.round((dia(quando) - dia(agora)) / 86_400_000);
}

/**
 * Valor para um `<input type="datetime-local">` a partir de um ISO, no fuso de
 * Fortaleza — o input não tem fuso, então quem o define somos nós.
 */
export function paraInputLocal(iso: string | null): string {
  const base = iso ? new Date(iso) : new Date();
  if (Number.isNaN(base.getTime())) return '';
  const partes = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(base);
  return partes.replace(' ', 'T');
}

/**
 * O caminho de volta: `2026-09-08T14:30` do input vira ISO com o deslocamento de
 * Fortaleza (UTC−3 o ano inteiro, sem horário de verão desde 2019).
 */
export function doInputLocal(valor: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) return null;
  const iso = `${valor}:00-03:00`;
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
}
