import { formatPhoneBr, TIMEZONE } from '@komune/schema';

/**
 * Formatação da tela de Parceiros. Sem travessão em nenhum texto visível, e todo
 * número sai pronto para o utilitário `numerico` (IBM Plex Mono com tabular-nums).
 *
 * Tudo que envolve data usa o fuso `America/Fortaleza` (CLAUDE.md): o time está em
 * Natal e a "próxima ação de amanhã às 9h" precisa ser amanhã às 9h para todo mundo.
 */

const DATA_CURTA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: TIMEZONE,
});

/**
 * Data só de dígitos (04/09/2026), e não por extenso: ela sai em IBM Plex Mono, e mono
 * serve para alinhar número, não para vestir uma frase inteira.
 */
const DATA_NUMERICA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: TIMEZONE,
});

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});

const NUMERO = new Intl.NumberFormat('pt-BR');

/** Contagens da interface (total de resultados, páginas). */
export function formatarNumero(n: number): string {
  return NUMERO.format(n);
}

/** Telefone E.164 em formato brasileiro; a máscara do banco passa intacta. */
export function formatarTelefone(valor: string | null | undefined): string {
  if (!valor) return '';
  return formatPhoneBr(valor) ?? valor;
}

export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '';
  return DATA_NUMERICA.format(new Date(iso));
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '';
  return DATA_HORA.format(new Date(iso));
}

/**
 * Próxima ação lida de relance: "hoje", "amanhã", "em 3 d", "atrasada 2 d".
 * `numero` marca quando o texto principal é um número (para receber a fonte mono);
 * `atrasada` deixa a linha decidir o peso, sem gastar cor (a cor é da temperatura).
 */
export function formatarProximaAcao(iso: string | null | undefined): {
  texto: string;
  detalhe: string;
  numero: boolean;
  atrasada: boolean;
} | null {
  if (!iso) return null;

  const alvo = new Date(iso);
  const dias = diasDeDiferenca(new Date(), alvo);
  const detalhe = `${DATA_CURTA.format(alvo)}, ${DATA_HORA.format(alvo).slice(-5)}`;

  if (dias === 0) return { texto: 'hoje', detalhe, numero: false, atrasada: false };
  if (dias === 1) return { texto: 'amanhã', detalhe, numero: false, atrasada: false };
  if (dias === -1) return { texto: 'ontem', detalhe, numero: false, atrasada: true };
  if (dias < 0)
    return { texto: `${Math.abs(dias)} d atrás`, detalhe, numero: true, atrasada: true };
  return { texto: `em ${dias} d`, detalhe, numero: true, atrasada: false };
}

/**
 * Diferença em dias de calendário no fuso de Natal (e não em blocos de 24 horas):
 * às 23h, "amanhã às 9h" tem de aparecer como amanhã, não como "em 0 dias".
 */
export function diasDeDiferenca(de: Date, para: Date): number {
  const dia = (d: Date) => {
    const partes = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: TIMEZONE,
    }).format(d);
    return Date.parse(`${partes}T00:00:00Z`);
  };
  return Math.round((dia(para) - dia(de)) / 86_400_000);
}

/** "Ponta Negra, Natal" — sem repetir nada quando um dos dois falta. */
export function formatarLocal(
  bairro: string | null | undefined,
  cidade: string | null | undefined,
): string {
  return [bairro, cidade].filter(Boolean).join(', ');
}

/** Rótulo do tipo de organização (enum `app.org_kind`). */
export const ROTULO_TIPO: Record<string, string> = {
  fornecedor: 'Fornecedor',
  produtor: 'Produtor',
  cerimonialista: 'Cerimonialista',
  espaco: 'Espaço',
  empresa: 'Empresa',
  outro: 'Outro',
};

/** Link de conversa no WhatsApp a partir do E.164 (só quando o número está revelado). */
export function linkWhatsapp(e164: string | null | undefined): string | null {
  if (!e164 || !/^\+\d{12,13}$/.test(e164)) return null;
  return `https://wa.me/${e164.replace(/\D/g, '')}`;
}
