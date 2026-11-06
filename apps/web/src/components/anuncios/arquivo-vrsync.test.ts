import { describe, expect, it } from 'vitest';

import {
  montarVrsync,
  type AnuncioDoFeed,
} from '../../../../../supabase/functions/canal-pro-feed/vrsync';

import {
  codigoValido,
  dadosParaImportar,
  descricaoDoArquivo,
  lerArquivoVrsync,
  numeroDoArquivo,
  textoDoArquivo,
  TIPOS_DO_PORTAL,
  type AnuncioDoArquivo,
  type ArquivoLido,
} from './arquivo-vrsync';
import { TIPOS_DE_IMOVEL } from './tipos';

const ABERTURA = `<?xml version="1.0" encoding="UTF-8"?>
<ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xsi:schemaLocation="http://www.vivareal.com/schemas/1.0/VRSync  http://xml.vivareal.com/vrsync.xsd">`;

function feed(listings: string, cabecalho = ''): string {
  return `${ABERTURA}
  ${cabecalho}
  <Listings>
${listings}
  </Listings>
</ListingDataFeed>`;
}

function listing(id: string, details: string, uso = 'Residential'): string {
  return `<Listing>
  <ListingID>${id}</ListingID>
  <Title><![CDATA[Anúncio ${id}]]></Title>
  <TransactionType>For Sale</TransactionType>
  <Details>
    <UsageType>${uso}</UsageType>
    ${details}
    <Description><![CDATA[Descrição curta.]]></Description>
    <ListPrice currency="BRL">100000</ListPrice>
  </Details>
</Listing>`;
}

