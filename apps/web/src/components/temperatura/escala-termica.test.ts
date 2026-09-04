import { describe, expect, it } from 'vitest';
import { Constants } from '@komune/schema';

import { formatarDiasSemContato } from './dias-sem-contato';
import {
  compararPorTemperatura,
  definicaoTemperatura,
  ESCALA_TERMICA,
  TEMPERATURAS_EM_ORDEM,
} from './escala-termica';

describe('escala térmica', () => {
  it('cobre exatamente os valores do enum app.temperature', () => {
    expect(Object.keys(ESCALA_TERMICA).sort()).toEqual([...Constants.app.Enums.temperature].sort());
  });

  it('ordena igual ao Postgres (a ordem de declaração do enum)', () => {
    expect(TEMPERATURAS_EM_ORDEM.map((t) => t.valor)).toEqual([...Constants.app.Enums.temperature]);
    expect(compararPorTemperatura('frio', 'quente')).toBeLessThan(0);
    expect(compararPorTemperatura('cliente_ativo', 'cliente')).toBeGreaterThan(0);
  });

  it('cai em frio quando a temperatura é nula ou desconhecida', () => {
    expect(definicaoTemperatura(null).valor).toBe('frio');
    expect(definicaoTemperatura(undefined).valor).toBe('frio');
    expect(definicaoTemperatura('gelado').valor).toBe('frio');
    expect(definicaoTemperatura('quente').rotulo).toBe('Quente');
  });

  it('nenhum rótulo usa travessão ou emoji', () => {
    for (const definicao of TEMPERATURAS_EM_ORDEM) {
      expect(definicao.rotulo).not.toMatch(/[—–]/u);
      expect(definicao.descricao).not.toMatch(/[—–]/u);
    }
  });
});

describe('dias sem contato', () => {
  it('trata hoje, ontem e nulo sem mostrar número', () => {
    expect(formatarDiasSemContato(0).visivel.numero).toBe('hoje');
    expect(formatarDiasSemContato(1).visivel.numero).toBe('ontem');
    expect(formatarDiasSemContato(null).visivel.numero).toBe('sem contato');
    expect(formatarDiasSemContato(undefined).mono).toBe(false);
  });

  it('mostra o número com a unidade curta e a descrição por extenso', () => {
    const doze = formatarDiasSemContato(12);
    expect(doze.visivel).toEqual({ numero: '12', unidade: 'd' });
    expect(doze.descricao).toBe('12 dias desde o último contato.');
    expect(doze.mono).toBe(true);
  });

  it('arredonda para baixo e não aceita dias negativos', () => {
    expect(formatarDiasSemContato(9.8).visivel.numero).toBe('9');
    expect(formatarDiasSemContato(-3).visivel.numero).toBe('hoje');
  });
});
