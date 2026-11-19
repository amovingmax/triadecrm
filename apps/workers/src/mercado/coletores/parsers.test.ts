import { deflateRawSync, deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { anuncioDeSite, ehRecusa, urlCanonica } from '../anuncio';
import { indicesSemRepetir, LoteDeAnuncios } from '../lote';
import { textoDoPdf } from '../pdf';
import { Regioes, type RegiaoDoBanco } from '../regioes';
import { limparTitulo, sinaisDe, tipoDe } from '../texto';
import type { Gravador, ItemAnuncio, LinhaIndice } from '../tipos';
import { lerDoZip } from '../zip';
import { buscaCompleta, lerJsonRpc, montarPlano, normalizar, paraBruto } from './chavesnamao';
import { lerVrsync } from './feeds';
import { atosDoTexto, linhasDoAto, linhasDoObrasgov, tirarDadoPessoal } from './obras';
import {
  contarAlvaras,
  linhasDaCorrida,
  linhasDoFipezap,
  linhasDoIvgr,
  linhasDoOlinda,
  lerPlanilhaFipezap,
  mesesDoRreo,
  somarPorSerie,
} from './oficiais';
import { areasDeConsulta, categoriaDe, medir, type ElementoDoMapa } from './proximidades';
import {
  itemDaLopes,
  itensDaCatalogue,
  lerImovelCatalogue,
  lerImovelImobibrasil,
  lerLinkImobibrasil,
  lerPaginaAbreu,
  lerPaginaIbeda,
  lerPaginaImobinova,
  lerPaginaLopes,
  listasDoMenuAbreu,
} from './sites';

/** As regiões como o banco tem (as que os testes usam). */
const REGIOES: RegiaoDoBanco[] = [
  {
    id: 'natal-cidade-jardim',
    cidade: 'Natal',
    chaves: ['cidade jardim'],
    abrangencia: 'area',
    ativa: true,
  },
  {
    id: 'natal-capim-macio',
    cidade: 'Natal',
    chaves: ['capim macio'],
    abrangencia: 'bairro',
    ativa: true,
  },
  {
    id: 'natal-ponta-negra',
    cidade: 'Natal',
    chaves: ['ponta negra'],
    abrangencia: 'bairro',
    ativa: true,
  },
  {
    id: 'natal-lagoa-nova',
    cidade: 'Natal',
    chaves: ['lagoa nova'],
    abrangencia: 'bairro',
    ativa: true,
  },
  {
    id: 'natal-satelite',
    cidade: 'Natal',
    chaves: ['satelite', 'pitimbu'],
    abrangencia: 'area',
    ativa: true,
  },
  {
    id: 'natal-neopolis',
    cidade: 'Natal',
    chaves: ['neopolis'],
    abrangencia: 'bairro',
    ativa: true,
  },
  {
    id: 'parnamirim-bonor',
    cidade: 'Parnamirim',
    chaves: ['bonor', 'santos reis parnamirim', 'rosa dos ventos', 'vale do sol'],
    abrangencia: 'bairro',
    ativa: true,
  },
  {
    id: 'parnamirim-pirangi',
    cidade: 'Parnamirim',
    chaves: ['pirangi'],
    abrangencia: 'distrito',
    ativa: true,
  },
  {
    id: 'tibau-do-sul-pipa',
    cidade: 'Tibau do Sul',
    chaves: ['pipa'],
    abrangencia: 'area',
    ativa: true,
  },
  {
    id: 'extremoz',
    cidade: 'Extremoz',
    chaves: ['extremoz'],
    abrangencia: 'municipio',
    ativa: true,
  },
];
const regioes = new Regioes(REGIOES);
const ctx = { regioes, dia: '2026-11-19' };
const item = (x: ReturnType<typeof anuncioDeSite>): ItemAnuncio => {
  if (ehRecusa(x)) throw new Error(`recusado: ${x.recusa}`);
  return x;
};

describe('regiões (a mesma conta do banco, mais o título)', () => {
  it('acha a região pelo bairro e pela cidade', () => {
    expect(regioes.regiaoDe({ cidade: 'Natal', bairro: 'Capim Macio' })?.regiao).toBe(
      'natal-capim-macio',
    );
    expect(regioes.regiaoDe({ cidade: 'Parnamirim', bairro: 'Rosa dos Ventos' })?.regiao).toBe(
      'parnamirim-bonor',
    );
    expect(
      regioes.regiaoDe({ cidade: 'Parnamirim', bairro: 'Pirangi do Norte (Distrito Litoral)' })
        ?.regiao,
    ).toBe('parnamirim-pirangi');
    expect(regioes.regiaoDe({ cidade: 'Extremoz', bairro: 'Genipabu' })?.regiao).toBe('extremoz');
    expect(regioes.regiaoDe({ cidade: 'Natal', bairro: 'Alecrim' })).toBeNull();
    // Mesma palavra, outra cidade: não casa.
    expect(regioes.regiaoDe({ cidade: 'Parnamirim', bairro: 'Ponta Negra' })).toBeNull();
  });

  it('Cidade Jardim e Satélite saem do título (o portal cadastra Capim Macio e Pitimbu)', () => {
    expect(
      regioes.regiaoDe({
        cidade: 'Natal',
        bairro: 'Capim Macio',
        texto: 'Terreno no Cidade Jardim',
      }),
    ).toEqual({ regiao: 'natal-cidade-jardim', porTitulo: true });
    expect(
      regioes.regiaoDe({ cidade: 'Natal', bairro: 'Pitimbu', texto: 'Casa no Satélite' }),
    ).toEqual({ regiao: 'natal-satelite', porTitulo: true });
  });

  it('a cidade sai do bairro só quando é uma cidade só (#6 da verificação)', () => {
    expect(regioes.cidadePeloBairro('Ponta Negra')).toBe('Natal');
    expect(regioes.cidadePeloBairro('Praia da Pipa')).toBe('Tibau do Sul');
    expect(regioes.cidadePeloBairro('Centro')).toBeNull();
  });
});

describe('texto do anúncio', () => {
  it('tipo do sistema a partir do tipo da fonte', () => {
    expect(tipoDe('Terreno em condomínio')).toBe('terreno');
    expect(tipoDe('Casa / Sobrado')).toBe('casa');
    expect(tipoDe('Casa em condomínio')).toBe('casa_condominio');
    expect(tipoDe('Apartamento Cobertura')).toBe('apartamento');
    expect(tipoDe('Galpão / Depósito')).toBe('galpao');
    expect(tipoDe('Chácara')).toBe('rural');
  });

  it('título sem telefone, e-mail, CRECI nem nome de corretor', () => {
    const t = limparTitulo(
      'Casa 3 quartos (84) 99999-8888 corretor@exemplo.com CRECI 1234-J fale com Maria Silva R$ 450.000',
    );
    expect(t).not.toMatch(/9999|@|CRECI|Maria/);
    expect(t).toContain('R$ 450.000');
  });

  it('sinais só quando o texto diz; "Loteamento" é lote em condomínio (#5)', () => {
    expect(sinaisDe('Terreno de esquina, frente para o mar', 'terreno')).toEqual({
      esquina: true,
      frente_mar: true,
    });
    expect(sinaisDe('Lote 300 m²', 'Loteamento')).toEqual({ condominio_fechado: true });
    expect(sinaisDe('Casa simples', 'casa')).toEqual({});
  });
});

describe('o item que vai ao banco', () => {
  it('terreno: a área única é a do lote; ponto do site fica "aproximada"', () => {
    const a = item(
      anuncioDeSite(
        {
          id_externo: '1',
          modo: 'venda',
          tipoTexto: 'Terreno',
          titulo: 'Terreno 450 m²',
          preco: 300000,
          area_unica: 450,
          bairro: 'Capim Macio',
          cidade: 'Natal',
          lat: -5.85,
          lng: -35.2,
          url: 'https://www.site.com.br/imovel/1?utm=x#foto',
        },
        regioes,
      ),
    );
    expect(a).toMatchObject({
      tipo: 'terreno',
      area_total: 450,
      area_util: null,
      regiao_id: 'natal-capim-macio',
      loc_precisao: 'aproximada',
      url: 'https://www.site.com.br/imovel/1',
    });
  });

  it('casa: a área construída vem antes da "útil" (#7)', () => {
    const a = item(
      anuncioDeSite(
        {
          id_externo: '2',
          modo: 'venda',
          tipoTexto: 'Casa',
          titulo: 'Casa',
          preco: 900000,
          area_construida: 212.89,
          area_util: 450.9,
          area_total: 600,
          bairro: 'Praia da Pipa',
          cidade: 'Tibau do Sul',
          url: 'https://www.zilmonteiro.com.br/imovel/2/x',
        },
        regioes,
      ),
    );
    expect(a.area_util).toBe(212.89);
  });

  it('fica fora: repasse, rural, fora do estudo, sem link, link proibido', () => {
    const base = {
      id_externo: '3',
      modo: 'venda' as const,
      preco: 100000,
      bairro: 'Capim Macio',
      cidade: 'Natal',
      url: 'https://www.site.com.br/3',
    };
    expect(
      anuncioDeSite(
        { ...base, tipoTexto: 'Apartamento', titulo: 'Repasse de apartamento' },
        regioes,
      ),
    ).toEqual({ recusa: 'repasse, ágio, cota ou fração' });
    expect(anuncioDeSite({ ...base, tipoTexto: 'Chácara' }, regioes)).toMatchObject({
      recusa: expect.stringContaining('tipo fora'),
    });
    expect(anuncioDeSite({ ...base, tipoTexto: 'Casa', bairro: 'Alecrim' }, regioes)).toEqual({
      recusa: 'fora das regiões do estudo',
    });
    expect(anuncioDeSite({ ...base, tipoTexto: 'Casa', url: null }, regioes)).toEqual({
      recusa: 'sem link',
    });
    expect(
      anuncioDeSite({ ...base, tipoTexto: 'Casa', url: 'https://www.olx.com.br/x' }, regioes),
    ).toEqual({ recusa: 'link de domínio proibido' });
  });

  it('link canônico igual ao do banco', () => {
    expect(urlCanonica('HTTPS://WWW.Site.com.br/imovel/1/?x=1#y')).toBe(
      'https://www.site.com.br/imovel/1',
    );
  });
});

describe('Chaves na Mão (MCP oficial)', () => {
  it('o plano começa pelo que a Imova tem e não repete busca', () => {
    const plano = montarPlano();
    expect(plano[0]?.prio).toBe(1);
    expect(plano.length).toBeGreaterThan(100);
    expect(new Set(plano.map((t) => t.rotulo)).size).toBe(plano.length);
    expect(plano.every((t) => t.filtros.state === 'RN')).toBe(true);
  });

  it('só as buscas da prioridade 1 se dividem por faixa de preço quando passam de 300', () => {
    const plano = montarPlano();
    expect(plano.filter((t) => t.prio === 1).every((t) => t.dividir)).toBe(true);
    expect(plano.filter((t) => t.prio > 1).some((t) => t.dividir)).toBe(false);
  });

  it('busca completa só com o total dito pelo portal, a última página lida e algum anúncio', () => {
    expect(buscaCompleta({ totalResults: 12, totalPages: 1 }, 1, 12)).toBe(true);
    expect(buscaCompleta({ totalResults: 40, totalPages: 3 }, 3, 40)).toBe(true);
    // Sem a paginação na resposta (o caso do defeito): dava "completa" na página 1.
    expect(buscaCompleta({}, 1, 15)).toBe(false);
    expect(buscaCompleta({ totalPages: 1 }, 1, 15)).toBe(false);
    expect(buscaCompleta({ totalResults: 15 }, 1, 15)).toBe(false);
    expect(buscaCompleta({ totalResults: 40, totalPages: 3 }, 2, 30)).toBe(false);
    expect(buscaCompleta({ totalResults: 0, totalPages: 0 }, 1, 0)).toBe(false);
    expect(buscaCompleta({ totalResults: 450, totalPages: 30 }, 30, 300)).toBe(false);
  });

  it('normaliza um resultado: rua do nome da foto, título limpo, região', () => {
    const r = {
      id: 48892102,
      title: 'Terreno 450 m² no Cidade Jardim (84) 98888-7777',
      url: 'https://www.chavesnamao.com.br/imovel/terreno-a-venda-rn-natal-capim-macio/id-48892102/',
      propertyType: 'Terreno',
      transaction: 'Venda',
      priceBRL: 400000,
      areaM2: 450,
      imageUrl:
        'https://img.chavesnamao.com.br/x/rn-natal-capim-macio-rua-das-acacias-terreno-a-venda.jpg',
      location: { state: 'RN', city: 'Natal', neighborhood: 'Capim Macio' },
      cta: 'Fale agora',
    };
    const a = item(normalizar(r, 'terreno-venda-em-capim-macio', 'f'.repeat(64), ctx));
    expect(a).toMatchObject({
      id_externo: '48892102',
      tipo: 'terreno',
      area_total: 450,
      regiao_id: 'natal-cidade-jardim',
      logradouro: 'Rua das Acacias',
      consulta_id: 'terreno-venda-em-capim-macio',
    });
    expect(a.titulo).not.toMatch(/9888/);
    expect(a.marcas).toContain('regiao_pelo_titulo');
    expect(paraBruto(r)).not.toHaveProperty('cta');
    expect(
      normalizar({ ...r, location: { state: 'PB', city: 'João Pessoa' } }, 'x', null, ctx),
    ).toEqual({ recusa: 'fora do RN' });
  });

  it('lê a resposta JSON-RPC em JSON puro e em evento SSE', () => {
    expect(
      lerJsonRpc('{"jsonrpc":"2.0","id":1,"result":{"a":1}}', 'application/json').result,
    ).toEqual({ a: 1 });
    expect(
      lerJsonRpc(
        'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"b":2}}\n\n',
        'text/event-stream',
      ).result,
    ).toEqual({ b: 2 });
  });
});

describe('sites de imobiliárias', () => {
  it('Lopes: bloco ng-state; casa vai com a área marcada como ambígua', () => {
    const estado = {
      'search/geo?x': {
        products: {
          totalPages: 1,
          totalElements: 2,
          content: [
            {
              id: 'REO1',
              type: 'Casa',
              divisionUnitType: 'Casa',
              sellingPriceFormat: 'R$ 650.000',
              attributes: [
                { type: 'area_attr', value: '300 m²' },
                { type: 'bedroom_attr', value: '3' },
              ],
              locationDTO: { city: 'Natal', neighborhood: 'Ponta Negra' },
              dealType: 'sale',
            },
            {
              id: 'REO2',
              type: 'Apartamento',
              sellingPriceFormat: 'R$ 400.000',
              attributes: [{ type: 'area_attr', value: '80' }],
              locationDTO: { city: 'Natal', neighborhood: 'Lagoa Nova' },
            },
          ],
        },
      },
    };
    const html = `<a href="/imovel/REO1/casa-ponta-negra">x</a><script id="ng-state" type="application/json">${JSON.stringify(estado)}</script>`;
    const p = lerPaginaLopes(html);
    expect(p.total).toBe(2);
    const casa = item(
      anuncioDeSite(
        {
          ...itemDaLopes(p.itens[0] ?? {}, p.links, 'https://www.lopes.com.br'),
          data_dado: '2026-11-19',
        },
        regioes,
      ),
    );
    expect(casa).toMatchObject({
      area_total: 300,
      area_util: null,
      marcas: ['area_ambigua'],
      url: 'https://www.lopes.com.br/imovel/REO1/casa-ponta-negra',
    });
    const ap = item(
      anuncioDeSite(itemDaLopes(p.itens[1] ?? {}, p.links, 'https://www.lopes.com.br'), regioes),
    );
    expect(ap).toMatchObject({
      area_util: 80,
      preco: 400000,
      url: 'https://www.lopes.com.br/imovel/REO2',
    });
  });

  it('Catalogue: __NEXT_DATA__ com venda e aluguel viram dois itens', () => {
    const p = {
      idtProperty: 5120,
      indType: 'A',
      indStatus: 1,
      valSales: 800000,
      valLocation: 4000,
      namCategory: 'Apartamento',
      namDistrict: 'Ponta Negra',
      namCity: 'Natal',
      prop_char_1: 90,
      prop_char_5: 3,
      dtaUpdate: '2026-11-10T10:00:00',
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { initialProps: { pageProps: { template: { data: { property: p } } } } } })}</script>`;
    const lido = lerImovelCatalogue(html);
    const itens = itensDaCatalogue(
      lido,
      'https://catalogueimoveis.com.br/imovel/venda-e-locacao/apartamento/natal/ponta-negra/5120',
    );
    expect(itens).toHaveLength(2);
    expect(
      itens.map((x) => ('recusa' in x ? x.recusa : `${x.id_externo}:${x.modo}:${x.data_dado}`)),
    ).toEqual(['5120:venda:2026-11-10', '5120-aluguel:aluguel:2026-11-10']);
    expect(itensDaCatalogue({ ...p, indStatus: 2 }, 'u')).toEqual([
      { recusa: 'imóvel inativo no site' },
    ]);
  });

  it('plataforma Imobibrasil: o link diz modo, cidade e bairro; a página, os números', () => {
    expect(
      lerLinkImobibrasil(
        'https://www.martadegragliaimoveis.com.br/imovel/2674067/apartamento-venda-tibau-do-sul-rn-praia-da-pipa',
      ),
    ).toEqual({
      id: '2674067',
      modo: 'venda',
      cidade: 'tibau do sul',
      bairro: 'praia da pipa',
      tipoSlug: 'apartamento',
    });
    expect(lerLinkImobibrasil('https://x.com.br/imovel/9/casa-temporada-pipa')?.modo).toBeNull();
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Casa para Venda em bairro Praia da Pipa, Tibau do Sul / RN, 3 dormitórios, 2 suítes, 2 vagas","offers":{"price":"950000"}}</script>
      <div>Área Construída: 212,89 m² Área Útil: 450,90 m² Área Total: 600 m² Condomínio R$ 300,00</div>`;
    const p = lerImovelImobibrasil(html);
    expect(p).toMatchObject({
      preco: 950000,
      modo: 'venda',
      tipoTexto: 'Casa',
      cidade: 'Tibau do Sul',
      bairro: 'Praia da Pipa',
      area_construida: 212.89,
      area_util: 450.9,
      quartos: 3,
      suites: 2,
      vagas: 2,
      condominio: 300,
    });
  });

  it('Ibeda: Product do schema.org na página de bairro, com a área do link', () => {
    const html = `<script type="application/ld+json">{"@type":["Product","Apartment"],"name":"Apartamento em Rua X, 1947 - Capim Macio, Natal-RN por R$ 670.000","offers":{"url":"https://ibeda.com.br/imovel/apartamento-98m2-id-915","price":670000},"numberOfBedrooms":3}</script>
      <link rel="next" href="https://ibeda.com.br/imoveis/a-venda/natal-rn/capim-macio/pagina-2">`;
    const p = lerPaginaIbeda(html, 'venda');
    expect(p.proxima).toBe('https://ibeda.com.br/imoveis/a-venda/natal-rn/capim-macio/pagina-2');
    const a = item(anuncioDeSite(p.itens[0] as NonNullable<(typeof p.itens)[0]>, regioes));
    expect(a).toMatchObject({
      id_externo: '915',
      tipo: 'apartamento',
      area_util: 98,
      preco: 670000,
      quartos: 3,
      regiao_id: 'natal-capim-macio',
      logradouro: 'Rua X',
    });
  });

  it('Imobinova: cartões (sem os preços antigos dos comentários)', () => {
    const html = `<article class="card c49-property-card" id="property-77"><a href="https://www.imobinovapipa.com.br/77/imoveis/venda-terreno-pipa">x</a>
      <h2 class="c49-property-card_title">Terreno na Pipa</h2><span class="c49-property-card_type">Terreno</span>
      <div class="c49-property-card_address">Tibau do Sul - RN</div>
      <!-- <div class="c49-property-card_sell-price">R$ 1,00</div> -->
      <div class="c49-property-card_sell-price">Venda R$ 250.000</div><div class="c49-property-card_price">1.000 m²</div></article>`;
    const [p] = lerPaginaImobinova(html);
    expect(p).toMatchObject({
      id_externo: '77',
      preco: 250000,
      area_unica: 1000,
      bairro: 'Praia da Pipa',
      bairroPeloTitulo: true,
      cidade: 'Tibau do Sul',
    });
  });

  it('Abreu: as listas do menu e os cartões com o valor de venda', () => {
    expect(
      listasDoMenuAbreu(
        '<a href="/pesquisa-de-imoveis/?locacao_venda=V&amp;id_cidade[]=1">v</a><a href="https://www.abreuimoveis.com.br/pesquisa-de-imoveis/?locacao_venda=L">l</a>',
      ),
    ).toEqual([
      { modo: 'venda', caminho: '/pesquisa-de-imoveis/?locacao_venda=V&id_cidade[]=1' },
      { modo: 'aluguel', caminho: '/pesquisa-de-imoveis/?locacao_venda=L' },
    ]);
    const html = `120 imóveis para venda <div class="muda_card1 x"><a onclick="toggleFavorito(321)"></a><a href="/comprar/natal/residencial/casa/capim-macio/321">c</a>
      <h2 class="card-titulo">Casa em Capim Macio</h2><div class="card-bairro-cidade-texto">Capim Macio - Natal / RN</div>
      <div class="card-valores"><div>R$ 1.100.000,00 V</div></div></div>
      <div class="a-const-ico"><span></span><span>180 m²</span><div>construída</div></div></div>`;
    const p = lerPaginaAbreu(html);
    expect(p.total).toBe(120);
    expect(p.itens[0]).toMatchObject({
      id: '321',
      bairro: 'Capim Macio',
      cidade: 'Natal',
      tipoLink: 'casa',
      valores: [{ preco: 1_100_000, letra: 'V' }],
    });
  });

  it('feed VRSync: sem o contato do corretor, só nas regiões do estudo', () => {
    const xml = `<ListingDataFeed><Listing><ListingID>A1</ListingID><Title>Casa no Capim Macio</Title><TransactionType>For Sale</TransactionType>
      <DetailViewUrl>https://www.imobiliaria-exemplo.com.br/imovel/A1</DetailViewUrl>
      <Details><PropertyType>Residential / Home</PropertyType><ListPrice>700000</ListPrice><LivingArea unit="square metres">150</LivingArea><LotArea>300</LotArea><Bedrooms>3</Bedrooms></Details>
      <Location><City>Natal</City><Neighborhood>Capim Macio</Neighborhood><Latitude>-5.85</Latitude><Longitude>-35.2</Longitude></Location>
      <ContactInfo><Name>Fulano</Name><Telephone>84999999999</Telephone></ContactInfo></Listing>
      <Listing><ListingID>B2</ListingID><TransactionType>For Sale</TransactionType><DetailViewUrl>https://www.imobiliaria-exemplo.com.br/imovel/B2</DetailViewUrl>
      <Details><PropertyType>Residential / Home</PropertyType><ListPrice>500000</ListPrice></Details><Location><City>Natal</City><Neighborhood>Alecrim</Neighborhood></Location></Listing></ListingDataFeed>`;
    const lidos = lerVrsync(xml, {
      imobiliaria: 'Imobiliária Exemplo',
      dia: '2026-11-19',
      regioes,
      hash: null,
    });
    expect(lidos).toHaveLength(2);
    const a = item(lidos[0] as ReturnType<typeof anuncioDeSite>);
    expect(a).toMatchObject({
      id_externo: 'imobiliaria-exemplo:A1',
      tipo: 'casa',
      area_util: 150,
      area_total: 300,
      lat: -5.85,
      lng: -35.2,
      loc_precisao: 'aproximada',
    });
    expect(JSON.stringify(lidos)).not.toMatch(/Fulano|84999/);
    expect(lidos[1]).toEqual({ recusa: 'fora das regiões do estudo' });
  });
});