/** Um arquivo como o do sistema atual da Imova: o modelo da documentação do VRSync, em Natal. */
const DO_SISTEMA_ATUAL = feed(
  `
    <Listing>
      <ListingID>SA0012_IMOVA</ListingID>
      <Title><![CDATA[Apartamento 3 quartos com varanda gourmet em Ponta Negra]]></Title>
      <TransactionType>For Sale</TransactionType>
      <PublicationType>PREMIUM</PublicationType>
      <DetailViewUrl>https://www.imova.com.br/imovel/SA0012</DetailViewUrl>
      <Media>
        <Item medium="video">https://www.youtube.com/watch?v=MukVADdjQD8</Item>
        <Item medium="image" caption="sala">https://fotos.sistema.com.br/sa0012/02.jpg</Item>
        <Item medium="image" caption="fachada" primary="true">https://fotos.sistema.com.br/sa0012/01.jpg</Item>
        <Item medium="image" caption="cozinha">https://fotos.sistema.com.br/sa0012/03.jpg</Item>
        <Item medium="image">https://fotos.sistema.com.br/sa0012/02.jpg</Item>
        <Item medium="floorplan">https://fotos.sistema.com.br/sa0012/planta.pdf</Item>
      </Media>
      <Details>
        <UsageType>Residential</UsageType>
        <PropertyType>Residential / Apartment</PropertyType>
        <Description><![CDATA[Apartamento nascente, a 300 m da praia.&lt;br&gt;&lt;br&gt;
&bull; &lt;b&gt;3 quartos&lt;/b&gt;, sendo 1 suíte&lt;br&gt;
&bull; Varanda gourmet&lt;br&gt
Agende sua visita!]]></Description>
        <ListPrice currency="BRL">680000</ListPrice>
        <LivingArea unit="square metres">92</LivingArea>
        <PropertyAdministrationFee currency="BRL">850</PropertyAdministrationFee>
        <YearlyTax currency="BRL">2400</YearlyTax>
        <Bedrooms>3</Bedrooms>
        <Bathrooms>2</Bathrooms>
        <Suites>1</Suites>
        <Garage type="Parking Space">2</Garage>
        <Features>
          <Feature>Pool</Feature>
          <Feature>Gourmet Balcony</Feature>
          <Feature>elevator</Feature>
          <Feature>Close to schools</Feature>
          <Feature>Fireplace</Feature>
        </Features>
      </Details>
      <Location displayAddress="Street">
        <Country abbreviation="BR">Brasil</Country>
        <State abbreviation="RN"><![CDATA[Rio Grande do Norte]]></State>
        <City><![CDATA[Natal]]></City>
        <Neighborhood><![CDATA[Ponta Negra]]></Neighborhood>
        <Address><![CDATA[Rua Praia de Muriú]]></Address>
        <StreetNumber>100</StreetNumber>
        <Complement><![CDATA[Apto 502]]></Complement>
        <PostalCode>59090-210</PostalCode>
      </Location>
      <ContactInfo>
        <Name>Imova Imobiliária</Name>
        <Email>contato@imova.com.br</Email>
      </ContactInfo>
    </Listing>
    <Listing>
      <ListingID>SA0020_IMOVA</ListingID>
      <Title>Casa em Capim Macio</Title>
      <TransactionType>For Sale</TransactionType>
      <PublicationType>STANDARD</PublicationType>
      <Media>
        <Item medium="image" primary="true">https://fotos.sistema.com.br/sa0020/01.jpg</Item>
      </Media>
      <Details>
        <UsageType>Residential</UsageType>
        <PropertyType>Residential / Home</PropertyType>
        <Description>Casa térrea com quintal. &lt;br&gt; Rua calma.</Description>
        <ListPrice currency="BRL">950000.00</ListPrice>
        <Iptu currency="BRL" period="Monthly">180</Iptu>
        <YearlyTax currency="BRL">9999</YearlyTax>
        <LivingArea unit="square metres">180,50</LivingArea>
        <LotArea unit="square metres">300</LotArea>
        <Bedrooms>4</Bedrooms>
      </Details>
      <Location displayAddress="All">
        <State abbreviation="RN">Rio Grande do Norte</State>
        <City>Natal</City>
        <Neighborhood>Capim Macio</Neighborhood>
      </Location>
    </Listing>
    <Listing>
      <ListingID>SA0031_IMOVA</ListingID>
      <Title><![CDATA[Terreno em Parnamirim]]></Title>
      <TransactionType>For Sale</TransactionType>
      <PublicationType>TRIPLE</PublicationType>
      <Details>
        <UsageType>Residential</UsageType>
        <PropertyType>Residential / Land Lot</PropertyType>
        <Description><![CDATA[Terreno plano.]]></Description>
        <ListPrice currency="BRL">1.200.000</ListPrice>
        <LotArea unit="hectare">2,5</LotArea>
      </Details>
      <Location displayAddress="Neighborhood">
        <State>Rio Grande do Norte</State>
        <City>Parnamirim</City>
      </Location>
    </Listing>
    <Listing>
      <ListingID>LA0007_IMOVA</ListingID>
      <Title><![CDATA[Sala comercial no Tirol]]></Title>
      <TransactionType>For Rent</TransactionType>
      <Details>
        <UsageType>Commercial</UsageType>
        <PropertyType>Commercial / Office</PropertyType>
        <Description><![CDATA[Sala com recepção.]]></Description>
        <ListPrice currency="BRL">300000</ListPrice>
        <RentalPrice currency="BRL" period="Monthly">2800</RentalPrice>
        <PropertyAdministrationFee currency="BRL">0</PropertyAdministrationFee>
        <LivingArea unit="square feet">400</LivingArea>
        <Bathrooms>1</Bathrooms>
      </Details>
      <Location>
        <City>Natal</City>
        <Neighborhood>Tirol</Neighborhood>
        <PostalCode>5902</PostalCode>
      </Location>
    </Listing>
    <Listing>
      <Title><![CDATA[Cobertura sem código]]></Title>
      <TransactionType>For Sale</TransactionType>
    </Listing>
    <Listing>
      <ListingID>SA0012_IMOVA</ListingID>
      <Title><![CDATA[Repetido]]></Title>
    </Listing>
    <Listing>
      <ListingID>SA0099 - código do sistema atual que passa de cinquenta letras</ListingID>
      <Title><![CDATA[Código comprido demais]]></Title>
    </Listing>`,
  `<Header>
    <Provider>Sistema Atual</Provider>
    <Email>suporte@sistema.com.br</Email>
    <ContactName><![CDATA[Imova Imobiliária]]></ContactName>
    <PublishDate>2026-11-05T08:00:00</PublishDate>
  </Header>`,
);

