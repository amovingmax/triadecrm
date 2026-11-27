import { describe, expect, it } from 'vitest';

import {
  custoDoChamado,
  enderecoDoChamado,
  fraseDoMotivoDoChamado,
  limparParametro,
  mostraChamarComIA,
  problemaDoImovel,
  problemaDoNome,
  textoDoChamado,
} from './chamar-com-a-ia';

/**
 * "Chamar com a IA" (27/11/2026): o texto é o do modelo aprovado pelo dono, as
 * regras do nome e do imóvel são as mesmas do banco (`public.portal_lead_chamar`),
 * e cada recusa vira uma frase que diz o que fazer.
 */
describe('o texto', () => {
  it('é o modelo aprovado, com o nome e o trecho limpos', () => {
    expect(textoDoChamado('  Cesar ', 'na sala comercial de 19 m²   no Brisa Mall, no OLX')).toBe(
      'Olá, Cesar! Aqui é da Imova. Vimos seu interesse na sala comercial de 19 m² no Brisa Mall, no OLX. Posso te passar mais informações?',
    );
    expect(limparParametro(' a \n b\t c ')).toBe('a b c');
  });
});

describe('as regras (as mesmas do banco)', () => {
  it('nome: só letras, sem número, até 40', () => {
    expect(problemaDoNome('Maria')).toBeNull();
    expect(problemaDoNome('João')).toBeNull();
    expect(problemaDoNome('Cesar 84')).not.toBeNull();
    expect(problemaDoNome('   ')).not.toBeNull();
    expect(problemaDoNome('a'.repeat(41))).not.toBeNull();
  });

  it('imóvel: de 5 a 160 letras, sem número que pareça telefone', () => {
    expect(problemaDoImovel('no terreno de 3.000 m² em Capim Macio')).toBeNull();
    expect(problemaDoImovel('na')).not.toBeNull();
    expect(problemaDoImovel('na sala, ligue 84 98820-9001')).not.toBeNull();
    expect(problemaDoImovel('x'.repeat(161))).not.toBeNull();
  });
});

describe('o custo, as recusas e o botão', () => {
  it('o custo segue a categoria que a Meta deu', () => {
    expect(custoDoChamado('utility')).toMatch(/R\$ 0,04/);
    expect(custoDoChamado('marketing')).toMatch(/R\$ 0,32/);
  });

  it('cada recusa diz o que fazer; fora do horário diz quando abre', () => {
    expect(fraseDoMotivoDoChamado('modelo_pending')).toMatch(/análise na Meta/);
    expect(fraseDoMotivoDoChamado('numero_suprimido')).toMatch(/não ser contatada/);
    expect(fraseDoMotivoDoChamado('janela_antes_da_abertura', '2030-01-07T08:00:00-03:00')).toBe(
      'Fora do horário de envio do WhatsApp. Dá para mandar a partir de 07/01/2030 às 08:00.',
    );
    expect(fraseDoMotivoDoChamado('ficha_catalogo_incompleto')).toMatch(/ficha/);
    expect(fraseDoMotivoDoChamado('algo_novo')).toBe('Não deu certo. Tente de novo.');
  });

  it('o botão aparece só para quem ainda não tem conversa e não foi descartado', () => {
    const base = {
      conversation_id: null,
      situacao: 'novo',
      contato_apagado_em: null,
      suprimido: false,
    } as const;
    expect(mostraChamarComIA(base)).toBe(true);
    expect(mostraChamarComIA({ ...base, conversation_id: 'c1' })).toBe(false);
    expect(mostraChamarComIA({ ...base, situacao: 'descartado' })).toBe(false);
    expect(mostraChamarComIA({ ...base, suprimido: true })).toBe(false);
    expect(mostraChamarComIA({ ...base, contato_apagado_em: '2026-11-27' })).toBe(false);
  });

  it('a conversa abre pela ficha quando há ficha', () => {
    expect(enderecoDoChamado('c1', 'o1')).toBe('/conversas?org=o1');
    expect(enderecoDoChamado('c1', null)).toBe('/conversas?cliente=c1');
  });
});
