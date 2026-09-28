import { describe, expect, it } from 'vitest';

import { nomeExibido } from './formatos';

/**
 * Com que nome a pessoa aparece na lista e no cabeçalho da conversa.
 *
 * O problema real: até 28/09/2026 o CRM jogava fora o `profile.name` que a Meta
 * manda em toda mensagem, e 193 conversas de produção se chamavam "Contato do
 * WhatsApp (11) 5128-5383". Rafael: "colocando o nome do fornecedor ou produtor
 * inves do numero".
 *
 * A regra tem dois lados, e o segundo é o que importa: o nome que gente digitou
 * numa ficha VENCE o apelido do WhatsApp. Um fornecedor cadastrado como "Buffet
 * Aurora" não vira "aurora buffet 24h ⭐" porque foi assim que a pessoa escreveu
 * no próprio celular.
 */
describe('nomeExibido', () => {
  it('usa o nome do perfil quando a ficha só tem o rótulo com o número', () => {
    expect(nomeExibido('Contato do WhatsApp (84) 99999-8801', 'Buffet Sabor do Sol')).toBe(
      'Buffet Sabor do Sol',
    );
  });

  it('não troca o nome de uma ficha que gente cadastrou', () => {
    expect(nomeExibido('Buffet Aurora', 'aurora buffet 24h ⭐')).toBe('Buffet Aurora');
  });

  it('sem nome de perfil, o rótulo com o número continua — não vira vazio', () => {
    expect(nomeExibido('Contato do WhatsApp (84) 99999-8801', null)).toBe(
      'Contato do WhatsApp (84) 99999-8801',
    );
  });

  it('nome de perfil só com espaço não conta como nome', () => {
    expect(nomeExibido('Contato do WhatsApp (84) 99999-8801', '   ')).toBe(
      'Contato do WhatsApp (84) 99999-8801',
    );
  });

  it('a ficha que COMEÇA com o rótulo é a mesma coisa que o rótulo', () => {
    // O banco monta 'Contato do WhatsApp ' || telefone_legivel(...): o que vem
    // depois do prefixo varia, então quem decide é o prefixo.
    expect(nomeExibido('Contato do WhatsApp +5584999998801', 'Neuma Leão')).toBe('Neuma Leão');
  });

  it('não confunde uma ficha que apenas CITA WhatsApp no nome', () => {
    expect(nomeExibido('Zap Buffet Contato do WhatsApp', 'apelido')).toBe(
      'Zap Buffet Contato do WhatsApp',
    );
  });
});
