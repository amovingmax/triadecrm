import { describe, expect, it } from 'vitest';

import {
  comodosDoCartao,
  type DadosDaNota,
  enderecoDoCartao,
  faixaDaNota,
  diaDeCriacao,
  estadoNoPortal,
  formatarDia,
  formatarNota,
  negociosDoCartao,
  nomeDoEstado,
  noPortalPeloSistemaAtual,
  qualidadeDoAnuncio,
  rotuloDaOrigem,
  seloDoAnuncio,
} from './regras-do-cartao';

/** Um apartamento com tudo no máximo. */
const COMPLETO: DadosDaNota = {
  tipo: 'apartamento',
  titulo: 'Apartamento de 3 quartos com varanda em Ponta Negra', // 51
  fotos: 20,
  descricao_tamanho: 900,
  caracteristicas_qtd: 10,
  video_youtube: 'https://www.youtube.com/watch?v=MukVADdjQD8',
  cep: '59090-000',
  numero: '100',
  condominio: 650,
  iptu: 1200,
  area_util: 90,
  area_total: 110,
  quartos: 3,
  suites: 1,
  banheiros: 2,
  vagas: 2,
};

/** Um anúncio recém-criado, sem nada. */
const VAZIO: DadosDaNota = {
  tipo: 'apartamento',
  titulo: '',
  fotos: 0,
  descricao_tamanho: 0,
  caracteristicas_qtd: 0,
  video_youtube: null,
  cep: null,
  numero: null,
  condominio: null,
  iptu: null,
  area_util: null,
  area_total: null,
  quartos: null,
  suites: null,
  banheiros: null,
  vagas: null,
};

function item(d: DadosDaNota, id: string) {
  return qualidadeDoAnuncio(d).itens.find((i) => i.id === id)!;
}

