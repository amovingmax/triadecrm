import { TIMEZONE } from '@komune/schema';

/**
 * Tudo o que estas duas telas escrevem sobre tempo passa por aqui, e tudo em
 * `America/Fortaleza`: o aparelho da Heloísa pode estar em qualquer fuso, mas o dia
 * de trabalho é o de Natal.
 *
 * A separação em `prefixo`/`numero`/`sufixo` de `meu-dia` não se repete aqui porque
 * estas telas usam número solto (a hora, o atraso em dias), e a classe `numerico`
 * entra direto no `<span>` que o envolve.
 */

const HORA = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TIMEZONE,
});

const DATA_COMPLETA = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TIMEZONE,
});

const DIA_POR_EXTENSO = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: TIMEZONE,
});

/** "10:00" na hora de Natal. Instante ausente vira travessão, nunca "Invalid Date". */
export function hora(quando: string | null): string {
  if (!quando) return '—';
  const data = new Date(quando);
  return Number.isNaN(data.getTime()) ? '—' : HORA.format(data);
}

/** "sexta-feira, 05/09 às 10:00" — para `title` e leitor de tela. */
export function dataCompleta(quando: string | null): string {
  if (!quando) return 'sem data';
  const data = new Date(quando);
  return Number.isNaN(data.getTime()) ? 'sem data' : DATA_COMPLETA.format(data);
}

/**
 * "Sexta-feira, 5 de setembro" a partir da data civil que o banco devolveu.
 *
 * Recebe `YYYY-MM-DD` e não um instante: o dia do resumo é o dia civil de Fortaleza,
 * já recortado pelo Postgres. Interpretar essa string como instante local traria o
 * dia anterior para quem estivesse a oeste, que é exatamente o erro que o fuso único
 * do produto existe para evitar — daí o `T12:00:00` que ancora no meio do dia.
 */
export function diaPorExtenso(dia: string): string {
  const data = new Date(`${dia}T12:00:00-03:00`);
  if (Number.isNaN(data.getTime())) return dia;
  const texto = DIA_POR_EXTENSO.format(data);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * O atraso de um item da fila, em texto curto: "há 3 d", "há 5 h", "há 20 min".
 *
 * O número vem calculado do banco (`atraso_horas`), então a fila, o resumo e o
 * relatório nunca discordam sobre há quanto tempo algo está vencido. `numeric` do
 * Postgres chega como string no PostgREST quando é grande; por isso a união.
 *
 * As duas escolhas aqui existem para BATER com o motivo que o banco manda na mesma
 * linha ("Tarefa vencida há 19 dia(s)"). Dois números para a mesma coisa, lado a
 * lado, fazem a pessoa parar de confiar nos dois.
 *
 *   * o corte para dias é 48 h, e não 24 h, porque é onde `public.meu_dia` corta:
 *     abaixo disso ele escreve horas ("vencida há 40 h"), acima escreve dias;
 *   * o dia ARREDONDA, e não trunca, porque o banco conta DIAS CIVIS de Fortaleza —
 *     truncar 448 h daria "há 18 d" colado num "há 19 dia(s)".
 */
export function atrasoEmTexto(horas: number | string | null): string | null {
  if (horas === null) return null;
  const n = typeof horas === 'number' ? horas : Number.parseFloat(horas);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1) return `há ${Math.max(1, Math.round(n * 60))} min`;
  if (n < 48) return `há ${Math.round(n)} h`;
  return `há ${Math.round(n / 24)} d`;
}

/**
 * "visto há 3 min" para a batida do worker. Nulo quando ninguém nunca bateu ponto —
 * e nesse caso a tela diz "nunca", que é diferente de "faz tempo".
 */
export function vistoHa(quando: string | null, agora: Date = new Date()): string {
  if (!quando) return 'nunca';
  const data = new Date(quando);
  if (Number.isNaN(data.getTime())) return 'nunca';
  const minutos = Math.round((agora.getTime() - data.getTime()) / 60_000);
  if (minutos < 1) return 'agora mesmo';
  if (minutos < 60) return `há ${minutos} min`;
  if (minutos < 60 * 24) return `há ${Math.round(minutos / 60)} h`;
  return `há ${Math.round(minutos / (60 * 24))} d`;
}

/**
 * A agenda de cron em português.
 *
 * Só os dois formatos que o produto usa hoje (`*​/15 * * * *` e `0 10 * * *`); o
 * resto volta como veio, porque uma tradução errada de horário é pior do que a
 * expressão crua.
 */
export function agendaEmPortugues(expressao: string): string {
  const aCada = /^\*\/(\d+) \* \* \* \*$/.exec(expressao);
  if (aCada) return `a cada ${aCada[1]} minutos`;
  const diario = /^(\d+) (\d+) \* \* \*$/.exec(expressao);
  if (diario) {
    const minuto = diario[1]?.padStart(2, '0') ?? '00';
    const horaDoDia = diario[2]?.padStart(2, '0') ?? '00';
    return `todo dia às ${horaDoDia}:${minuto}`;
  }
  return expressao;
}
