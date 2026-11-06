import { describe, expect, it } from 'vitest';

import type { PlanilhaLida } from '@/components/importacao/tipos';

import {
  ativoNoCanalPro,
  lerRelatorioDoCanalPro,
  negocioDoCrm,
  negocioPelosPrecos,
  reconhecerColunas,
  tipoDoCrm,
} from './relatorio-canal-pro';

function planilha(cabecalho: string[], linhas: string[][]): PlanilhaLida {
  return {
    aba: 'Anúncios',
    abas: ['Anúncios'],
    cabecalho,
    linhas,
    cortadas: 0,
    tituloIgnorado: [],
  };
}

describe('lerRelatorioDoCanalPro', () => {
  it('reconhece as colunas pelo nome, com e sem acento, e guarda a linha inteira', () => {
    const r = lerRelatorioDoCanalPro(
      planilha(
        [
          'Código do Anúncio',
          'Título',
          'Tipo do Imóvel',
          'Tipo de Negócio',
          'Preço',
          'Bairro',
          'Cidade',
          'Área útil',
          'Quartos',
          'Status',
          'Visualizações',
        ],
        [
          [
            '2712345',
            'Casa em Capim Macio',
            'Casa de Condomínio',
            'Venda',
            'R$ 890.000,00',
            'Capim Macio',
            'Natal',
            '180',
            '4',
            'Ativo',
            '312',
          ],
        ],
      ),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.colunas.codigo).toBe('Código do Anúncio');
    expect(r.naoUsadas).toEqual(['Visualizações']);
    expect(r.anuncios[0]).toMatchObject({
      codigo: '2712345',
      titulo: 'Casa em Capim Macio',
      tipo_crm: 'casa_condominio',
      negocio: 'venda',
      preco_venda: 890000,
      preco_aluguel: null,
      area: 180,
      quartos: 4,
      situacao: 'Ativo',
    });
    expect(r.anuncios[0]!.linha['Visualizações']).toBe('312');
  });

  it('uma coluna só de preço vai para o aluguel quando o negócio é aluguel', () => {
    const r = lerRelatorioDoCanalPro(
      planilha(
        ['Código', 'Negócio', 'Valor'],
        [
          ['A1', 'Aluguel', '3.200'],
          ['A2', 'Venda', '450000'],
        ],
      ),
    );
    expect(r.ok && r.anuncios.map((a) => [a.preco_venda, a.preco_aluguel])).toEqual([
      [null, 3200],
      [450000, null],
    ]);
  });

  it('sem a coluna do código não importa nada, e diz quais colunas o arquivo tem', () => {
    const r = lerRelatorioDoCanalPro(planilha(['Título', 'Preço'], [['Casa', '100']]));
    expect(r).toEqual({
      ok: false,
      motivo: 'sem_coluna_de_codigo',
      cabecalho: ['Título', 'Preço'],
    });
  });

  it('pula linha sem código e código repetido', () => {
    const r = lerRelatorioDoCanalPro(
      planilha(
        ['Código', 'Título'],
        [
          ['A1', 'um'],
          ['', 'sem'],
          ['A1', 'repetido'],
        ],
      ),
    );
    expect(r.ok && r.anuncios.map((a) => a.titulo)).toEqual(['um']);
    expect(r.ok && r.semCodigo).toBe(1);
  });

  it('prefere o código do anúncio ao código do anunciante', () => {
    const colunas = reconhecerColunas(['Código do anunciante', 'Código do anúncio']);
    expect(colunas.codigo).toBe(1);
  });
});

describe('tipoDoCrm', () => {
  it.each([
    ['Apartamento', 'apartamento'],
    ['Casa', 'casa'],
    ['Casa de Condomínio', 'casa_condominio'],
    ['Lote/Terreno', 'terreno'],
    ['Terreno Comercial', 'terreno_comercial'],
    ['Sala/Conjunto', 'sala_comercial'],
    ['Ponto Comercial/Loja/Box', 'loja'],
    ['Galpão/Depósito/Armazém', 'galpao'],
    ['Kitnet', 'kitnet'],
    ['Cobertura', 'cobertura'],
    ['Residential / Land Lot', 'terreno'],
    ['Residential / Apartment', 'apartamento'],
    ['Imóvel comercial', 'imovel_comercial'],
    ['Disco voador', null],
    ['', null],
  ])('%s → %s', (texto, tipo) => {
    expect(tipoDoCrm(texto)).toBe(tipo);
  });
});

describe('negocioDoCrm', () => {
  it.each([
    ['Venda', 'venda'],
    ['Aluguel', 'aluguel'],
    ['Locação', 'aluguel'],
    ['Venda e Aluguel', 'venda_aluguel'],
    ['For Sale', 'venda'],
    ['', null],
  ])('%s → %s', (texto, negocio) => {
    expect(negocioDoCrm(texto)).toBe(negocio);
  });
});