describe('o lote que vai ao banco', () => {
  it('não repete id, marca a consulta incompleta e manda em pedaços', async () => {
    const chamadas: ItemAnuncio[][] = [];
    const gravador: Gravador = {
      anuncios: async (itens) => {
        chamadas.push([...itens]);
        return { novos: itens.length, atualizados: 0, ignorados: 0, recusados: 0, erros: [] };
      },
      vistos: async () => 0,
      indices: async () => 0,
      obras: async () => 0,
      proximidades: async () => 0,
    };
    const lote = new LoteDeAnuncios(gravador, 2);
    const base = { url: 'https://www.site.com.br/1', modo: 'venda' as const, tipo: 'casa' };
    await lote.consulta(
      [{ ...base, id_externo: 'a' }, { ...base, id_externo: 'a' }, { recusa: 'sem link' }],
      false,
    );
    await lote.consulta(
      [
        { ...base, id_externo: 'b' },
        { ...base, id_externo: 'c', bruto: { obs: 'olx.com.br/123' } },
      ],
      true,
    );
    await lote.esvaziar();
    expect(chamadas.flat().map((x) => `${x.id_externo}:${String(x.consulta_completa)}`)).toEqual([
      'a:false',
      'b:true',
    ]);
    expect(lote.recusas).toEqual({ 'sem link': 1, 'link de domínio proibido': 1 });
    expect(lote.resumo.novos).toBe(2);
  });
});

