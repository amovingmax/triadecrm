import { describe, expect, it } from 'vitest';

import { horaDoQueDisse } from './hora-da-visita';

/** A hora que o cliente pediu para a visita, das palavras dele (25/11/2026, Imova). */
describe('horaDoQueDisse', () => {
  it.each([
    ['sábado às 10h', '10:00'],
    ['segunda às 15h', '15:00'],
    ['quinta 10h30', '10:30'],
    ['amanhã 14:45', '14:45'],
    ['sexta, 9 horas', '09:00'],
    ['às 16', '16:00'],
    ['quarta 10 e meia', '10:30'],
    ['10h e meia', '10:30'],
    ['3 da tarde', '15:00'],
    ['8 e meia da noite', '20:30'],
    ['9h da manhã', '09:00'],
    ['12 da tarde', '12:00'],
    ['ao meio-dia', '12:00'],
    ['meio dia de sábado', '12:00'],
  ])('"%s" → %s', (texto, hora) => {
    expect(horaDoQueDisse(texto)).toBe(hora);
  });

  it.each([
    ['quinta de manhã'],
    ['sexta à tarde'],
    ['dia 10'],
    ['dia 28/11'],
    ['semana que vem'],
    [''],
  ])('sem hora clara: "%s" → null', (texto) => {
    expect(horaDoQueDisse(texto)).toBeNull();
  });

  it('sem texto, null', () => {
    expect(horaDoQueDisse(null)).toBeNull();
    expect(horaDoQueDisse(undefined)).toBeNull();
  });
});