// O cabeçalho do relatório de verdade do Canal Pro (05/11/2026); as linhas são
// inventadas, no formato das de lá.
const CABECALHO_REAL = [
  'ID Interno',
  'Código do Imóvel',
  'Tipo do imóvel',
  'Status do anúncio',
  'Motivo da Inativação',
  'Tipo do anúncio',
  'CEP',
  'Endereço',
  'Bairro',
  'Cidade',
  'Estado',
  'Quartos',
  'Suítes',
  'Banheiros',
  'Vagas',
  'Área útil',
  'Área total',
  'Valor de Venda',
  'Valor do aluguel',
  'Período do aluguel',
  'Condomínio/mês',
  'IPTU/ano',
  'Benefícios do imóvel',
  'Título do imóvel',
  'Tamanho do título',
  'Descrição',
  'Tamanho da descrição',
  'Número de fotos',
  'Vídeo',
  'Tour Virtual',
  'Total de visualizações',
  'Total de contatos',
  'Criação',
  'Última atualização',
  'Sem atualização há mais de 30 dias',
  'Vendido/Alugado',
];
function linhaReal(campos: Record<string, string>): string[] {
  return CABECALHO_REAL.map((c) => campos[c] ?? '');
}

describe('o relatório de verdade do Canal Pro', () => {
  const lido = lerRelatorioDoCanalPro(
    planilha(CABECALHO_REAL, [
      linhaReal({
        'ID Interno': '2900000001',
        'Código do Imóvel': 'SA9999_IMOVA',
        'Tipo do imóvel': 'Sala/Conjunto',
        'Status do anúncio': 'Ativo',
        'Tipo do anúncio': 'Padrão',
        'Valor do aluguel': '1600',
        'Período do aluguel': 'MONTHLY',
        'Título do imóvel': 'Sala comercial 19m² em Ponta Negra',
        'Área útil': '19',
        'Total de visualizações': '3',
        Criação: '04-11-2026',
      }),
      linhaReal({
        'ID Interno': '2900000002',
        'Código do Imóvel': 'Casa exemplo',
        'Tipo do imóvel': 'Casa',
        'Status do anúncio': 'Inativo',
        'Tipo do anúncio': 'Destaque',
        'Valor de Venda': '168000',
        Quartos: '2',
        'Título do imóvel': 'Casa à venda em Extremoz',
      }),
    ]),
  );

  it('usa o Código do Imóvel (o ListingID), e não o ID Interno do portal', () => {
    expect(lido.ok).toBe(true);
    if (!lido.ok) return;
    expect(lido.anuncios.map((a) => a.codigo)).toEqual(['SA9999_IMOVA', 'Casa exemplo']);
    expect(lido.colunas.codigo).toBe('Código do Imóvel');
  });

  it('reconhece título, tipo de anúncio e situação, e deduz o negócio pelos preços', () => {
    if (!lido.ok) return;
    const [sala, casa] = lido.anuncios;
    expect(sala).toMatchObject({
      titulo: 'Sala comercial 19m² em Ponta Negra',
      tipo_crm: 'sala_comercial',
      negocio: 'aluguel',
      preco_aluguel: 1600,
      destaque: 'Padrão',
      situacao: 'Ativo',
      area: 19,
    });
    expect(casa).toMatchObject({
      negocio: 'venda',
      preco_venda: 168000,
      destaque: 'Destaque',
      quartos: 2,
    });
  });

  it('guarda o resto da linha (visualizações, criação) para o banco ler', () => {
    if (!lido.ok) return;
    expect(lido.anuncios[0]!.linha['Total de visualizações']).toBe('3');
    expect(lido.anuncios[0]!.linha['Criação']).toBe('04-11-2026');
    expect(lido.naoUsadas).toContain('ID Interno');
  });
});

describe('negocioPelosPrecos', () => {
  it('venda, aluguel, os dois ou nenhum', () => {
    expect(negocioPelosPrecos(100, null)).toBe('venda');
    expect(negocioPelosPrecos(null, 100)).toBe('aluguel');
    expect(negocioPelosPrecos(100, 100)).toBe('venda_aluguel');
    expect(negocioPelosPrecos(0, null)).toBeNull();
    expect(negocioPelosPrecos(null, null)).toBeNull();
  });
});

describe('ativoNoCanalPro', () => {
  it('Ativo (e a linha sem situação) está no ar; Inativo e Bloqueado não', () => {
    expect(ativoNoCanalPro('Ativo')).toBe(true);
    expect(ativoNoCanalPro(' ativo ')).toBe(true);
    expect(ativoNoCanalPro('Publicado')).toBe(true);
    expect(ativoNoCanalPro(null)).toBe(true);
    expect(ativoNoCanalPro('Inativo')).toBe(false);
    expect(ativoNoCanalPro('Bloqueado')).toBe(false);
    expect(ativoNoCanalPro('Não publicado')).toBe(false);
  });
});