function lido(xml: string): Extract<ArquivoLido, { ok: true }> {
  const r = lerArquivoVrsync(xml);
  if (!r.ok) throw new Error(`não leu: ${r.motivo}`);
  return r;
}

function doCodigo(r: Extract<ArquivoLido, { ok: true }>, codigo: string): AnuncioDoArquivo {
  const a = r.anuncios.find((x) => x.codigo === codigo);
  if (!a) throw new Error(`sem ${codigo}`);
  return a;
}

describe('lerArquivoVrsync: o arquivo do sistema atual', () => {
  const r = lido(DO_SISTEMA_ATUAL);

  it('lê o cabeçalho', () => {
    expect(r.cabecalho).toEqual({
      provedor: 'Sistema Atual',
      email: 'suporte@sistema.com.br',
      nome: 'Imova Imobiliária',
      publicadoEm: '2026-11-05T08:00:00',
    });
  });

  it('deixa de fora quem não tem código, o repetido e o código inválido, dizendo por quê', () => {
    expect(r.anuncios.map((a) => a.codigo)).toEqual([
      'SA0012_IMOVA',
      'SA0020_IMOVA',
      'SA0031_IMOVA',
      'LA0007_IMOVA',
    ]);
    expect(r.avisos).toHaveLength(3);
    expect(r.avisos[0]).toContain('sem código');
    expect(r.avisos[0]).toContain('Cobertura sem código');
    expect(r.avisos[1]).toContain('SA0012_IMOVA aparece mais de uma vez');
    expect(r.avisos[2]).toContain(
      '“SA0099 - código do sistema atual que passa de cinquenta letras”',
    );
    // Vale o primeiro: o repetido não sobrescreve o título.
    expect(doCodigo(r, 'SA0012_IMOVA').titulo).toBe(
      'Apartamento 3 quartos com varanda gourmet em Ponta Negra',
    );
  });

  it('apartamento: tudo no lugar, capa primeiro, descrição com quebras e IPTU do YearlyTax', () => {
    const a = doCodigo(r, 'SA0012_IMOVA');
    expect(dadosParaImportar(a)).toEqual({
      codigo: 'SA0012_IMOVA',
      titulo: 'Apartamento 3 quartos com varanda gourmet em Ponta Negra',
      descricao:
        'Apartamento nascente, a 300 m da praia.\n\n• 3 quartos, sendo 1 suíte\n• Varanda gourmet\nAgende sua visita!',
      tipo: 'apartamento',
      negocio: 'venda',
      preco_venda: 680000,
      preco_aluguel: null,
      periodo_aluguel: 'mensal',
      condominio: 850,
      iptu: 2400,
      iptu_periodo: 'anual',
      area_util: 92,
      area_total: null,
      quartos: 3,
      suites: 1,
      banheiros: 2,
      vagas: 2,
      caracteristicas: ['Pool', 'Gourmet Balcony', 'Elevator'],
      cep: '59090210',
      estado: 'RN',
      cidade: 'Natal',
      bairro: 'Ponta Negra',
      endereco: 'Rua Praia de Muriú',
      numero: '100',
      complemento: 'Apto 502',
      mostrar_endereco: 'rua',
      video_youtube: 'https://www.youtube.com/watch?v=MukVADdjQD8',
      destaque: 'destaque',
    });
    expect(a.fotos).toEqual([
      'https://fotos.sistema.com.br/sa0012/01.jpg',
      'https://fotos.sistema.com.br/sa0012/02.jpg',
      'https://fotos.sistema.com.br/sa0012/03.jpg',
    ]);
    expect(a.avisos).toEqual([
      'Mídia que o CRM não guarda ficou de fora: 1 × floorplan.',
      'Características que o CRM não tem ficaram de fora: Close to schools, Fireplace.',
    ]);
  });

  it('casa: o Iptu novo vale sobre o YearlyTax, centavos e decimais saem', () => {
    const a = doCodigo(r, 'SA0020_IMOVA');
    expect(a.tipo).toBe('casa');
    expect(a.preco_venda).toBe(950000);
    expect(a.iptu).toBe(180);
    expect(a.iptu_periodo).toBe('mensal');
    expect(a.area_util).toBe(180);
    expect(a.area_total).toBe(300);
    expect(a.quartos).toBe(4);
    expect(a.descricao).toBe('Casa térrea com quintal.\nRua calma.');
    expect(a.mostrar_endereco).toBe('completo');
    expect(a.destaque).toBe('padrao');
    expect(a.fotos).toEqual(['https://fotos.sistema.com.br/sa0020/01.jpg']);
    expect(a.avisos).toEqual([]);
  });

  it('terreno: hectare vira m², TRIPLE vira Destaque com aviso, estado pelo nome', () => {
    const a = doCodigo(r, 'SA0031_IMOVA');
    expect(a.tipo).toBe('terreno');
    expect(a.preco_venda).toBe(1200000);
    expect(a.area_total).toBe(25000);
    expect(a.area_util).toBeNull();
    expect(a.estado).toBe('RN');
    expect(a.mostrar_endereco).toBe('bairro');
    expect(a.destaque).toBe('destaque');
    expect(a.fotos).toEqual([]);
    expect(a.avisos).toEqual([
      'O destaque “TRIPLE” não existe no CRM (o validador do Grupo OLX recusa): entrou como Destaque.',
    ]);
  });

  it('aluguel: só o preço do aluguel, condomínio isento, unidade estranha e CEP curto viram aviso', () => {
    const a = doCodigo(r, 'LA0007_IMOVA');
    expect(a.tipo).toBe('sala_comercial');
    expect(a.negocio).toBe('aluguel');
    expect(a.preco_aluguel).toBe(2800);
    expect(a.preco_venda).toBeNull();
    expect(a.periodo_aluguel).toBe('mensal');
    expect(a.condominio).toBe(0);
    expect(a.area_util).toBeNull();
    expect(a.cep).toBeNull();
    expect(a.estado).toBeNull();
    expect(a.mostrar_endereco).toBe('rua');
    expect(a.avisos).toEqual([
      'A área útil veio em “square feet”, que o CRM não converte: ficou vazia.',
      'O CEP “5902” não tem 8 números: ficou vazio.',
    ]);
  });
});

