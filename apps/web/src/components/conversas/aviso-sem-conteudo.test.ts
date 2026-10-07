import { describe, expect, it } from 'vitest';

import { avisoSemConteudo } from './tipos';

/**
 * O defeito que estes testes travam (07/10/2026): a tela dizia "Aviso do WhatsApp
 * sem arquivo guardado: o CRM não baixou esta mídia da Meta" para o que nunca foi
 * mídia. O Rafael viu quatro seguidas e foi procurar o que não carregava.
 */
describe('o que dizer de uma mensagem sem texto e sem arquivo', () => {
  it('nenhuma frase fala em "não baixou esta mídia": isso é do aviso das mídias, não daqui', () => {
    const tipos = ['system', 'interactive', 'reaction', 'text', 'template'] as const;
    const metas = [null, 'unsupported', 'location', 'contacts', 'sticker', 'coisa_nova'];
    for (const tipo of tipos) {
      for (const tipoNaMeta of metas) {
        expect(avisoSemConteudo({ tipo, tipoNaMeta })).not.toMatch(/não baixou/);
      }
    }
  });

  it('o que a Meta não entrega diz por quê e o que fazer', () => {
    const frase = avisoSemConteudo({ tipo: 'system', tipoNaMeta: 'unsupported' });
    expect(frase).toMatch(/só abre no celular/);
    expect(frase).toMatch(/peça para a pessoa mandar de novo/);
  });

  it('localização e cartão de contato dizem o que são', () => {
    expect(avisoSemConteudo({ tipo: 'system', tipoNaMeta: 'location' })).toMatch(/^Localização/);
    expect(avisoSemConteudo({ tipo: 'system', tipoNaMeta: 'contacts' })).toMatch(/^Cartão de contato/);
  });

  it('tipo que o CRM ainda não conhece aparece pelo nome, para alguém poder pedir', () => {
    expect(avisoSemConteudo({ tipo: 'system', tipoNaMeta: 'order' })).toBe(
      'Mensagem do tipo "order", que o CRM ainda não sabe mostrar.',
    );
  });

  it('sem o tipo original (mensagem de antes de 07/10), não inventa', () => {
    expect(avisoSemConteudo({ tipo: 'system', tipoNaMeta: null })).toMatch(/^Mensagem sem conteúdo/);
  });

  it('texto sem corpo continua sendo a retenção de 12 meses', () => {
    expect(avisoSemConteudo({ tipo: 'text', tipoNaMeta: null })).toMatch(/retenção de 12 meses/);
  });
});