describe('fontes oficiais', () => {
  it('FipeZAP: lê a aba Natal de um xlsx (zip) e o texto não cita o portal (#12)', () => {
    const arquivos: Record<string, string> = {
      'xl/workbook.xml':
        '<workbook><sheets><sheet name="Brasil" sheetId="1" r:id="rId1"/><sheet name="Natal" sheetId="2" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Preço médio (R$/m²)</t></si></sst>',
      'xl/worksheets/sheet2.xml':
        '<sheetData><row r="3"><c r="R3" t="s"><v>0</v></c><c r="AL3" t="s"><v>0</v></c></row>' +
        '<row r="5"><c r="B5"><v>46296</v></c><c r="C5"><v>200.5</v></c><c r="M5"><v>0.0768</v></c><c r="R5"><v>6466.7813</v></c><c r="AL5"><v>45.573</v></c><c r="AQ5"><v>0.0058</v></c></row></sheetData>',
    };
    const pontos = lerPlanilhaFipezap(zipDe(arquivos));
    expect(pontos).toEqual([
      {
        mes: '2026-10',
        indice: 200.5,
        var12: 0.0768,
        venda: 6466.7813,
        aluguel: 45.573,
        rent: 0.0058,
      },
    ]);
    const linhas = linhasDoFipezap(pontos);
    expect(linhas.find((l) => l.serie === 'fipezap-natal-venda')).toMatchObject({
      mes: '2026-10-01',
      valor: 6466.78,
      url: expect.stringContaining('downloads.fipe.org.br'),
    });
    expect(linhas.find((l) => l.serie === 'fipezap-natal-var12')?.valor).toBe(7.68);
    expect(linhas.find((l) => l.serie === 'fipezap-natal-rentabilidade')?.valor).toBe(6.96);
    expect(JSON.stringify(linhas)).not.toMatch(/anúncios do ZAP/);
  });

  it('Banco Central: Olinda e SGS viram pontos mensais', () => {
    expect(
      linhasDoOlinda(
        'credito_contratacao_taxa_pf_sfh_rn',
        'Juros',
        '% ao ano',
        {
          value: [
            { Data: '2026-08-31', Valor: 13.86 },
            { Data: 'x', Valor: 1 },
          ],
        },
        'u',
      ),
    ).toMatchObject([
      { serie: 'bcb-credito_contratacao_taxa_pf_sfh_rn', mes: '2026-08-01', valor: 13.86 },
    ]);
    expect(linhasDoIvgr([{ data: '01/09/2026', valor: '803.77' }], 'u')).toMatchObject([
      { serie: 'bcb-ivgr', mes: '2026-09-01', valor: 803.77 },
    ]);
  });

  it('SICONFI: o RREO do período 4 vai até agosto', () => {
    const m = mesesDoRreo(
      {
        items: [
          { conta: 'ITBI', coluna: '<MR>', valor: 6092386.38 },
          { conta: 'ITBI', coluna: '<MR-1>', valor: 5 },
          { conta: 'IPTU', coluna: '<MR>', valor: 9 },
        ],
      },
      2026,
      4,
    );
    expect(m).toEqual({ '2026-08': 6092386.38, '2026-07': 5 });
    expect(mesesDoRreo({ items: [] }, 2026, 4)).toBeNull();
  });

  it('A Corrida dos Bairros: série por região, sub e modo; Capim Macio também vai aproximado para Cidade Jardim', () => {
    const csv =
      'cidade,bairro,tipo,modo,mediana_rs_m2,p25,p75,n_anuncios,yield_anual_pct,coleta\nNatal,Capim Macio,terreno,venda,1500.0,1200,1800,40,,novembro/2026\nNatal,Alecrim,casa,venda,1573.0,1208.1,2347.2,35,,novembro/2026';
    const l = linhasDaCorrida(csv, 'https://acorridadosbairros.com.br/rn/natal/dados.csv', (id) =>
      regioes.existe(id),
    );
    expect(l.map((x) => `${x.serie}|${x.mes}|${String(x.aproximado)}|${x.amostra}`)).toEqual([
      'corrida-natal-capim-macio-terreno-venda|2026-11-01|false|40',
      'corrida-natal-cidade-jardim-terreno-venda|2026-11-01|true|40',
    ]);
    expect(() => linhasDaCorrida('a,b\n1,2', 'u', () => true)).toThrow(/cabeçalho/);
  });

  it('A Corrida: as duas grafias de Pirangi do Norte viram uma linha só (a de maior amostra)', () => {
    const regPirangi = new Regioes([
      {
        id: 'parnamirim-pirangi',
        cidade: 'Parnamirim',
        chaves: ['pirangi'],
        abrangencia: 'distrito',
        ativa: true,
      },
    ]);
    const csv = [
      'cidade,bairro,tipo,modo,mediana_rs_m2,p25,p75,n_anuncios,yield_anual_pct,coleta',
      'Parnamirim,Pirangi do Norte,casa,venda,5000,1,2,12,,novembro/2026',
      'Parnamirim,Pirangi do Norte (Distrito Litoral),casa,venda,5200,1,2,30,,novembro/2026',
    ].join('\n');
    const l = linhasDaCorrida(csv, 'u', (id) => regPirangi.existe(id));
    expect(l.map((x) => `${x.serie}|${x.valor}|${x.amostra}`)).toEqual([
      'corrida-parnamirim-pirangi-casa-venda|5200|30',
    ]);
  });

  it('o lote de índices nunca leva a mesma série e mês duas vezes', () => {
    const base = { nome: 'n', unidade: 'u', metodo: 'm', url: 'https://x' };
    const linhas: LinhaIndice[] = [
      { ...base, serie: 'a', mes: '2026-10-01', valor: 1, amostra: 30 },
      { ...base, serie: 'a', mes: '2026-10-01', valor: 2, amostra: 12 },
      { ...base, serie: 'a', mes: '2026-11-01', valor: 3 },
      { ...base, serie: 'a', mes: '2026-11-01', valor: 4 },
    ];
    const r = indicesSemRepetir(linhas);
    expect(r.repetidas).toBe(2);
    expect(r.linhas.map((x) => `${x.mes}:${x.valor}`)).toEqual(['2026-10-01:1', '2026-11-01:4']);
  });

  it('GeoMapas: soma alvarás e habite-se por bairro e ano, juntando as grafias', () => {
    const m = contarAlvaras([
      {
        features: [
          { properties: { DocAno: 'Alvará_2021', Bairro: 'Candelaria', NumUnidade: '10' } },
          { properties: { DocAno: 'Alvara_2021', Bairro: 'Candelária', NumUnidade: 5 } },
          { properties: { DocAno: 'Habite-se_2022', Bairro: 'Tirol', NumUnidade: 20 } },
          { properties: { DocAno: 'outro', Bairro: 'Tirol' } },
        ],
      },
    ]);
    expect([...m.values()]).toEqual([
      { bairro: 'Candelária', tipo: 'alvara', ano: '2021', n: 2, unidades: 15 },
      { bairro: 'Tirol', tipo: 'habite_se', ano: '2022', n: 1, unidades: 20 },
    ]);
  });

  it('GeoMapas: grafias que só mudam no hífen ou no espaço somam no mesmo bairro', () => {
    const m = contarAlvaras([
      {
        features: [
          { properties: { DocAno: 'Alvará_2024', Bairro: 'Dix-Sept Rosado', NumUnidade: 2 } },
          { properties: { DocAno: 'Alvará_2024', Bairro: 'Dix Sept Rosado', NumUnidade: 3 } },
          { properties: { DocAno: 'Alvará_2024', Bairro: 'Dix-Sept  Rosado.', NumUnidade: 1 } },
        ],
      },
    ]);
    expect([...m.values()].map((x) => `${x.n}:${x.unidades}`)).toEqual(['3:6']);
  });

  it('GeoMapas: série repetida no lote (corte em 70 caracteres) soma em vez de quebrar o upsert', () => {
    const base = {
      nome: 'n',
      unidade: 'documentos no ano',
      metodo: 'm',
      url: 'https://x',
      mes: '2024-01-01',
    };
    const s = somarPorSerie([
      { ...base, serie: 'geomapas-alvara-x', valor: 2, local: 'Bairro A', regiao_id: 'r1' },
      { ...base, serie: 'geomapas-alvara-x', valor: 3, local: 'Bairro B', regiao_id: 'r2' },
      { ...base, serie: 'geomapas-alvara-y', valor: 1, local: 'Bairro C' },
    ]);
    expect(s.map((x) => `${x.serie}:${x.valor}:${x.local}:${String(x.regiao_id)}`)).toEqual([
      'geomapas-alvara-x:5:Bairro A + Bairro B:null',
      'geomapas-alvara-y:1:Bairro C:undefined',
    ]);
  });
});

