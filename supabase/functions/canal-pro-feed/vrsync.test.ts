// =============================================================================
// Testes do arquivo VRSync. Rodam sem rede e sem banco:
//   docker run --rm -v "$PWD/supabase/functions":/w -w /w denoland/deno:alpine-2.1.4 \
//     test canal-pro-feed/vrsync.test.ts
//
// O que protegem:
//   1. o vocabulário do VRSync (TransactionType, PublicationType, PropertyType,
//      displayAddress, período do aluguel) sai como a documentação escreve;
//   2. texto livre nunca vira marcação: CDATA nos textos, "]]>" partido,
//      entidades no resto;
//   3. as regras de área e de quartos por tipo (terreno, kitnet, studio);
//   4. a capa é a primeira foto e o vídeo do YouTube vai junto.
// =============================================================================

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import {
  type AnuncioDoFeed,
  cdata,
  cepDoPortal,
  dataDoCabecalho,
  descricaoDoPortal,
  type Imobiliaria,
  montarVrsync,
} from './vrsync.ts';

const IMOVA: Imobiliaria = {
  nome: 'Imova Imobiliária',
  email: 'contato@imovaimobiliaria.com.br',
  telefone: '(84) 99405-8888',
  site: null,
};

function apartamento(extra: Partial<AnuncioDoFeed> = {}): AnuncioDoFeed {
  return {
    codigo: 'IMV-0001',
    titulo: 'Apartamento de 3 quartos em Ponta Negra',
    descricao: 'Nascente, perto da praia.\nVaranda gourmet e duas vagas.',
    tipo: 'apartamento',
    tipo_vrsync: 'Residential / Apartment',
    uso: 'Residential',
    area: 'util',
    negocio: 'venda',
    destaque: 'padrao',
    preco_venda: 450000,
    preco_aluguel: null,
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
    endereco: 'Rua Praia de Genipabu',
    numero: '100',
    complemento: 'Apto 1201',
    mostrar_endereco: 'rua',
    video_youtube: null,
    fotos: ['a/1.jpg', 'a/2.jpg', 'a/3.jpg', 'a/4.jpg', 'a/5.jpg'],
    ...extra,
  };
}

const foto = (c: string) => `https://exemplo.supabase.co/storage/v1/object/public/anuncios/${c}`;
const AGORA = new Date('2026-11-04T18:30:00Z');

Deno.test('o cabeçalho e o anúncio saem com o vocabulário do VRSync', () => {
  const xml = montarVrsync(IMOVA, [apartamento()], foto, AGORA);
  assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assertStringIncludes(xml, '<ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync"');
  assertStringIncludes(xml, '<PublishDate>2026-11-04T15:30:00</PublishDate>');
  assertStringIncludes(xml, '<ListingID>IMV-0001</ListingID>');
  assertStringIncludes(xml, '<TransactionType>For Sale</TransactionType>');
  assertStringIncludes(xml, '<PublicationType>STANDARD</PublicationType>');
  assertStringIncludes(xml, '<PropertyType>Residential / Apartment</PropertyType>');
  assertStringIncludes(xml, '<ListPrice currency="BRL">450000</ListPrice>');
  assertStringIncludes(
    xml,
    '<PropertyAdministrationFee currency="BRL">650</PropertyAdministrationFee>',
  );
  assertStringIncludes(xml, '<Iptu currency="BRL" period="Yearly">1200</Iptu>');
  assertStringIncludes(xml, '<LivingArea unit="square metres">90</LivingArea>');
  assertStringIncludes(xml, '<Garage type="Parking Space">2</Garage>');
  assertStringIncludes(
    xml,
    '<Features><Feature>Elevator</Feature><Feature>Pool</Feature></Features>',
  );
  assertStringIncludes(xml, '<Location displayAddress="Street">');
  assertStringIncludes(xml, '<State abbreviation="RN"><![CDATA[Rio Grande do Norte]]></State>');
  assertStringIncludes(xml, '<PostalCode>59090-000</PostalCode>');
  assertStringIncludes(xml, '<Name><![CDATA[Imova Imobiliária]]></Name>');
  assert(!xml.includes('RentalPrice'), 'venda não leva preço de aluguel');
});

