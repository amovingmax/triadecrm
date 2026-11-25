/**
 * A hora que o cliente pediu para a visita, tirada das palavras dele (25/11/2026, Imova).
 *
 * O aviso dos admins mostra "o dia e o horário que o cliente solicitou" (pedido do dono).
 * A IA (`atendente-imova@v9`) devolve o dia, o período e `comoDisse`, as palavras do
 * cliente sobre o dia ("sábado às 10h"). A hora sai dessas palavras, aqui, sem mudar o
 * prompt: "10h", "10h30", "10:30", "10 horas", "às 10", "10 e meia", "3 da tarde",
 * "meio-dia". Sem hora clara, null (vale o período). O banco ainda descarta hora fora de
 * 6h–22h e hora sem dia (`public.ia_atendente_pedir_visita`).
 */

const PERIODO_DA_TARDE = new Set(['tarde', 'noite']);

function hhmm(hora: number, minuto: number): string | null {
  if (!Number.isInteger(hora) || !Number.isInteger(minuto)) return null;
  if (hora < 0 || hora > 23 || minuto < 0 || minuto > 59) return null;
  return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
}

function minutos(trecho: string | undefined): number {
  if (trecho === undefined || trecho === '') return 0;
  return trecho === 'meia' ? 30 : Number(trecho);
}

export function horaDoQueDisse(texto: string | null | undefined): string | null {
  if (texto === null || texto === undefined) return null;
  const t = texto.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (t.trim() === '') return null;

  if (/\bmeio[- ]?dia\b/.test(t)) return '12:00';

  // "3 da tarde", "9h da manhã", "8 e meia da noite"
  const comPeriodo = t.match(
    /\b(\d{1,2})(?:\s*(?:h|:)\s*(\d{2}))?(?:\s*(?:h|horas?))?(?:\s*e\s*(meia|\d{2}))?\s+da\s+(manha|tarde|noite)\b/,
  );
  if (comPeriodo) {
    let hora = Number(comPeriodo[1]);
    const periodo = comPeriodo[4] ?? '';
    if (PERIODO_DA_TARDE.has(periodo) && hora < 12) hora += 12;
    return hhmm(hora, minutos(comPeriodo[2] ?? comPeriodo[3]));
  }

  // "10h", "10h30", "10:30", "10 horas", "10h e meia"
  const comMarca = t.match(/\b([01]?\d|2[0-3])\s*(?:h|:|horas?\b)\s*([0-5]\d)?(?:\s*e\s*meia)?/);
  if (comMarca) {
    const meia = /\be\s*meia/.test(comMarca[0]);
    return hhmm(Number(comMarca[1]), meia ? 30 : minutos(comMarca[2]));
  }

  // "10 e meia"
  const eMeia = t.match(/\b([01]?\d|2[0-3])\s+e\s+meia\b/);
  if (eMeia) return hhmm(Number(eMeia[1]), 30);

  // "às 10" (e não "dia 10" nem "10/12")
  const as = t.match(/\bas\s+([01]?\d|2[0-3])\b(?!\s*\/)/);
  if (as) return hhmm(Number(as[1]), 0);

  return null;
}