describe('obras', () => {
  it('Diário Oficial: o ato de obra com fase, bairro e rua, sem dado pessoal', () => {
    const texto = [
      'ORDEM DE SERVIÇO Nº 12/2026',
      'Objeto: pavimentação e drenagem da Rua das Flores, no bairro Capim Macio. Responsável técnico: João da Silva, CPF 123.456.789-00. Valor: R$ 1.000.000,00.',
      'PORTARIA DE PESSOAL',
      'Nomeia servidor para o cargo de assessor, sem relação com construção civil ou qualquer coisa parecida aqui.',
    ].join('\n');
    const atos = atosDoTexto(texto);
    expect(atos).toHaveLength(1);
    expect(atos[0]).toMatchObject({
      fase: 'em_andamento',
      tipo: 'obra_publica',
      bairros: ['Capim Macio'],
      abrangencia: 'bairro',
    });
    expect(JSON.stringify(atos)).not.toMatch(/João|123\.456/);
    const linhas = linhasDoAto(
      atos[0] as NonNullable<(typeof atos)[0]>,
      {
        id: '9001',
        data: '2026-11-17',
        rotulo: 'Num. 5000',
        link: 'https://natal.rn.gov.br/dom/arquivo/9001',
      },
      (b) => regioes.regiaoDe({ cidade: 'Natal', bairro: b })?.regiao ?? null,
    );
    expect(linhas[0]).toMatchObject({
      regiao_id: 'natal-capim-macio',
      cidade: 'Natal',
      publicado_em: '2026-11-17',
      url: 'https://natal.rn.gov.br/dom/arquivo/9001',
    });
    expect(tirarDadoPessoal('Requerente: Fulano de Tal; obra na rua')).toBe(
      '[dado pessoal removido]; obra na rua',
    );
  });

  it('Obrasgov.br: só as cinco cidades, sem canceladas, sem a mesma obra duas vezes (#9)', () => {
    const prf = {
      nome: 'Sede da PRF',
      endereco: 'BR-101, km 1, Natal',
      situacao: 'Em execução',
      dataSituacao: '2026-03-01',
      dataFinalPrevista: '2027-01-01',
      executores: [{ nome: 'Município de Natal' }],
    };
    const linhas = linhasDoObrasgov(
      [
        { ...prf, idUnico: '896.24-51' },
        { ...prf, idUnico: '5212.24-16', dataInicialEfetiva: '2026-03-05' },
        {
          idUnico: '1',
          nome: 'Escola em Mossoró',
          situacao: 'Em execução',
          executores: [{ nome: 'Município de Mossoró' }],
        },
        { idUnico: '2', nome: 'Praça em Parnamirim/RN', situacao: 'Cancelada' },
        {
          idUnico: '3',
          nome: 'Elaboração de projetos de drenagem em Natal',
          situacao: 'Em execução',
          executores: [{ nome: 'Município de Natal' }],
        },
      ],
      () => null,
      '2026-11-19',
    );
    expect(linhas.map((l) => `${l.id_externo}:${l.fase}`)).toEqual([
      '5212.24-16:em_andamento',
      '3:prevista',
    ]);
  });

  it('lê o texto de um PDF simples (stream FlateDecode)', () => {
    const conteudo =
      'BT /F1 12 Tf 72 712 Td (ORDEM DE SERVI\\307O) Tj 0 -14 Td (Objeto: obra) Tj ET';
    const stream = deflateSync(Buffer.from(conteudo, 'latin1'));
    const pdf = Buffer.concat([
      Buffer.from(
        '%PDF-1.4\n4 0 obj\n<< /Length ' + stream.length + ' /Filter /FlateDecode >>\nstream\n',
        'latin1',
      ),
      stream,
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
    ]);
    const texto = textoDoPdf(pdf);
    expect(texto).toContain('ORDEM DE SERVIÇO');
    expect(texto).toContain('Objeto: obra');
  });
});

