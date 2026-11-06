import { describe, expect, it } from 'vitest';

import {
  aQueMaisFuncionou,
  diaEHora,
  formatarNota,
  formatarSegundos,
  haQuanto,
  precoDoAnuncio,
  rotuloDaSemana,
  soDia,
  venceu,
} from './formatos-imova';
import { paineisDaEmpresa, painelDaUrl, painelUsaPeriodo } from './tipos';

// 06/11/2026 15:00 em Natal (UTC-3).
const AGORA = new Date('2026-11-06T18:00:00Z');

describe('formatos dos relatórios da Imova', () => {
  it('fala o tempo como gente, no dia civil de Natal', () => {
    expect(haQuanto('2026-11-06T17:59:40Z', AGORA)).toBe('agora');
    expect(haQuanto('2026-11-06T17:48:00Z', AGORA)).toBe('há 12 min');
    expect(haQuanto('2026-11-06T13:00:00Z', AGORA)).toBe('há 5 h');
    // 23:30 de ontem em Natal é "ontem", mesmo com menos de 24 h.
    expect(haQuanto('2026-11-06T02:30:00Z', AGORA)).toBe('ontem');
    expect(haQuanto('2026-11-01T12:00:00Z', AGORA)).toBe('há 5 dias');
    expect(haQuanto('2026-09-01T12:00:00Z', AGORA)).toBe('01/09');
    expect(haQuanto(null, AGORA)).toBe('');
  });

  it('dia e hora no fuso de Natal', () => {
    expect(diaEHora('2026-11-06T18:05:00Z')).toBe('06/11 15:05');
    expect(soDia('2026-11-03')).toBe('03/11');
    expect(rotuloDaSemana('2026-11-02')).toBe('Semana de 02/11');
  });

  it('prazo vencido é o que já passou', () => {
    expect(venceu('2026-11-06T17:00:00Z', AGORA)).toBe(true);
    expect(venceu('2026-11-07T17:00:00Z', AGORA)).toBe(false);
    expect(venceu(null, AGORA)).toBe(false);
  });

  it('preço de venda e de aluguel juntos', () => {
    expect(precoDoAnuncio(450000, null)).toMatch(/^R\$\s450\.000$/);
    expect(precoDoAnuncio(null, 2500)).toMatch(/^R\$\s2\.500\/mês$/);
    expect(precoDoAnuncio(null, null)).toBe('');
  });

  it('nota e tempo de resposta', () => {
    expect(formatarNota(4.25)).toBe('4,3');
    expect(formatarNota(null)).toBe('—');
    expect(formatarSegundos(32)).toBe('32 s');
    expect(formatarSegundos(600)).toBe('10 min');
    expect(formatarSegundos(null)).toBe('—');
  });

  it('a que mais funcionou precisa de envios bastantes e de interesse', () => {
    const linhas = [
      { chave: 'a', maduros: 2, taxa_positiva: 100, interessaram: 2 },
      { chave: 'b', maduros: 10, taxa_positiva: 40, interessaram: 4 },
      { chave: 'c', maduros: 20, taxa_positiva: 40, interessaram: 8 },
      { chave: 'd', maduros: 8, taxa_positiva: 0, interessaram: 0 },
    ];
    expect(aQueMaisFuncionou(linhas)?.chave).toBe('c');
    expect(aQueMaisFuncionou(linhas.slice(0, 1))).toBeNull();
    expect(aQueMaisFuncionou(linhas.slice(3))).toBeNull();
  });
});

describe('os painéis de cada empresa', () => {
  it('a KOMUNE continua com os mesmos dez painéis, na mesma ordem', () => {
    expect(paineisDaEmpresa(false).map((p) => p.chave)).toEqual([
      'ligacoes',
      'atendimento',
      'semana',
      'funil',
      'categorias',
      'bairros',
      'pessoas',
      'horarios',
      'fontes',
      'base',
    ]);
  });

  it('a Imova abre na Visão geral e não vê os painéis da captação', () => {
    expect(paineisDaEmpresa(true).map((p) => p.chave)).toEqual([
      'visao',
      'quentes',
      'anuncios',
      'mensagens',
      'ia',
      'atendimento',
      'funil',
      'pessoas',
    ]);
  });

  it('o painel da URL só vale se existir na empresa', () => {
    const imova = paineisDaEmpresa(true);
    const komune = paineisDaEmpresa(false);
    expect(painelDaUrl(undefined, imova)).toBe('visao');
    expect(painelDaUrl('bairros', imova)).toBe('visao');
    expect(painelDaUrl('quentes', imova)).toBe('quentes');
    expect(painelDaUrl(undefined, komune)).toBe('ligacoes');
    expect(painelDaUrl('quentes', komune)).toBe('ligacoes');
  });

  it('clientes quentes é o retrato de agora: sem barra de período', () => {
    expect(painelUsaPeriodo('quentes')).toBe(false);
    expect(painelUsaPeriodo('anuncios')).toBe(true);
    expect(painelUsaPeriodo('visao')).toBe(true);
  });
});