describe('lerArquivoVrsync: tipos de imóvel', () => {
  function tipo(propertyType: string, uso = 'Residential') {
    return lido(feed(listing('X1', `<PropertyType>${propertyType}</PropertyType>`, uso)))
      .anuncios[0]!;
  }

  it('cada PropertyType do CRM volta para um tipo que existe na tela', () => {
    const ids = new Set(TIPOS_DE_IMOVEL.map((t) => t.id));
    for (const slug of Object.values(TIPOS_DO_PORTAL)) expect(ids.has(slug)).toBe(true);
    // E todo tipo da tela tem volta.
    expect(new Set(Object.values(TIPOS_DO_PORTAL))).toEqual(ids);
  });

  it('aceita as formas curtas que o validador aceita', () => {
    expect(tipo('Apartment').tipo).toBe('apartamento');
    expect(tipo('Home').tipo).toBe('casa');
    expect(tipo('Land Lot').tipo).toBe('terreno');
    expect(tipo('Land Lot', 'Commercial').tipo).toBe('terreno_comercial');
    expect(tipo('Commercial / Loja').tipo).toBe('loja');
    expect(tipo('Residential / Loft').tipo).toBe('loft');
    expect(tipo('residential/penthouse').tipo).toBe('cobertura');
    expect(tipo('Commercial / Edifício Comercial').tipo).toBe('predio_comercial');
  });

  it('tipo desconhecido entra como apartamento, com aviso', () => {
    const a = tipo('Residential / Castle');
    expect(a.tipo).toBe('apartamento');
    expect(a.avisos).toEqual([
      'O tipo “Residential / Castle” o CRM não conhece: entrou como apartamento. Confira.',
    ]);
  });
});

