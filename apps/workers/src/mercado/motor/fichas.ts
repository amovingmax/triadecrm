/**
 * Os fatos de ficha que o CRM ainda não tem estruturados (pendência): o que a
 * equipe confirmou e o caderno usa, por imóvel. Cópia dos campos curados de
 * `imoveis-imova.json` do protótipo (revisão de 17/11/2026): o código que o CRM
 * usa (`codigo_crm`), a região certa, a finalidade (repasse, aluguel), se
 * entra na comparação, a área que ninguém sabe o que é (`area_ambigua`), os
 * lotes e os atributos confirmados (esquina, escritura pública, uso comercial,
 * ocupação máxima, frente-mar...). Preço, áreas, quartos, suítes e vagas vêm
 * do CRM, vivos; o que está aqui só muda com o "pode" do dono.
 *
 * Quando o CRM ganhar estes campos (ficha do anúncio), este arquivo encolhe.
 */

export interface LoteDaFicha {
  codigo?: string;
  area_terreno?: number | null;
  area_aproximada?: boolean;
  preco?: number | null;
}

export interface FichaCurada {
  codigo_crm: string;
  regiao: string;
  tipo: string;
  finalidade: string;
  comparar: boolean;
  disponivel: boolean;
  atributos: Record<string, unknown>;
  area_ambigua?: number;
  area_terreno?: number;
  lotes?: LoteDaFicha[];
  venda_conjunto?: { permitida: boolean | null; preco?: number | null; origem?: string };
}

export const FICHAS_DO_CADERNO: Record<string, FichaCurada> = {
  TE0006: {
    codigo_crm: 'TE0006',
    regiao: 'natal-cidade-jardim',
    tipo: 'terreno',
    finalidade: 'venda',
    comparar: true,
    disponivel: true,
    atributos: { esquina: true, escritura_publica: true, vende_parte: false },
  },
  TE0001: {
    codigo_crm: 'TE0001_IMOVA',
    regiao: 'natal-capim-macio',
    tipo: 'terreno',
    finalidade: 'venda',
    comparar: true,
    disponivel: true,
    atributos: {},
    lotes: [
      { codigo: 'TE0001-L1', area_terreno: 1000, preco: null },
      { codigo: 'TE0001-L2', area_terreno: 1000, preco: null },
      { codigo: 'TE0001-L3', area_terreno: 1000, preco: null },
    ],
    venda_conjunto: {
      permitida: true,
      preco: 5500000,
      origem: 'anúncio (R$ 5.500.000 pelos 3.000 m²)',
    },
    area_terreno: 3000,
  },
  CA0001: {
    codigo_crm: 'IM0001',
    regiao: 'natal-ponta-negra',
    tipo: 'casa',
    finalidade: 'venda',
    comparar: true,
    disponivel: true,
    atributos: { comercial: true },
    area_ambigua: 450,
  },
  AP0001: {
    codigo_crm: 'Edifício Simone',
    regiao: 'natal-lagoa-nova',
    tipo: 'apartamento',
    finalidade: 'venda',
    comparar: true,
    disponivel: true,
    atributos: {
      quartos: 2,
      vagas: 1,
      condominio_fechado: true,
      valor_condominio: 310,
      iptu_ano: 1050,
      area_total: 86,
    },
  },
  CA0002: {
    codigo_crm: 'SANTA CATARINA',
    regiao: 'natal-potengi',
    tipo: 'casa',
    finalidade: 'venda',
    comparar: true,
    disponivel: true,
    atributos: { quartos: 3, suites: 1, banheiros: 2, vagas: 1, iptu_ano: 980 },
  },
  TE0002: {
    codigo_crm: 'TE0002_IMOVA',
    regiao: 'parnamirim-bonor',
    tipo: 'terreno',
    finalidade: 'venda',
    comparar: true,
    disponivel: true,
    atributos: { esquina: true, frente_avenida: true, comercial: true },
  },
  TE0003: {
    codigo_crm: 'TE0003_IMOVA',
    regiao: 'parnamirim-bonor',
    tipo: 'terreno',
    finalidade: 'venda',
    comparar: true,
    disponivel: true,
    atributos: { esquina: null, comercial: true },
  },
  TE0005: {
    codigo_crm: 'TE0005_IMOVA',
    regiao: 'tibau-do-sul-pipa',
    tipo: 'terreno',
    finalidade: 'venda',
    comparar: true,
    disponivel: true,
    atributos: { ocupacao_max_pct: 10, m2_escrito: 250 },
    lotes: [
      { codigo: 'TE0005-L1', area_terreno: 2550, area_aproximada: true, preco: 635000 },
      { codigo: 'TE0005-L2', area_terreno: 2550, area_aproximada: true, preco: 635000 },
      { codigo: 'TE0005-L3', area_terreno: 2550, area_aproximada: true, preco: 635000 },
      { codigo: 'TE0005-L4', area_terreno: 2550, area_aproximada: true, preco: 635000 },
    ],
    venda_conjunto: {
      permitida: null,
      preco: 2540000,
      origem:
        'dedução: 4 × R$ 635.000, só se o proprietário aceitar vender os 4 juntos (ninguém perguntou ainda)',
    },
    area_terreno: 10155,
  },
  TE0004: {
    codigo_crm: 'TE0004_IMOVA',
    regiao: 'nisia-floresta-tabatinga',
    tipo: 'terreno',
    finalidade: 'venda',
    comparar: true,
    disponivel: true,
    atributos: {
      frente_mar: true,
      vista_mar: true,
      escritura_publica: true,
      largura_m: 12,
      comprimento_m: 68,
    },
  },
  CA0003: {
    codigo_crm: 'Casa extremox',
    regiao: 'extremoz',
    tipo: 'casa',
    finalidade: 'venda',
    comparar: true,
    disponivel: true,
    atributos: { quartos: 2, suites: 1, vagas: 3 },
  },
  PT0001: {
    codigo_crm: 'PT0001_IMOVA',
    regiao: 'natal-ponta-negra',
    tipo: 'ponto',
    finalidade: 'repasse',
    comparar: false,
    disponivel: true,
    atributos: { comercial: true, casa_anexa: true },
  },
  SA0012: {
    codigo_crm: 'SA0012_IMOVA',
    regiao: 'natal-ponta-negra',
    tipo: 'sala',
    finalidade: 'aluguel',
    comparar: false,
    disponivel: true,
    atributos: { comercial: true, banheiro: true, condominio_a_parte: true },
  },
  LO0001: {
    codigo_crm: 'Brisa Mall - Loja 02',
    regiao: 'natal-ponta-negra',
    tipo: 'loja',
    finalidade: 'aluguel',
    comparar: false,
    disponivel: false,
    atributos: { comercial: true, valor_condominio: 350 },
  },
};