describe('qualidadeDoAnuncio', () => {
  it('dá 10 ao anúncio completo e 0 ao vazio', () => {
    expect(qualidadeDoAnuncio(COMPLETO).nota).toBe(10);
    expect(qualidadeDoAnuncio(VAZIO).nota).toBe(0);
  });

  it('os pesos somam 10, e a nota é a soma dos itens arredondados', () => {
    const { nota, itens } = qualidadeDoAnuncio({ ...VAZIO, fotos: 7, descricao_tamanho: 451 });
    expect(itens.reduce((s, i) => s + i.maximo, 0)).toBe(10);
    // 7/15 × 3 = 1,4; 451/600 × 2 = 1,503… → 1,5
    expect(item({ ...VAZIO, fotos: 7 }, 'fotos').pontos).toBe(1.4);
    expect(item({ ...VAZIO, descricao_tamanho: 451 }, 'descricao').pontos).toBe(1.5);
    expect(nota).toBe(2.9);
  });

  it('fotos, descrição e características param de contar no teto', () => {
    expect(item({ ...VAZIO, fotos: 15 }, 'fotos').pontos).toBe(3);
    expect(item({ ...VAZIO, fotos: 40 }, 'fotos').pontos).toBe(3);
    expect(item({ ...VAZIO, fotos: 1 }, 'fotos').dica).toBe('1 foto. Com 15 a nota é máxima.');
    expect(item({ ...VAZIO, descricao_tamanho: 3000 }, 'descricao').pontos).toBe(2);
    expect(item({ ...VAZIO, descricao_tamanho: 1100 }, 'descricao').dica).toBe(
      'Descrição completa.',
    );
    expect(item({ ...VAZIO, caracteristicas_qtd: 4 }, 'caracteristicas').pontos).toBe(0.8);
    expect(item({ ...VAZIO, caracteristicas_qtd: 8 }, 'caracteristicas').pontos).toBe(1.5);
  });

  it('o vídeo só conta com link do YouTube', () => {
    expect(item({ ...VAZIO, video_youtube: 'https://youtu.be/MukVADdjQD8' }, 'video').pontos).toBe(
      0.5,
    );
    expect(
      item({ ...VAZIO, video_youtube: 'https://www.youtube.com/shorts/abc123' }, 'video').pontos,
    ).toBe(0.5);
    expect(item({ ...VAZIO, video_youtube: 'https://vimeo.com/123456' }, 'video').pontos).toBe(0);
    expect(item({ ...VAZIO, video_youtube: '' }, 'video').pontos).toBe(0);
  });

  it('CEP e número valem meio ponto cada', () => {
    expect(item({ ...VAZIO, cep: '59092300', numero: '2206' }, 'endereco').pontos).toBe(1);
    expect(item({ ...VAZIO, cep: '59092300' }, 'endereco')).toMatchObject({
      pontos: 0.5,
      dica: 'Falta o número. Ele não aparece no portal se você não quiser.',
    });
    expect(item({ ...VAZIO, cep: '5909', numero: '1' }, 'endereco')).toMatchObject({
      pontos: 0.5,
      dica: 'Falta o CEP.',
    });
    expect(item({ ...VAZIO, numero: '   ' }, 'endereco').pontos).toBe(0);
  });

  it('o título vale 1 ponto entre 30 e 80 caracteres', () => {
    expect(item({ ...VAZIO, titulo: 'x'.repeat(29) }, 'titulo').pontos).toBe(0);
    expect(item({ ...VAZIO, titulo: 'x'.repeat(30) }, 'titulo').pontos).toBe(1);
    expect(item({ ...VAZIO, titulo: ` ${'x'.repeat(80)} ` }, 'titulo').pontos).toBe(1);
    expect(item({ ...VAZIO, titulo: 'x'.repeat(81) }, 'titulo')).toMatchObject({
      pontos: 0,
      dica: '81 caracteres. O ideal é de 30 a 80.',
    });
  });

  it('condomínio só é pedido nos tipos que costumam ter', () => {
    // Apartamento: os dois.
    expect(item({ ...VAZIO, iptu: 1200 }, 'valores')).toMatchObject({
      pontos: 0,
      rotulo: 'Condomínio e IPTU',
      dica: 'Informe o condomínio.',
    });
    expect(item({ ...VAZIO, condominio: 0, iptu: 0 }, 'valores').pontos).toBe(0.5);
    // Casa: só o IPTU.
    expect(item({ ...VAZIO, tipo: 'casa', iptu: 900 }, 'valores')).toMatchObject({
      pontos: 0.5,
      rotulo: 'IPTU',
    });
    expect(item({ ...VAZIO, tipo: 'sala_comercial' }, 'valores').dica).toBe(
      'Informe o condomínio e o IPTU.',
    );
  });

  it('áreas e cômodos: terreno pede só a área total; o resto, tudo o que o tipo usa', () => {
    expect(item({ ...VAZIO, tipo: 'terreno', area_total: 3500 }, 'areas')).toMatchObject({
      pontos: 0.5,
      rotulo: 'Área',
    });
    expect(item({ ...VAZIO, tipo: 'terreno' }, 'areas').dica).toBe('Falta: área total.');
    // Sala comercial não tem quarto: não pede quartos nem suítes.
    expect(
      item(
        { ...VAZIO, tipo: 'sala_comercial', area_util: 19, area_total: 19, banheiros: 1, vagas: 0 },
        'areas',
      ).pontos,
    ).toBe(0.5);
    expect(
      item({ ...VAZIO, area_util: 90, area_total: 110, quartos: 3, banheiros: 2 }, 'areas').dica,
    ).toBe('Falta: suítes e vagas.');
    expect(item(VAZIO, 'areas').dica).toBe(
      'Falta: área útil, área total, quartos, suítes, banheiros e vagas.',
    );
  });

  it('o terreno trazido do sistema atual (TE0002) fica com 5,9', () => {
    const { nota } = qualidadeDoAnuncio({
      tipo: 'terreno',
      titulo: 'x'.repeat(96),
      fotos: 12,
      descricao_tamanho: 1085,
      caracteristicas_qtd: 0,
      video_youtube: null,
      cep: '59141670',
      numero: '75',
      condominio: null,
      iptu: null,
      area_util: 3500,
      area_total: 3500,
      quartos: 0,
      suites: 0,
      banheiros: 0,
      vagas: 0,
    });
    // fotos 2,4 + descrição 2 + CEP e número 1 + área 0,5
    expect(nota).toBe(5.9);
  });
});