describe('lerArquivoVrsync: o que não é arquivo de anúncios', () => {
  it('XML quebrado: diz a linha', () => {
    const r = lerArquivoVrsync(
      `${ABERTURA}\n<Listings>\n<Listing><ListingID>A1</ListingID>\n</Listings>\n</ListingDataFeed>`,
    );
    expect(r).toEqual({ ok: false, motivo: 'xml_invalido', linha: expect.any(Number) });
  });

  it('raiz que não é ListingDataFeed', () => {
    expect(lerArquivoVrsync('<?xml version="1.0"?><Carga><Imoveis/></Carga>')).toEqual({
      ok: false,
      motivo: 'nao_e_vrsync',
    });
  });

  it('página HTML (login, erro) não é XML quebrado: não é VRSync', () => {
    expect(
      lerArquivoVrsync('<!DOCTYPE html><html><body><p>Acesso negado<br></body></html>'),
    ).toEqual({ ok: false, motivo: 'nao_e_vrsync' });
  });

  it('vazio: arquivo em branco ou sem Listing', () => {
    expect(lerArquivoVrsync('  \n')).toEqual({ ok: false, motivo: 'vazio' });
    expect(lerArquivoVrsync(feed(''))).toEqual({ ok: false, motivo: 'vazio' });
  });

  it('código "007" continua texto', () => {
    expect(lido(feed(listing('007', ''))).anuncios[0]!.codigo).toBe('007');
  });
});

describe('lerArquivoVrsync: o arquivo que o próprio CRM gera volta igual', () => {
  const base: AnuncioDoFeed = {
    codigo: 'IMV-0001',
    titulo: 'Apartamento de 3 quartos em Ponta Negra',
    descricao: 'Nascente, perto da praia.\nVaranda gourmet e duas vagas.\n\nAceita financiamento.',
    tipo: 'apartamento',
    tipo_vrsync: 'Residential / Apartment',
    uso: 'Residential',
    area: 'util',
    negocio: 'venda_aluguel',
    destaque: 'super_destaque',
    preco_venda: 450000,
    preco_aluguel: 2500,
    periodo_aluguel: 'mensal',
    condominio: 650,
    iptu: 1200,
    iptu_periodo: 'anual',
    area_util: 90,
    area_total: null,
    quartos: 3,
    suites: 1,
    banheiros: 2,
    vagas: 2,
    caracteristicas: ['Elevator', 'Pool'],
    cep: '59090000',
    estado: 'RN',
    cidade: 'Natal',
    bairro: 'Ponta Negra',
    endereco: 'Rua das Dunas',
    numero: '123',
    complemento: 'Apto 301',
    mostrar_endereco: 'rua',
    video_youtube: 'https://www.youtube.com/watch?v=abc123',
    fotos: ['IMV/1.jpg', 'IMV/2.jpg'],
  };

  it('venda e aluguel, com tudo', () => {
    const xml = montarVrsync(
      { nome: 'Imova Imobiliária', email: 'contato@imova.com.br', telefone: null, site: null },
      [base],
      (c) => `https://exemplo.supabase.co/storage/v1/object/public/anuncios/${c}`,
      new Date('2026-11-05T12:00:00Z'),
    );
    const r = lido(xml);
    expect(r.cabecalho).toEqual({
      provedor: 'Tríade',
      email: 'contato@imova.com.br',
      nome: 'Imova Imobiliária',
      publicadoEm: '2026-11-05T09:00:00',
    });
    const a = r.anuncios[0]!;
    const { tipo_vrsync: _t, uso: _u, area: _a, fotos: _f, ...esperado } = base;
    expect(dadosParaImportar(a)).toEqual(esperado);
    expect(a.fotos).toEqual([
      'https://exemplo.supabase.co/storage/v1/object/public/anuncios/IMV/1.jpg',
      'https://exemplo.supabase.co/storage/v1/object/public/anuncios/IMV/2.jpg',
    ]);
    expect(a.avisos).toEqual([]);
  });

  it('cada tipo do CRM volta como ele mesmo (menos o loft, que o portal vê como apartamento)', () => {
    const anuncios = Object.entries(TIPOS_DO_PORTAL)
      .filter(([forma]) => forma !== 'residential / loft' && forma !== 'commercial / loja')
      .map(([forma, tipo], i): AnuncioDoFeed => {
        const [uso, nome] = forma.split(' / ') as [string, string];
        return {
          ...base,
          codigo: `T${i}`,
          tipo,
          tipo_vrsync: `${uso[0]!.toUpperCase()}${uso.slice(1)} / ${nome.replace(/\b\w/g, (l) => l.toUpperCase())}`,
          uso: uso === 'commercial' ? 'Commercial' : 'Residential',
        };
      });
    const r = lido(
      montarVrsync(
        { nome: 'Imova', email: 'a@b.co', telefone: null, site: null },
        anuncios,
        (c) => c,
      ),
    );
    expect(r.anuncios.map((a) => a.tipo)).toEqual(anuncios.map((a) => a.tipo));
  });
});

