import { describe, expect, it } from 'vitest';

import { montarLinhasDeCanais, resumirCanais, rotuloDoCanalNoRelatorio } from './canais';
import type { LinhaCanal } from './tipos';

function linha(
  canal: string,
  subcanal: string,
  chegadas: number,
  extra: Partial<LinhaCanal> = {},
): LinhaCanal {
  return {
    canal,
    subcanal,
    chegadas,
    leads_novos: 0,
    ja_na_base: 0,
    sem_ficha: 0,
    atendidos: 0,
    visitas_marcadas: 0,
    visitas_realizadas: 0,
    ganhos: 0,
    por_regra: 0,
    por_ia: 0,
    por_gente: 0,
    corrigidos: 0,
    com_foto_da_placa: 0,
    com_foto_do_banner: 0,
    ...extra,
  };
}

describe('montarLinhasDeCanais', () => {
  const dados = [
    linha('anuncios', 'portal_zap', 3, { ganhos: 1 }),
    linha('placa', 'foto_do_banner', 2, { com_foto_do_banner: 2 }),
    linha('placa', 'foto_da_placa', 4, { com_foto_da_placa: 4, ganhos: 1 }),
    linha('nao_identificado', 'desconhecido', 1),
  ];
  const linhas = montarLinhasDeCanais(dados);

  it('vai canal por canal, na ordem de sempre, com os detalhes embaixo', () => {
    expect(linhas.map((l) => l.rotuloCompleto)).toEqual([
      'Placa',
      'Placa · Foto da placa',
      'Placa · Foto do banner',
      'Anúncios',
      'Anúncios · ZAP Imóveis',
      'Redes sociais',
      'Outros',
      'Não identificado',
    ]);
  });

  it('o total do canal soma os detalhes e a parte é sobre todas as chegadas', () => {
    const placa = linhas.find((l) => l.chave === 'canal:placa');
    expect(placa).toMatchObject({
      nivel: 'canal',
      chegadas: 6,
      ganhos: 1,
      com_foto_da_placa: 4,
      com_foto_do_banner: 2,
    });
    expect(placa?.parte).toBeCloseTo(60);
  });

  it('canal sem chegada aparece com zero, e Não identificado não tem detalhe', () => {
    const redes = linhas.find((l) => l.chave === 'canal:redes_sociais');
    expect(redes?.chegadas).toBe(0);
    expect(redes?.parte).toBe(0);
    expect(linhas.filter((l) => l.chave.startsWith('detalhe:nao_identificado'))).toEqual([]);
  });

  it('sem linha nenhuma, a tabela fica vazia', () => {
    expect(montarLinhasDeCanais([])).toEqual([]);
  });

  it('canal que a tela não conhece vai para o fim, com o nome do banco', () => {
    const r = montarLinhasDeCanais([linha('placa', 'foto_da_placa', 1), linha('outro', 'radio', 1)]);
    expect(r.at(-2)?.rotuloCompleto).toBe('outro');
    expect(r.at(-1)?.rotuloCompleto).toBe('outro · radio');
  });
});

describe('resumirCanais', () => {
  it('soma o período e separa quem ficou sem canal', () => {
    const r = resumirCanais([
      linha('placa', 'foto_da_placa', 4, { por_ia: 3, por_gente: 1, corrigidos: 1 }),
      linha('nao_identificado', 'desconhecido', 2),
    ]);
    expect(r.chegadas).toBe(6);
    expect(r.naoIdentificado).toBe(2);
    expect(r.por_ia).toBe(3);
    expect(r.corrigidos).toBe(1);
  });

  it('dá nome ao canal vazio', () => {
    expect(rotuloDoCanalNoRelatorio(null)).toBe('Ainda identificando');
    expect(rotuloDoCanalNoRelatorio('outros')).toBe('Outros');
  });
});