Deno.test('aluguel e venda com aluguel levam o período e os dois preços', () => {
  const xml = montarVrsync(
    IMOVA,
    [
      apartamento({
        negocio: 'venda_aluguel',
        preco_aluguel: 3200,
        periodo_aluguel: 'mensal',
        destaque: 'super_destaque',
      }),
    ],
    foto,
    AGORA,
  );
  assertStringIncludes(xml, '<TransactionType>Sale/Rent</TransactionType>');
  assertStringIncludes(xml, '<RentalPrice currency="BRL" period="Monthly">3200</RentalPrice>');
  assertStringIncludes(xml, '<ListPrice currency="BRL">450000</ListPrice>');
  assertStringIncludes(xml, '<PublicationType>SUPER_PREMIUM</PublicationType>');
});

Deno.test('a capa é a primeira foto, e o vídeo do YouTube vai junto', () => {
  const xml = montarVrsync(
    IMOVA,
    [apartamento({ video_youtube: 'https://www.youtube.com/watch?v=abc123&t=5' })],
    foto,
    AGORA,
  );
  assertStringIncludes(
    xml,
    '<Item medium="video">https://www.youtube.com/watch?v=abc123&amp;t=5</Item>' +
      '<Item medium="image" primary="true">https://exemplo.supabase.co/storage/v1/object/public/anuncios/a/1.jpg</Item>' +
      '<Item medium="image">https://exemplo.supabase.co/storage/v1/object/public/anuncios/a/2.jpg</Item>',
  );
  assertEquals(xml.match(/primary="true"/g)?.length, 1);
});

Deno.test('texto livre nunca vira marcação', () => {
  assertEquals(cdata('a ]]> b'), '<![CDATA[a ]]]]><![CDATA[> b]]>');
  const xml = montarVrsync(
    { ...IMOVA, nome: 'Imova & Cia <teste>' },
    [apartamento({ titulo: 'Casa ]]> <script>', bairro: 'Areia Preta & Cia' })],
    foto,
    AGORA,
  );
  // Dentro do CDATA, "<script>" é texto: o "]]>" do título não fecha a seção antes da hora.
  assertStringIncludes(xml, '<Title><![CDATA[Casa ]]]]><![CDATA[> <script>]]></Title>');
  assertStringIncludes(xml, '<Neighborhood><![CDATA[Areia Preta & Cia]]></Neighborhood>');
  assertStringIncludes(xml, '<ContactName><![CDATA[Imova & Cia <teste>]]></ContactName>');
});

Deno.test('quebra de linha vira <br> do portal, enquanto couber nos 3.000 caracteres', () => {
  assertEquals(descricaoDoPortal('linha 1\r\nlinha 2'), 'linha 1&lt;br&gt;\nlinha 2');
  const longa = Array.from({ length: 400 }, () => 'abcdef').join('\n');
  assertEquals(descricaoDoPortal(longa), longa, 'acima do teto, vai o texto puro');
});

Deno.test('terreno manda a área total, e também como útil quando não há útil', () => {
  const xml = montarVrsync(
    IMOVA,
    [
      apartamento({
        tipo: 'terreno',
        tipo_vrsync: 'Residential / Land Lot',
        area: 'total',
        area_util: null,
        area_total: 360,
        quartos: null,
        banheiros: null,
        vagas: null,
        suites: null,
      }),
    ],
    foto,
    AGORA,
  );
  assertStringIncludes(xml, '<LotArea unit="square metres">360</LotArea>');
  assertStringIncludes(xml, '<LivingArea unit="square metres">360</LivingArea>');
  assert(!xml.includes('<Bedrooms>'));
  assert(!xml.includes('<Bathrooms>'));
});

Deno.test('kitnet vai sem quartos; studio vai com 0 quando ninguém disse', () => {
  const kitnet = montarVrsync(IMOVA, [apartamento({ tipo: 'kitnet', quartos: 1 })], foto, AGORA);
  assert(!kitnet.includes('<Bedrooms>'));
  const studio = montarVrsync(IMOVA, [apartamento({ tipo: 'studio', quartos: null })], foto, AGORA);
  assertStringIncludes(studio, '<Bedrooms>0</Bedrooms>');
});

Deno.test('CEP e data no formato dos exemplos', () => {
  assertEquals(cepDoPortal('59090000'), '59090-000');
  assertEquals(dataDoCabecalho(new Date('2026-01-01T02:59:59Z')), '2025-12-31T23:59:59');
});

Deno.test('sem anúncio no ar, o arquivo é válido e vazio', () => {
  const xml = montarVrsync(IMOVA, [], foto, AGORA);
  assertStringIncludes(xml, '<Listings>\n</Listings>');
});