describe('descricaoDoArquivo', () => {
  it('entende as quebras como os sistemas mandam', () => {
    expect(descricaoDoArquivo('a&lt;br&gt;b&lt;br/&gt;c&lt;BR /&gt;d&lt;br&gt\ne')).toBe(
      'a\nb\nc\nd\ne',
    );
    expect(descricaoDoArquivo('a<br>b<br/>c')).toBe('a\nb\nc');
    expect(descricaoDoArquivo('<p>um</p><p>dois</p>')).toBe('um\ndois');
    expect(descricaoDoArquivo('&lt;i&gt;itálico&lt;/i&gt; e &#233; &amp; &nbsp;fim')).toBe(
      'itálico e é & fim',
    );
    expect(descricaoDoArquivo('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('corta em 3.000 letras, com aviso', () => {
    const r = lido(
      feed(
        listing('LONGO', '').replace(
          '<Description><![CDATA[Descrição curta.]]></Description>',
          `<Description><![CDATA[${'x'.repeat(3100)}]]></Description>`,
        ),
      ),
    );
    expect(r.anuncios[0]!.descricao).toHaveLength(3000);
    expect(r.anuncios[0]!.avisos).toContain('A descrição passou de 3000 letras e foi cortada.');
  });
});

describe('numeroDoArquivo', () => {
  it.each([
    ['860000', 860000],
    ['860000.00', 860000],
    ['1.287', 1287],
    ['1.200.000,50', 1200000.5],
    ['1,200,000.50', 1200000.5],
    ['32,20', 32.2],
    ['R$ 2.800', 2800],
    ['0.5', 0.5],
    ['', null],
    ['abc', null],
    ['-10', null],
  ])('%s → %s', (texto, numero) => {
    expect(numeroDoArquivo(texto)).toBe(numero);
  });
});

describe('textoDoArquivo', () => {
  it('UTF-8, com e sem BOM', () => {
    const utf8 = new TextEncoder().encode('<a>Ponta Negra, Natal — São</a>');
    expect(textoDoArquivo(utf8)).toBe('<a>Ponta Negra, Natal — São</a>');
    expect(textoDoArquivo(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toBe(
      '<a>Ponta Negra, Natal — São</a>',
    );
  });

  it('ISO-8859-1 declarado, e Latin-1 disfarçado de UTF-8', () => {
    const latin1 = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
    expect(
      textoDoArquivo(latin1('<?xml version="1.0" encoding="ISO-8859-1"?><a>São Paulo</a>')),
    ).toBe('<?xml version="1.0" encoding="ISO-8859-1"?><a>São Paulo</a>');
    expect(
      textoDoArquivo(latin1('<?xml version="1.0" encoding="UTF-8"?><a>Parnamirim, não</a>')),
    ).toBe('<?xml version="1.0" encoding="UTF-8"?><a>Parnamirim, não</a>');
  });
});

describe('codigoValido: o código como o Canal Pro usa', () => {
  it('aceita espaço no meio e acento', () => {
    expect(codigoValido('Casa extremox')).toBe(true);
    expect(codigoValido('Edifício Simone')).toBe(true);
    expect(codigoValido('Brisa Mall - Loja 02')).toBe(true);
    expect(codigoValido('TE0001_IMOVA')).toBe(true);
  });

  it('recusa vazio, espaço nas pontas, < > e mais de 50 caracteres', () => {
    expect(codigoValido('')).toBe(false);
    expect(codigoValido(' Casa')).toBe(false);
    expect(codigoValido('Casa ')).toBe(false);
    expect(codigoValido('Casa <b>')).toBe(false);
    expect(codigoValido('x'.repeat(50))).toBe(true);
    expect(codigoValido('x'.repeat(51))).toBe(false);
  });
});