describe('faixa e formato da nota', () => {
  it('boa a partir de 8, média a partir de 5', () => {
    expect(faixaDaNota(10)).toBe('boa');
    expect(faixaDaNota(8)).toBe('boa');
    expect(faixaDaNota(7.9)).toBe('media');
    expect(faixaDaNota(5)).toBe('media');
    expect(faixaDaNota(4.9)).toBe('baixa');
    expect(faixaDaNota(0)).toBe('baixa');
  });

  it('com uma casa e vírgula', () => {
    expect(formatarNota(7.8)).toBe('7,8');
    expect(formatarNota(10)).toBe('10,0');
    expect(formatarNota(0)).toBe('0,0');
  });
});

describe('enderecoDoCartao', () => {
  const base = {
    endereco: 'Avenida Engenheiro Roberto Freire',
    numero: '4715',
    mostrar_endereco: 'rua' as const,
    bairro: 'Ponta Negra',
    cidade: 'Natal',
    estado: 'RN',
  };

  it('escreve como o Canal Pro, com o nome do estado', () => {
    expect(enderecoDoCartao(base)).toBe(
      'Avenida Engenheiro Roberto Freire - Ponta Negra, Natal - Rio Grande do Norte',
    );
  });

  it('o número só entra com o endereço completo à mostra, e não se repete', () => {
    expect(enderecoDoCartao({ ...base, mostrar_endereco: 'completo' })).toBe(
      'Avenida Engenheiro Roberto Freire, 4715 - Ponta Negra, Natal - Rio Grande do Norte',
    );
    expect(enderecoDoCartao({ ...base, mostrar_endereco: 'bairro' })).toBe(
      'Avenida Engenheiro Roberto Freire - Ponta Negra, Natal - Rio Grande do Norte',
    );
    expect(
      enderecoDoCartao({
        ...base,
        endereco: 'Av Barra de Tabatinga, 2004',
        numero: '2004',
        mostrar_endereco: 'completo',
      }),
    ).toBe('Av Barra de Tabatinga, 2004 - Ponta Negra, Natal - Rio Grande do Norte');
  });

  it('sem rua, fica o bairro e a cidade; sem nada, null', () => {
    expect(enderecoDoCartao({ ...base, endereco: null })).toBe(
      'Ponta Negra, Natal - Rio Grande do Norte',
    );
    expect(enderecoDoCartao({ ...base, endereco: '  ', bairro: null, estado: null })).toBe('Natal');
    expect(
      enderecoDoCartao({
        endereco: null,
        numero: null,
        mostrar_endereco: 'rua',
        bairro: null,
        cidade: null,
        estado: null,
      }),
    ).toBeNull();
  });

  it('estado fora da lista fica como veio', () => {
    expect(nomeDoEstado('rn')).toBe('Rio Grande do Norte');
    expect(nomeDoEstado('XX')).toBe('XX');
    expect(nomeDoEstado(null)).toBe('');
  });
});

describe('chips', () => {
  it('venda, aluguel ou os dois', () => {
    expect(negociosDoCartao('venda')).toEqual(['Venda']);
    expect(negociosDoCartao('aluguel')).toEqual(['Aluguel']);
    expect(negociosDoCartao('venda_aluguel')).toEqual(['Venda', 'Aluguel']);
  });

  it('a origem', () => {
    const a = { codigo: 'SA0012_IMOVA', codigo_no_canal_pro: null };
    expect(rotuloDaOrigem({ ...a, origem: 'sistema_atual' })).toBe('Via sistema atual');
    expect(rotuloDaOrigem({ ...a, origem: 'crm' })).toBe('Criado no CRM');
    expect(rotuloDaOrigem({ ...a, origem: 'relatorio_canal_pro' })).toBe('Do Canal Pro');
    expect(
      rotuloDaOrigem({ ...a, origem: 'relatorio_canal_pro', codigo_no_canal_pro: 'SA0012_IMOVA' }),
    ).toBe('Do Canal Pro');
    expect(
      rotuloDaOrigem({
        codigo: 'IMV-0037',
        origem: 'relatorio_canal_pro',
        codigo_no_canal_pro: 'CC9',
      }),
    ).toBe('Do Canal Pro (CC9)');
  });
});

