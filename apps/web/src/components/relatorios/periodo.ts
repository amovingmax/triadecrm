import { TIMEZONE } from '@komune/schema';

/**
 * O período dos relatórios, sempre em dias inteiros do fuso de Natal.
 *
 * Todas as funções `relatorio_*` do banco recebem `p_de` e `p_ate` como DATA
 * (inclusiva nas duas pontas) e convertem para `America/Fortaleza` lá dentro. Aqui
 * a conta é só de calendário: nada de `Date` com hora, que no navegador de quem
 * estiver fora do fuso viraria o dia errado.
 *
 * "Hoje" também é o hoje de Natal, e não o do relógio da máquina: às 22h de Natal
 * um navegador em UTC já estaria no dia seguinte e pediria um período que ainda não
 * começou.
 */

export type ChavePeriodo = 'sete' | 'trinta' | 'mes' | 'mes_passado' | 'personalizado';

export type Periodo = {
  chave: ChavePeriodo;
  /** Primeiro dia, inclusivo, no formato `aaaa-mm-dd`. */
  de: string;
  /** Último dia, inclusivo, no formato `aaaa-mm-dd`. */
  ate: string;
};

export const ROTULO_PERIODO: Record<ChavePeriodo, string> = {
  sete: '7 dias',
  trinta: '30 dias',
  mes: 'Este mês',
  mes_passado: 'Mês passado',
  personalizado: 'Escolher',
};

/** As opções na ordem em que aparecem na barra. */
export const PERIODOS_EM_ORDEM: readonly ChavePeriodo[] = [
  'sete',
  'trinta',
  'mes',
  'mes_passado',
  'personalizado',
];

const DIA_ISO = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: TIMEZONE,
});

const FORMATO_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** O dia de hoje em Natal, no formato `aaaa-mm-dd`. */
export function hojeEmNatal(agora: Date = new Date()): string {
  return DIA_ISO.format(agora);
}

/** Soma (ou subtrai) dias de calendário a um dia `aaaa-mm-dd`. */
export function somarDias(dia: string, dias: number): string {
  const base = Date.parse(`${dia}T00:00:00Z`);
  return new Date(base + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Primeiro dia do mês de `dia`. */
export function primeiroDoMes(dia: string): string {
  return `${dia.slice(0, 7)}-01`;
}

/** Quantos dias inteiros o período cobre, contando as duas pontas. */
export function diasNoPeriodo(periodo: Periodo): number {
  const de = Date.parse(`${periodo.de}T00:00:00Z`);
  const ate = Date.parse(`${periodo.ate}T00:00:00Z`);
  return Math.round((ate - de) / 86_400_000) + 1;
}

/** Monta o período de uma opção da barra. `personalizado` mantém o que já estava. */
export function periodoDe(chave: ChavePeriodo, hoje: string, atual?: Periodo): Periodo {
  switch (chave) {
    case 'sete':
      return { chave, de: somarDias(hoje, -6), ate: hoje };
    case 'trinta':
      return { chave, de: somarDias(hoje, -29), ate: hoje };
    case 'mes':
      return { chave, de: primeiroDoMes(hoje), ate: hoje };
    case 'mes_passado': {
      const ate = somarDias(primeiroDoMes(hoje), -1);
      return { chave, de: primeiroDoMes(ate), ate };
    }
    case 'personalizado':
      return {
        chave,
        de: atual?.de ?? somarDias(hoje, -29),
        ate: atual?.ate ?? hoje,
      };
  }
}

/** `true` quando as duas datas existem, estão no formato e a ordem faz sentido. */
export function periodoValido(periodo: Periodo): boolean {
  return (
    FORMATO_DIA.test(periodo.de) && FORMATO_DIA.test(periodo.ate) && periodo.de <= periodo.ate
  );
}

/** `2026-09-04` vira `04/09/2026`, sem passar por `Date` (o dia já é o de Natal). */
export function formatarDia(dia: string): string {
  if (!FORMATO_DIA.test(dia)) return dia;
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
}

/** "de 06/08/2026 a 04/09/2026" para o cabeçalho e para o nome do arquivo CSV. */
export function faixaDoPeriodo(periodo: Periodo): string {
  return `${formatarDia(periodo.de)} a ${formatarDia(periodo.ate)}`;
}

/** Recorte inicial vindo da URL (`?de=…&ate=…&p=…`), para que um link abra igual. */
export function periodoDaUrl(
  params: Record<string, string | string[] | undefined>,
  hoje: string,
): Periodo {
  const primeiro = (valor: string | string[] | undefined) =>
    Array.isArray(valor) ? valor[0] : valor;
  const de = primeiro(params.de);
  const ate = primeiro(params.ate);
  if (de && ate && FORMATO_DIA.test(de) && FORMATO_DIA.test(ate) && de <= ate) {
    return { chave: 'personalizado', de, ate };
  }
  const chave = primeiro(params.periodo);
  if (chave && (PERIODOS_EM_ORDEM as readonly string[]).includes(chave) && chave !== 'personalizado') {
    return periodoDe(chave as ChavePeriodo, hoje);
  }
  return periodoDe('trinta', hoje);
}

/** A query string que representa o recorte atual. */
export function urlDoRecorte(periodo: Periodo, painel: string): string {
  const params = new URLSearchParams({ painel });
  if (periodo.chave === 'personalizado') {
    params.set('de', periodo.de);
    params.set('ate', periodo.ate);
  } else {
    params.set('periodo', periodo.chave);
  }
  return `?${params.toString()}`;
}

/** O dia de Natal a que pertence um instante do banco (`timestamptz` em ISO). */
export function diaDoInstante(iso: string): string {
  return DIA_ISO.format(new Date(iso));
}

/** Os dias do período, em ordem. `maximo` protege contra um intervalo absurdo na URL. */
export function diasDoPeriodo(periodo: Periodo, maximo = 400): string[] {
  const dias: string[] = [];
  let dia = periodo.de;
  while (dia <= periodo.ate && dias.length < maximo) {
    dias.push(dia);
    dia = somarDias(dia, 1);
  }
  return dias;
}
