import { describe, expect, it } from 'vitest';

import { buscaPorTrechoDeTelefone, prepararConsulta } from './busca';

/**
 * A RPC `search_organizations` desliga a busca por "contém" para quem não lê o
 * telefone de base (sdr, embaixador). Estes casos fixam quando a tela avisa isso no
 * estado vazio: só quando o texto é digito de telefone que a busca por igualdade não
 * casaria, nunca quando o número está completo (aí o zero resultado é zero mesmo).
 */
describe('buscaPorTrechoDeTelefone', () => {
  it.each([
    ['2451', 'os quatro últimos dígitos lidos num cartão'],
    ['3000-245', 'um trecho com pontuação de telefone'],
    ['123456789012', 'doze dígitos que não viram um número válido'],
  ])('%s é trecho de telefone (%s)', (entrada) => {
    expect(buscaPorTrechoDeTelefone(entrada)).toBe(true);
  });

  it.each([
    ['84930002451', 'número completo com DDD'],
    ['+55 84 93000-2451', 'número completo em E.164 escrito à mão'],
    ['930002451', 'número local de Natal (o banco assume o DDD 84)'],
    ['12345678000195', 'CNPJ de 14 dígitos'],
    ['245', 'menos de quatro dígitos (nem para quem lê PII a busca por trecho roda)'],
    ['Buffet Brisa', 'nome de parceiro'],
    ['@buffetbrisa', 'perfil do Instagram'],
    ['', 'campo vazio'],
  ])('%s não é trecho de telefone (%s)', (entrada) => {
    expect(buscaPorTrechoDeTelefone(entrada)).toBe(false);
  });

  it('o que vira E.164 vai para a RPC normalizado, e não como trecho', () => {
    expect(prepararConsulta('84 93000-2451')).toBe('+5584930002451');
    expect(buscaPorTrechoDeTelefone('84 93000-2451')).toBe(false);
  });
});