describe('comodosDoCartao', () => {
  const textos = (a: Parameters<typeof comodosDoCartao>[0]) =>
    comodosDoCartao(a).map((c) => `${c.id}:${c.texto}`);

  it('sala comercial: área, banheiros e vagas; quarto só se tiver', () => {
    expect(
      textos({
        tipo: 'sala_comercial',
        area_util: 19,
        area_total: 19,
        quartos: 0,
        banheiros: 1,
        vagas: null,
      }),
    ).toEqual(['area:19 m²', 'banheiros:1', 'vagas:0']);
  });

  it('terreno: só a área total, com ponto de milhar', () => {
    expect(
      textos({
        tipo: 'terreno',
        area_util: 3500,
        area_total: 3500,
        quartos: 0,
        banheiros: 0,
        vagas: 0,
      }),
    ).toEqual(['area:3.500 m²']);
  });

  it('casa: tudo, com 0 no que está vazio', () => {
    const c = comodosDoCartao({
      tipo: 'casa',
      area_util: 550,
      area_total: 550,
      quartos: 2,
      banheiros: null,
      vagas: 2,
    });
    expect(c.map((x) => x.texto)).toEqual(['550 m²', '2', '0', '2']);
    expect(c.map((x) => x.descricao)).toEqual([
      '550 m² de área útil',
      '2 quartos',
      '0 banheiros',
      '2 vagas',
    ]);
  });

  it('sem área, a área não aparece; a do outro tipo serve de reserva', () => {
    expect(
      textos({
        tipo: 'apartamento',
        area_util: null,
        area_total: null,
        quartos: 1,
        banheiros: 1,
        vagas: 1,
      })[0],
    ).toBe('quartos:1');
    expect(
      comodosDoCartao({
        tipo: 'apartamento',
        area_util: null,
        area_total: 120,
        quartos: null,
        banheiros: null,
        vagas: null,
      })[0]!.descricao,
    ).toBe('120 m² de área total');
  });
});

describe('seloDoAnuncio', () => {
  const leitura = '2026-11-05T12:00:00Z';
  const base = {
    situacao: 'no_ar' as const,
    publicado_em: '2026-11-05T10:00:00Z',
    ultima_leitura_do_portal: leitura,
    excluido_em: null,
    no_canal_pro_situacao: null as string | null,
    no_canal_pro_visto_em: null as string | null,
    no_sistema_atual: null as boolean | null,
    sistema_atual_em: null as string | null,
  };

  it('no ar e lido pelo Grupo OLX: Publicado', () => {
    expect(seloDoAnuncio(base)).toEqual({ rotulo: 'Publicado', tom: 'publicado' });
  });

  it('no ar depois da última leitura, ou sem leitura: Em processamento', () => {
    expect(seloDoAnuncio({ ...base, publicado_em: '2026-11-05T13:00:00Z' }).rotulo).toBe(
      'Em processamento',
    );
    expect(seloDoAnuncio({ ...base, ultima_leitura_do_portal: null }).rotulo).toBe(
      'Em processamento',
    );
  });

  it('rascunho, fora do ar e excluído', () => {
    expect(seloDoAnuncio({ ...base, situacao: 'rascunho' }).rotulo).toBe('Rascunho');
    expect(seloDoAnuncio({ ...base, situacao: 'pausado' }).rotulo).toBe('Não publicado');
    expect(seloDoAnuncio({ ...base, excluido_em: leitura }).rotulo).toBe('Excluído');
  });

  it('fora do CRM, vale o relatório do Canal Pro: Ativo é Publicado, Inativo é Inativo', () => {
    const rascunho = { ...base, situacao: 'rascunho' as const };
    expect(seloDoAnuncio({ ...rascunho, no_canal_pro_situacao: 'Ativo' }).rotulo).toBe('Publicado');
    expect(seloDoAnuncio({ ...rascunho, no_canal_pro_situacao: 'Inativo' }).rotulo).toBe('Inativo');
    // No ar pelo CRM, o CRM manda.
    expect(seloDoAnuncio({ ...base, no_canal_pro_situacao: 'Inativo' }).rotulo).toBe('Publicado');
  });

  it('sem relatório, o que está no arquivo do sistema atual é Publicado; o que saiu, Inativo', () => {
    const rascunho = { ...base, situacao: 'rascunho' as const, sistema_atual_em: leitura };
    expect(seloDoAnuncio({ ...rascunho, no_sistema_atual: true }).rotulo).toBe('Publicado');
    expect(seloDoAnuncio({ ...rascunho, no_sistema_atual: false }).rotulo).toBe('Inativo');
  });

  it('o rascunho que está no arquivo do sistema atual continua no portal por ele', () => {
    const a = {
      no_sistema_atual: true as boolean | null,
      situacao: 'rascunho' as const,
      excluido_em: null,
    };
    expect(noPortalPeloSistemaAtual(a)).toBe(true);
    expect(noPortalPeloSistemaAtual({ ...a, situacao: 'no_ar' })).toBe(false);
    expect(noPortalPeloSistemaAtual({ ...a, no_sistema_atual: false })).toBe(false);
    expect(noPortalPeloSistemaAtual({ ...a, no_sistema_atual: null })).toBe(false);
    expect(noPortalPeloSistemaAtual({ ...a, excluido_em: leitura })).toBe(false);
  });
});

