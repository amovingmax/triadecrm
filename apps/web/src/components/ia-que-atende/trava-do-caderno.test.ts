import { describe, expect, it } from 'vitest';

import { fraseDaTrava, problemaDoCaderno } from './trava-do-caderno';

/** A trava do caderno (27/11/2026): a mesma regra de `app.ia_caderno_problema`. */
describe('a trava do caderno', () => {
  it('acha o "1.338,99, 2.021" de 19/11, com o trecho', () => {
    expect(problemaDoCaderno('FICHA 4. PIPA: os lotes têm 1.338,99, 2.021 m² ao lado do parque.')).toEqual({
      tipo: 'telefone',
      trecho: '1.338,99, 2.021',
    });
  });

  it('telefone, e-mail, @ e Instagram travam; valor, data e medida com palavra no meio não', () => {
    expect(problemaDoCaderno('Para visitar, ligue (84) 98820-9001.')?.tipo).toBe('telefone');
    expect(problemaDoCaderno('Mande para contato@imova.com.br')).toEqual({ tipo: 'contato', trecho: 'contato@imova.com.br' });
    expect(problemaDoCaderno('Siga @imovaimobiliaria')?.tipo).toBe('contato');
    expect(problemaDoCaderno('Fotos em instagram.com/imova')?.tipo).toBe('contato');
    expect(problemaDoCaderno('(a) O valor é R$ 520.000 (equipe, 23/11). (d) 12 m por 68 m.')).toBeNull();
    expect(problemaDoCaderno('Os 1.338 m² e os 2.021 m² somam mais de 3 mil.')).toBeNull();
  });

  it('a frase diz o trecho e como reescrever', () => {
    expect(fraseDaTrava({ tipo: 'telefone', trecho: '1.338,99, 2.021' })).toMatch(
      /“1\.338,99, 2\.021” parece telefone.*pararia de responder.*Separe os números com palavras/,
    );
    expect(fraseDaTrava({ tipo: 'contato', trecho: '@imova' })).toMatch(/“@imova” parece e-mail ou @/);
  });
});
