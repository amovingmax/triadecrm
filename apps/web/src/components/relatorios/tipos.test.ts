import { describe, expect, it } from 'vitest';

import { linkDaConversa, linkDoLead } from './dados-imova';
import { paineisDaEmpresa, painelDaUrl, painelUsaPeriodo } from './tipos';

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

  it('a Imova tem só as cinco abas do relatório que vende, e abre na Visão geral', () => {
    expect(paineisDaEmpresa(true).map((p) => [p.chave, p.rotulo])).toEqual([
      ['visao', 'Visão geral'],
      ['imoveis', 'Imóveis'],
      ['oportunidades', 'Oportunidades'],
      ['funil_equipe', 'Funil e equipe'],
      ['progresso_ia', 'Progresso da IA'],
    ]);
  });

  it('o painel da URL só vale se existir na empresa', () => {
    const imova = paineisDaEmpresa(true);
    const komune = paineisDaEmpresa(false);
    expect(painelDaUrl(undefined, imova)).toBe('visao');
    expect(painelDaUrl('bairros', imova)).toBe('visao');
    // Os links antigos da Imova (06/11) e os da captação caem na Visão geral.
    expect(painelDaUrl('quentes', imova)).toBe('visao');
    expect(painelDaUrl('atendimento', imova)).toBe('visao');
    expect(painelDaUrl('oportunidades', imova)).toBe('oportunidades');
    expect(painelDaUrl(undefined, komune)).toBe('ligacoes');
    expect(painelDaUrl('imoveis', komune)).toBe('ligacoes');
    expect(painelDaUrl('funil', komune)).toBe('funil');
  });

  it('Oportunidades (agora) e Progresso da IA (desde o começo) não têm barra de período', () => {
    expect(painelUsaPeriodo('oportunidades')).toBe(false);
    expect(painelUsaPeriodo('progresso_ia')).toBe(false);
    expect(painelUsaPeriodo('visao')).toBe(true);
    expect(painelUsaPeriodo('imoveis')).toBe(true);
    expect(painelUsaPeriodo('funil_equipe')).toBe(true);
    // A KOMUNE fica como estava.
    expect(painelUsaPeriodo('semana')).toBe(false);
    expect(painelUsaPeriodo('ligacoes')).toBe(false);
    expect(painelUsaPeriodo('funil')).toBe(true);
  });
});

describe('o caminho até a conversa', () => {
  it('ficha pela ficha, cliente pela conversa', () => {
    expect(linkDaConversa('org-1', 'conv-1')).toBe('/conversas?org=org-1');
    expect(linkDaConversa(null, 'conv-1')).toBe('/conversas?cliente=conv-1');
    expect(linkDoLead({ conversation_id: 'conv-2' })).toBe('/conversas?cliente=conv-2');
    expect(linkDoLead({ conversation_id: 'conv-2', organization_id: 'org-2' })).toBe('/conversas?org=org-2');
  });
});
