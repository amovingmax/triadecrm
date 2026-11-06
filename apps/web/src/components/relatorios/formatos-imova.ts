import type { TipoDeModelo } from './dados-imova';

/**
 * Formatos dos relatórios da Imova (06/11/2026). Puros, para o teste: o relógio
 * entra por parâmetro e o fuso é sempre o de Natal (America/Fortaleza).
 */

const FUSO = 'America/Fortaleza';

const DIA_E_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const SO_DIA = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });

const DIA_CIVIL = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const MOEDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const DOLAR = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const UM_DECIMAL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function instante(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "06/11 14:20". */
export function diaEHora(iso: string | null | undefined): string {
  const d = instante(iso);
  return d ? DIA_E_HORA.format(d).replace(',', '') : '';
}

/** "06/11". Aceita instante ou dia civil (`2026-11-06`, que já é o de Natal). */
export function soDia(iso: string | null | undefined): string {
  if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const d = instante(iso);
  return d ? SO_DIA.format(d) : '';
}

/**
 * Há quanto tempo, como se fala: "agora", "há 12 min", "há 3 h", "ontem", "há 5 dias",
 * e a data a partir de 30 dias. "Ontem" é o dia civil de Natal, não 24 horas.
 */
export function haQuanto(iso: string | null | undefined, agora: Date = new Date()): string {
  const d = instante(iso);
  if (!d) return '';
  const minutos = Math.floor((agora.getTime() - d.getTime()) / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const diaDe = (x: Date) => DIA_CIVIL.format(x);
  const dias = Math.round(
    (Date.parse(`${diaDe(agora)}T00:00:00Z`) - Date.parse(`${diaDe(d)}T00:00:00Z`)) / 86400000,
  );
  if (dias === 0) return `há ${Math.floor(minutos / 60)} h`;
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return soDia(iso);
}

/** O prazo já passou? */
export function venceu(iso: string | null | undefined, agora: Date = new Date()): boolean {
  const d = instante(iso);
  return d !== null && d.getTime() < agora.getTime();
}

/** "R$ 450.000", ou vazio. */
export function formatarReais(valor: number | null | undefined): string {
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? MOEDA.format(valor) : '';
}

/** Venda e aluguel juntos quando o anúncio tem os dois. */
export function precoDoAnuncio(venda: number | null, aluguel: number | null): string {
  const partes = [formatarReais(venda), aluguel ? `${formatarReais(aluguel)}/mês` : ''].filter(Boolean);
  return partes.join(' · ');
}

/** "US$ 0,16". */
export function formatarDolar(valor: number | null | undefined): string {
  return DOLAR.format(typeof valor === 'number' && Number.isFinite(valor) ? valor : 0).replace(/\s/g, ' ');
}

/** A nota da juíza: "4,2" (de 5), ou "—" sem nota. */
export function formatarNota(valor: number | null | undefined): string {
  return typeof valor === 'number' && Number.isFinite(valor) ? UM_DECIMAL.format(valor) : '—';
}

/** "32 s", "4 min". A IA responde em segundos; o time, em minutos. */
export function formatarSegundos(segundos: number | null | undefined): string {
  if (typeof segundos !== 'number' || !Number.isFinite(segundos)) return '—';
  const s = Math.max(0, Math.round(segundos));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} min` : `${Math.round(m / 60)} h`;
}

export const ROTULO_DO_TIPO_DE_MODELO: Record<TipoDeModelo, string> = {
  modelo: 'Modelo aprovado',
  resposta_rapida: 'Resposta rápida',
  texto_repetido: 'Texto do time',
};

/**
 * Quantos envios uma mensagem precisa ter (já com 24 h) para disputar "a que mais
 * funcionou". Com dois envios, uma resposta é 50%, e o ranking viraria sorteio.
 */
export const MINIMO_PARA_O_RANKING = 5;

/**
 * A mensagem que mais funcionou: a maior taxa de "respondeu e se interessou" entre as
 * que têm envios bastantes; empate vai para a que foi mais testada.
 */
export function aQueMaisFuncionou<
  L extends { maduros: number; taxa_positiva: number | null; interessaram: number },
>(linhas: readonly L[], minimo: number = MINIMO_PARA_O_RANKING): L | null {
  let melhor: L | null = null;
  for (const linha of linhas) {
    if (linha.maduros < minimo || linha.taxa_positiva === null || linha.interessaram === 0) continue;
    if (
      !melhor ||
      linha.taxa_positiva > (melhor.taxa_positiva ?? -1) ||
      (linha.taxa_positiva === melhor.taxa_positiva && linha.maduros > melhor.maduros)
    ) {
      melhor = linha;
    }
  }
  return melhor;
}

/** "Semana de 03/11". */
export function rotuloDaSemana(segunda: string): string {
  return `Semana de ${soDia(segunda)}`;
}
