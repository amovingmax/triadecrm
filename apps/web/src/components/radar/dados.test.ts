import { describe, expect, it } from 'vitest';

import { MOTIVO_DA_FONTE, MOTIVO_DA_REVISAO, mensagemDoErro, paraFonte } from './dados';
import type { LinhaDeFonte } from './dados';

/**
 * `sources.config` é jsonb livre: das 11 fontes do catálogo, cada uma traz um
 * conjunto diferente de chaves, e nenhuma é garantida. Se a leitura quebrar ou
 * inventar valor, a tela passa a mentir sobre o que uma fonte pode coletar — que é
 * justamente o que este módulo existe para não fazer.
 */
function linha(parcial: Partial<LinhaDeFonte> = {}): LinhaDeFonte {
  return {
    id: 1,
    slug: 'casamentos_com_br',
    name: 'Casamentos.com.br',
    kind: 'scrape',
    base_url: 'https://www.casamentos.com.br',
    legal_basis: 'legitimo_interesse',
    terms_notes: 'Coleta de baixo volume, mensal.',
    robots_ok: true,
    is_enabled: true,
    rate_limit_seconds: '4.00',
    config: {},
    ...parcial,
  };
}

describe('paraFonte', () => {
  it('lê o coletor, os campos permitidos e a nota do robots.txt', () => {
    const fonte = paraFonte(
      linha({
        config: {
          robots: '/json/ bloqueado',
          collector: { kind: 'http', phase: 'mvp', enabled: true, schedule: 'mensal' },
          fields_whitelist: ['name', 'category'],
        },
      }),
    );

    expect(fonte.coletor).toBe('http');
    expect(fonte.fase).toBe('mvp');
    expect(fonte.periodicidade).toBe('mensal');
    expect(fonte.coletor_pronto).toBe(true);
    expect(fonte.campos).toEqual(['name', 'category']);
    expect(fonte.robots_nota).toBe('/json/ bloqueado');
  });

  it('aguenta config vazia sem inventar nada', () => {
    const fonte = paraFonte(linha({ config: {} }));

    expect(fonte.coletor).toBeNull();
    expect(fonte.fase).toBeNull();
    expect(fonte.periodicidade).toBeNull();
    expect(fonte.coletor_pronto).toBe(false);
    expect(fonte.campos).toEqual([]);
    expect(fonte.robots_nota).toBeNull();
    expect(fonte.curadoria_manual).toBe(false);
  });

  it('aguenta config nula, string ou lista (jsonb aceita tudo isso)', () => {
    for (const config of [null, 'texto', [1, 2, 3], 42]) {
      const fonte = paraFonte(linha({ config }));
      expect(fonte.campos).toEqual([]);
      expect(fonte.coletor).toBeNull();
    }
  });

  it('descarta campo permitido que não seja texto', () => {
    const fonte = paraFonte(linha({ config: { fields_whitelist: ['name', 7, null, 'cep'] } }));
    expect(fonte.campos).toEqual(['name', 'cep']);
  });

  it('só marca o coletor como pronto quando o valor é exatamente true', () => {
    expect(paraFonte(linha({ config: { collector: { enabled: 'true' } } })).coletor_pronto).toBe(
      false,
    );
    expect(paraFonte(linha({ config: { collector: { enabled: 1 } } })).coletor_pronto).toBe(false);
    expect(paraFonte(linha({ config: { collector: { enabled: true } } })).coletor_pronto).toBe(
      true,
    );
  });

  it('converte o intervalo, que vem como texto do numeric do Postgres', () => {
    expect(paraFonte(linha({ rate_limit_seconds: '4.00' })).intervalo_segundos).toBe(4);
    expect(paraFonte(linha({ rate_limit_seconds: '0.00' })).intervalo_segundos).toBe(0);
    expect(paraFonte(linha({ rate_limit_seconds: 10 })).intervalo_segundos).toBe(10);
  });

  it('preserva robots_ok nulo (não avaliado) sem virar false', () => {
    expect(paraFonte(linha({ robots_ok: null })).robots_ok).toBeNull();
    expect(paraFonte(linha({ robots_ok: false })).robots_ok).toBe(false);
  });
});

describe('mensagemDoErro', () => {
  it('nunca devolve texto cru do Postgres', () => {
    expect(mensagemDoErro(new Error('permission denied for function radar_fila'))).toBe(
      'O seu acesso não trabalha a fila do Radar.',
    );
    expect(mensagemDoErro(new Error('JWT expired'))).toBe('A sua sessão expirou.');
    expect(mensagemDoErro(new Error('TypeError: Failed to fetch'))).toBe(
      'O aplicativo não alcançou o servidor.',
    );
    expect(mensagemDoErro(new Error('duplicate key value violates unique constraint'))).toBe(
      'O servidor não respondeu como esperado.',
    );
    expect(mensagemDoErro('qualquer coisa')).toBe('O servidor não respondeu como esperado.');
  });
});

describe('motivos traduzidos', () => {
  it('cobre todos os motivos que as RPCs de revisão e de fonte devolvem', () => {
    for (const motivo of [
      'candidato_inexistente',
      'ja_revisado',
      'motivo_obrigatorio',
      'acao_invalida',
      'candidato_nao_contatar',
      'categoria_obrigatoria',
      'organizacao_obrigatoria',
      'organizacao_inexistente',
      'organizacao_fora_da_carteira',
      'ja_existe_na_base',
    ]) {
      expect(MOTIVO_DA_REVISAO[motivo]).toBeTruthy();
    }
    for (const motivo of [
      'fonte_inexistente',
      'robots_nao_avaliado',
      'robots_proibe_coleta',
      'termos_nao_avaliados',
    ]) {
      expect(MOTIVO_DA_FONTE[motivo]).toBeTruthy();
    }
  });
});