describe('proximidades', () => {
  it('categoria pela etiqueta do mapa', () => {
    expect(categoriaDe({ amenity: 'school' })).toEqual(['escola', 'amenity=school']);
    expect(categoriaDe({ natural: 'coastline' })).toEqual(['costa', 'natural=coastline']);
    expect(categoriaDe({ shop: 'bakery' })).toBeNull();
  });

  it('mede o mais perto de cada categoria, preferindo o que tem nome, dentro do alcance', () => {
    const ponto = {
      mercado_anuncio_id: 'u-1',
      regiao_id: 'natal-ponta-negra',
      lat: -5.88,
      lng: -35.17,
      precisao: 'exata' as const,
    };
    const [area] = areasDeConsulta([ponto]);
    expect(area).toBeDefined();
    const elementos: Array<ElementoDoMapa & { user?: string }> = [
      { type: 'node' as const, id: 1, lat: -5.881, lon: -35.17, tags: { amenity: 'school' } },
      {
        type: 'node' as const,
        id: 2,
        lat: -5.884,
        lon: -35.17,
        tags: { amenity: 'school', name: 'Escola Estadual' },
        version: 4,
        user: 'fulano',
      },
      {
        type: 'way' as const,
        id: 3,
        tags: { natural: 'coastline' },
        geometry: [
          { lat: -5.87, lon: -35.16 },
          { lat: -5.89, lon: -35.16 },
        ],
      },
      {
        type: 'node' as const,
        id: 4,
        lat: -6.5,
        lon: -35.17,
        tags: { shop: 'mall', name: 'Longe Demais' },
      },
    ];
    const linhas = medir(ponto, elementos, area?.caixa ?? { s: 0, o: 0, n: 0, l: 0 }, '2026-11-18');
    const escola = linhas.find((l) => l.categoria === 'escola');
    expect(escola).toMatchObject({
      osm_id: 2,
      nome: 'Escola Estadual',
      osm_versao: 4,
      precisao_ponto: 'exata',
      mercado_anuncio_id: 'u-1',
      url: 'https://www.openstreetmap.org/node/2',
    });
    expect(escola?.distancia_m).toBeGreaterThan(400);
    expect(linhas.find((l) => l.categoria === 'costa')?.distancia_m).toBeGreaterThan(1000);
    expect(linhas.find((l) => l.categoria === 'shopping')).toBeUndefined();
    expect(JSON.stringify(linhas)).not.toMatch(/fulano/);
  });
});

/** Um ZIP mínimo (deflate) para o teste da planilha. */
function zipDe(arquivos: Record<string, string>): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const dados = Buffer.from(conteudo, 'utf8');
    const comp = deflateRawSync(dados);
    const n = Buffer.from(nome, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(n.length, 26);
    locais.push(local, n, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, n);
    deslocamento += 30 + n.length + comp.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(Object.keys(arquivos).length, 8);
  fim.writeUInt16LE(Object.keys(arquivos).length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  const zip = Buffer.concat([...locais, dir, fim]);
  if (!lerDoZip(zip, 'xl/workbook.xml')) throw new Error('zip de teste quebrado');
  return zip;
}
