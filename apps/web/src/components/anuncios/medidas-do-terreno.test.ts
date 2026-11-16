import { describe, expect, it } from 'vitest';

import { areaDasMedidas, formatarMetros, lerMetros } from './tipos';

/**
 * A largura e o comprimento do terreno (20261116120000): a tela lê o que a
 * pessoa escreve em metros, com vírgula ou ponto, até duas casas, e avisa em
 * vez de apagar quando não entende. O pgTAP 174 confere o lado do banco.
 */
describe('medidas do terreno', () => {
  it('lê metros com vírgula, ponto, milhar e "m" no fim', () => {
    expect(lerMetros('12')).toBe(12);
    expect(lerMetros('12,5')).toBe(12.5);
    expect(lerMetros('12.5')).toBe(12.5);
    expect(lerMetros(' 12,50 m ')).toBe(12.5);
    expect(lerMetros('30M')).toBe(30);
    expect(lerMetros('1.200')).toBe(1200);
    expect(lerMetros('1.200,75')).toBe(1200.75);
  });

  it('arredonda a terceira casa como o banco (numeric(8,2))', () => {
    expect(lerMetros('12,345')).toBe(12.35);
    expect(lerMetros('0,004')).toBeUndefined();
  });

  it('vazio é medida nenhuma; lixo, zero e grande demais pedem correção', () => {
    expect(lerMetros('')).toBeNull();
    expect(lerMetros('   ')).toBeNull();
    expect(lerMetros('doze')).toBeUndefined();
    expect(lerMetros('12x30')).toBeUndefined();
    expect(lerMetros('0')).toBeUndefined();
    expect(lerMetros('-3')).toBeUndefined();
    expect(lerMetros('1000000')).toBeUndefined();
    expect(lerMetros('999999,99')).toBe(999999.99);
  });

  it('mostra a medida em pt-BR, sem milhar, para voltar ao campo', () => {
    expect(formatarMetros(12.5)).toBe('12,5');
    expect(formatarMetros(30)).toBe('30');
    expect(formatarMetros(1200.75)).toBe('1200,75');
    expect(formatarMetros(null)).toBe('');
    expect(lerMetros(formatarMetros(1200.75))).toBe(1200.75);
  });

  it('a área pelas medidas é largura × comprimento, em m² inteiros', () => {
    expect(areaDasMedidas(12, 30)).toBe(360);
    expect(areaDasMedidas(12.5, 30)).toBe(375);
    expect(areaDasMedidas(10.33, 25.5)).toBe(263);
    expect(areaDasMedidas(12, null)).toBeNull();
    expect(areaDasMedidas(null, null)).toBeNull();
    expect(areaDasMedidas(0.1, 0.1)).toBeNull();
  });
});
