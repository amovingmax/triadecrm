import { formatarQuandoPorExtenso } from '@/components/registro/formatos';

import { type EstadoDaJanela, type MotivoDeBloqueio } from './tipos';

/**
 * Como a tela conta o bloqueio da janela de horário (R13 §6).
 *
 * `MENSAGENS_DE_BLOQUEIO` (em `tipos.ts`) traz uma frase fechada por motivo, e ela
 * inclui a previsão em palavras: "Domingo não se liga. A fila volta amanhã às 9h."
 * A previsão em palavras nem sempre é verdade — no domingo 06/09/2026 a segunda-feira
 * é feriado da Independência, e a fila só volta na TERÇA. Mostrar a frase fechada ao
 * lado da contagem regressiva calculada punha duas datas diferentes na mesma linha.
 *
 * Então a tela usa o motivo em uma frase curta (sem previsão) e a previsão sai de
 * `abreEm`, que é o valor calculado a partir da `holidays` real — a mesma régua do
 * banco. Uma data só, e ela é a certa.
 */
const MOTIVO_CURTO: Record<MotivoDeBloqueio, string> = {
  domingo: 'Domingo não se liga.',
  feriado: 'Hoje é feriado.',
  antes_da_abertura: 'Cedo demais para ligar.',
  depois_do_fechamento: 'Passou do horário de ligar.',
};

/** A frase completa do bloqueio: o motivo e quando a janela abre de novo. */
export function fraseDoBloqueio(janela: Extract<EstadoDaJanela, { aberta: false }>): string {
  const abertura = formatarQuandoPorExtenso(janela.abreEm);
  const quando = abertura ? ` Abre ${abertura}.` : '';
  return `${MOTIVO_CURTO[janela.motivo]}${quando}`;
}

/** O horário de trabalho, escrito por extenso. É a resposta a "então quando posso?". */
export const HORARIO_PERMITIDO =
  'Segunda a sexta das 9h às 20h, sábado das 10h às 13h. Domingo e feriado não.';
