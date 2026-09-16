import { describe, expect, it } from 'vitest';

import { esquemaParaAApi } from './cliente';
import { fichaDaConversaV1, pulsoDoDiaV1, esquemaDeSaida } from '@komune/prompts';

/**
 * O esquema que sai daqui é a única parte do pedido que a API valida ANTES de
 * pensar: se ele estiver errado, a chamada morre em 400 e o erro não diz qual
 * prompt foi. O dublê não pega isso — ele responde, não valida.
 *
 * A primeira chamada real de `ficha-da-conversa@v1` descobriu que a saída
 * estruturada recusa `minimum`/`maximum` em `integer`. Este arquivo existe para
 * essa descoberta não precisar ser feita duas vezes, e para o prompt NOVO de
 * amanhã não repetir o mesmo 400.
 */

function achar(no: unknown, encontrou: (n: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (Array.isArray(no)) return no.flatMap((i) => achar(i, encontrou));
  if (typeof no !== 'object' || no === null) return [];
  const atual = no as Record<string, unknown>;
  const aqui = encontrou(atual) ? [atual] : [];
  return [...aqui, ...Object.values(atual).flatMap((v) => achar(v, encontrou))];
}

describe('o esquema que vai para a API', () => {
  const RESTRICOES_DE_VALOR = [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
    'pattern',
    'format',
    'multipleOf',
    'uniqueItems',
    'default',
    'examples',
  ];

  it('não leva restrição de valor nenhuma: a API recusa e a lista é descoberta a 400 por vez', () => {
    for (const prompt of [fichaDaConversaV1, pulsoDoDiaV1]) {
      const limpo = esquemaParaAApi(esquemaDeSaida(prompt));
      const sobraram = achar(limpo, (n) => RESTRICOES_DE_VALOR.some((k) => k in n));
      expect({ prompt: prompt.id, sobraram }).toEqual({ prompt: prompt.id, sobraram: [] });
    }
  });

  it('mas a FORMA continua inteira: sem ela o modelo não sabe o que devolver', () => {
    const limpo = esquemaParaAApi(esquemaDeSaida(fichaDaConversaV1)) as Record<string, unknown>;
    expect(limpo.type).toBe('object');
    const propriedades = limpo.properties as Record<string, unknown>;
    expect(Object.keys(propriedades)).toContain('scoreIntencao');
    expect(Object.keys(propriedades)).toContain('sinais');
    // Campo que é enum continua com as opções — é o que impede intenção inventada.
    const enums = achar(limpo, (n) => Array.isArray(n.enum));
    expect(enums.length).toBeGreaterThan(0);
    expect(limpo.required).toBeDefined();
  });

  it('e o zod continua recusando o que estiver fora da faixa', () => {
    // A poda é só no que o modelo VÊ. Quem garante a faixa é a volta.
    expect(() =>
      fichaDaConversaV1.saida.parse({
        resumo: 'x',
        intencao: 'AMBIGUO',
        scoreIntencao: 140,
        motivo: 'x',
        sentimento: 'neutro',
        sinais: [],
        objecoes: [],
        etapaSugerida: null,
        compromissosNovos: [],
        compromissosCumpridos: [],
        proximaAcao: { descricao: 'x', prazo: null },
        dadosExtraidos: [],
        alertas: [],
        confianca: 0.5,
        dadosInsuficientes: false,
      }),
    ).toThrow();
  });

  it('$schema não vira tráfego', () => {
    expect('$schema' in esquemaParaAApi(esquemaDeSaida(fichaDaConversaV1))).toBe(false);
  });
});