describe('formatarDia', () => {
  it('no fuso de Fortaleza', () => {
    // 02h00 em UTC ainda é o dia anterior em Fortaleza (UTC-3).
    expect(formatarDia('2026-11-05T02:00:00Z')).toBe('04/11/2026');
    expect(formatarDia('2026-11-05T12:00:00Z')).toBe('05/11/2026');
  });
});

describe('diaDeCriacao', () => {
  it('usa a data do Canal Pro sem passar por fuso, e cai na do CRM sem relatório', () => {
    expect(
      diaDeCriacao({ criado_em: '2026-11-05T12:00:00Z', no_canal_pro_criado_em: '2026-09-16' }),
    ).toEqual({
      dia: '16/09/2026',
      doCanalPro: true,
    });
    expect(
      diaDeCriacao({ criado_em: '2026-11-05T12:00:00Z', no_canal_pro_criado_em: null }),
    ).toEqual({
      dia: '05/11/2026',
      doCanalPro: false,
    });
  });
});

describe('estadoNoPortal', () => {
  const nada = {
    no_canal_pro_situacao: null as string | null,
    no_canal_pro_visto_em: null as string | null,
    no_sistema_atual: null as boolean | null,
    sistema_atual_em: null as string | null,
  };
  const relatorio = '2026-11-05T17:38:00Z';
  const antes = '2026-11-05T14:00:00Z';
  const depois = '2026-11-06T10:00:00Z';

  it('no ar pelo CRM é publicado; senão vale o relatório; sem nada, a situação do CRM', () => {
    expect(estadoNoPortal({ ...nada, situacao: 'no_ar', no_canal_pro_situacao: 'Inativo' })).toBe(
      'publicado',
    );
    expect(estadoNoPortal({ ...nada, situacao: 'rascunho', no_canal_pro_situacao: 'Ativo' })).toBe(
      'publicado',
    );
    expect(
      estadoNoPortal({ ...nada, situacao: 'rascunho', no_canal_pro_situacao: 'Inativo' }),
    ).toBe('nao_publicado');
    expect(estadoNoPortal({ ...nada, situacao: 'pausado' })).toBe('nao_publicado');
    expect(estadoNoPortal({ ...nada, situacao: 'rascunho' })).toBe('rascunho');
  });

  it('o novo do sistema atual, que o relatório ainda não tem, já é publicado', () => {
    expect(
      estadoNoPortal({
        ...nada,
        situacao: 'rascunho',
        no_sistema_atual: true,
        sistema_atual_em: depois,
      }),
    ).toBe('publicado');
  });

  it('o que saiu do sistema atual depois do relatório é não publicado, mesmo Ativo nele', () => {
    const comRelatorio = {
      ...nada,
      situacao: 'rascunho' as const,
      no_canal_pro_situacao: 'Ativo',
      no_canal_pro_visto_em: relatorio,
      no_sistema_atual: false,
    };
    expect(estadoNoPortal({ ...comRelatorio, sistema_atual_em: depois })).toBe('nao_publicado');
    // Saiu antes do relatório e o relatório (mais novo) ainda diz Ativo: vale o relatório.
    expect(estadoNoPortal({ ...comRelatorio, sistema_atual_em: antes })).toBe('publicado');
  });

  it('o relatório manda sobre estar no arquivo: Inativo lá é não publicado', () => {
    expect(
      estadoNoPortal({
        ...nada,
        situacao: 'rascunho',
        no_canal_pro_situacao: 'Inativo',
        no_canal_pro_visto_em: relatorio,
        no_sistema_atual: true,
        sistema_atual_em: depois,
      }),
    ).toBe('nao_publicado');
  });
});
