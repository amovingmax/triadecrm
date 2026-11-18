import { describe, expect, it, vi } from 'vitest';

import type { LinhaDoCanalPro } from './aba-dos-anuncios';
import {
  type AnuncioDoCanalPro,
  COLETOR,
  conferir,
  contatosNoCanalPro,
  favoritoDeSincronizar,
  fotosDoCanalPro,
  fotosQueVem,
  lerPacote,
  type PacoteDoCanalPro,
  paraORelatorio,
  pareceComNoCrm,
} from './sincronizar-canal-pro';
import type { AnuncioNaLista } from './tipos';

/** Um anúncio como o Canal Pro devolve na consulta `listings`. */
function doCanalPro(p: Partial<AnuncioDoCanalPro>): AnuncioDoCanalPro {
  return {
    externalId: 'TE0001_IMOVA',
    id: '2735410023',
    title: 'Terreno à venda com 3.000 m² em Capim Macio - Natal/RN',
    description: 'Área à venda em Capim Macio.',
    status: 'ACTIVE',
    publicationType: 'PREMIUM',
    unitTypes: ['ALLOTMENT_LAND'],
    usableAreas: [3000],
    totalAreas: [3000],
    bedrooms: [],
    bathrooms: [],
    suites: [],
    parkingSpaces: [],
    createdAt: '2025-06-02T13:00:00Z',
    address: {
      city: 'Natal',
      neighborhood: 'Capim Macio',
      street: 'Rua Missionário Joel Carlson',
      streetNumber: '',
      zipCode: '59082130',
      state: 'RN',
    },
    pricingInfos: [
      { price: '5500000', businessType: 'SALE', monthlyCondoFee: null, yearlyIptu: '0' },
    ],
    leads: {
      views: 97,
      phoneView: 2,
      clickWhatsapp: 1,
      contactForm: 1,
      clickProposal: 0,
      clickSchedule: 0,
    },
    images: [
      {
        imageUrl:
          'https://resizedimgs.zapimoveis.com.br/{action}/{width}x{height}/named.images.sp/abc/foto.jpg',
        resizedUrl:
          'https://resizedimgs.zapimoveis.com.br/fit-in/870x707/named.images.sp/abc/foto.jpg',
      },
      { imageUrl: 'https://imgs.example/2.jpg' },
    ],
    ...p,
  };
}

function anuncio(
  p: Partial<AnuncioNaLista> & Pick<AnuncioNaLista, 'id' | 'codigo'>,
): AnuncioNaLista {
  return {
    situacao: 'rascunho',
    titulo: '',
    tipo: 'terreno',
    negocio: 'venda',
    preco_venda: null,
    preco_aluguel: null,
    periodo_aluguel: 'mensal',
    area_util: null,
    area_total: null,
    quartos: null,
    bairro: null,
    cidade: 'Natal',
    destaque: 'padrao',
    updated_at: '2026-11-06T18:00:00Z',
    publicado_em: null,
    excluido_em: null,
    motivo_exclusao: null,
    fotos: 0,
    capa: null,
    pendencias: [],
    proprietario_nome: null,
    criado_por_nome: null,
    codigo_no_canal_pro: null,
    leads: 0,
    criado_em: '2026-11-06T18:00:00Z',
    suites: null,
    banheiros: null,
    vagas: null,
    condominio: null,
    iptu: null,
    cep: null,
    estado: 'RN',
    endereco: null,
    numero: null,
    mostrar_endereco: 'rua',
    video_youtube: null,
    descricao_tamanho: 0,
    caracteristicas_qtd: 0,
    origem: 'crm',
    importado_em: null,
    ultima_leitura_do_portal: null,
    no_canal_pro_situacao: null,
    no_canal_pro_visto_em: null,
    no_canal_pro_visualizacoes: null,
    no_canal_pro_contatos: null,
    no_canal_pro_criado_em: null,
    no_sistema_atual: null,
    sistema_atual_em: null,
    ...p,
  };
}

const pacote = (
  anuncios: AnuncioDoCanalPro[],
  total: number | null = anuncios.length,
): PacoteDoCanalPro => ({
  versao: 3,
  de: 'https://canalpro.grupozap.com',
  em: '2026-11-18T15:00:00Z',
  total,
  anuncios,
});

describe('lerPacote', () => {
  it('lê o pacote do fragmento', () => {
    const p = {
      v: 3,
      de: 'https://canalpro.grupozap.com',
      em: 'x',
      total: 1,
      anuncios: [{ externalId: 'A' }],
    };
    const r = lerPacote(`#d=${encodeURIComponent(JSON.stringify(p))}`);
    expect(r?.anuncios).toHaveLength(1);
    expect(r?.total).toBe(1);
  });
  it('recusa o que não é um pacote do favorito', () => {
    expect(lerPacote('')).toBeNull();
    expect(lerPacote('#d=nao-e-json')).toBeNull();
    expect(
      lerPacote(`#d=${encodeURIComponent(JSON.stringify({ v: 2, anuncios: [] }))}`),
    ).toBeNull();
    expect(lerPacote(`#outra=1`)).toBeNull();
  });
});

describe('paraORelatorio', () => {
  it('monta a linha no formato da planilha do Canal Pro', () => {
    const r = paraORelatorio(doCanalPro({}))!;
    expect(r).toMatchObject({
      codigo: 'TE0001_IMOVA',
      tipo: 'Lote/Terreno',
      tipo_crm: 'terreno',
      negocio: 'venda',
      preco_venda: 5_500_000,
      preco_aluguel: null,
      bairro: 'Capim Macio',
      cidade: 'Natal',
      area: 3000,
      destaque: 'Destaque',
      situacao: 'Ativo',
      link: 'https://www.zapimoveis.com.br/imovel/imovel-id-2735410023',
    });
    expect(r.linha).toMatchObject({
      'Número de fotos': '2',
      'Total de visualizações': '97',
      'Total de contatos': '4',
      Criação: '02-06-2025',
      CEP: '59082130',
      Descrição: 'Área à venda em Capim Macio.',
    });
  });
  it('inativo vira "Inativo", sem link; aluguel vira aluguel', () => {
    const r = paraORelatorio(
      doCanalPro({
        externalId: 'Brisa Mall - Loja 02',
        status: 'INACTIVE',
        unitTypes: ['BUSINESS'],
        pricingInfos: [{ price: 3800, businessType: 'RENTAL' }],
      }),
    )!;
    expect(r).toMatchObject({
      situacao: 'Inativo',
      link: null,
      negocio: 'aluguel',
      preco_aluguel: 3800,
      tipo_crm: 'loja',
    });
  });
  it('apagado no Canal Pro, ou sem código, não entra', () => {
    expect(paraORelatorio(doCanalPro({ status: 'DELETED' }))).toBeNull();
    expect(paraORelatorio(doCanalPro({ externalId: null, id: null }))).toBeNull();
  });
  it('sem código próprio, usa o id do Canal Pro', () => {
    expect(paraORelatorio(doCanalPro({ externalId: '  ' }))?.codigo).toBe('2735410023');
  });
  it('os contatos somam todos os meios e ignoram as visualizações', () => {
    expect(contatosNoCanalPro(doCanalPro({}))).toBe(4);
    expect(contatosNoCanalPro(doCanalPro({ leads: null }))).toBeNull();
  });
});

describe('fotosDoCanalPro', () => {
  it('preenche os moldes com a versão grande primeiro e não repete', () => {
    const f = fotosDoCanalPro(doCanalPro({}));
    expect(f).toHaveLength(2);
    expect(f[0]![0]).toBe(
      'https://resizedimgs.zapimoveis.com.br/fit-in/1920x1080/named.images.sp/abc/foto.jpg',
    );
    expect(f[0]).toContain(
      'https://resizedimgs.zapimoveis.com.br/fit-in/870x707/named.images.sp/abc/foto.jpg',
    );
    expect(new Set(f[0]).size).toBe(f[0]!.length);
    expect(f[1]).toEqual(['https://imgs.example/2.jpg']);
  });
  it('fica no teto de fotos do CRM', () => {
    const muitas = Array.from({ length: 70 }, (_, i) => ({
      imageUrl: `https://x.example/${i}.jpg`,
    }));
    expect(fotosDoCanalPro(doCanalPro({ images: muitas }))).toHaveLength(60);
  });
});

describe('conferir', () => {
  const TE0001 = anuncio({
    id: 'te1',
    codigo: 'TE0001_IMOVA',
    area_total: 3000,
    area_util: 3000,
    bairro: 'Capim Macio',
    fotos: 12,
  });
  const SA0012 = anuncio({
    id: 'sa12',
    codigo: 'SA0012_IMOVA',
    tipo: 'sala_comercial',
    area_total: 19,
    bairro: 'Ponta Negra',
    fotos: 7,
  });
  const SIMONE = anuncio({
    id: 'simone',
    codigo: 'Edifício Simone',
    tipo: 'apartamento',
    area_util: 57,
    bairro: 'Lagoa Nova',
    fotos: 0,
  });
  const VELHO = anuncio({
    id: 'velho',
    codigo: 'VELHO',
    excluido_em: '2026-11-10T00:00:00Z',
    fotos: 0,
  });
  const fotos = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ imageUrl: `https://x.example/${i}.jpg` }));
  const linhas: Pick<LinhaDoCanalPro, 'codigo' | 'anuncio_id'>[] = [
    { codigo: 'TE0001_IMOVA', anuncio_id: null },
    { codigo: 'Edifício Simone', anuncio_id: 'simone' },
    { codigo: 'Sumiu do Canal Pro', anuncio_id: null },
  ];
  const c = conferir(
    pacote([
      doCanalPro({ images: fotos(12) }),
      doCanalPro({ externalId: 'TE0001_IMOVA' }), // repetido no pacote: conta uma vez
      doCanalPro({
        externalId: 'SA0012_IMOVA',
        unitTypes: ['OFFICE'],
        usableAreas: [19],
        totalAreas: [19],
        address: { city: 'Natal', neighborhood: 'Ponta Negra' },
        images: fotos(8),
      }),
      doCanalPro({
        externalId: 'Edifício Simone',
        status: 'INACTIVE',
        unitTypes: ['APARTMENT'],
        usableAreas: [57],
        totalAreas: [86],
        address: { city: 'Natal', neighborhood: 'Lagoa Nova' },
        images: fotos(47),
      }),
      doCanalPro({ externalId: 'Terreno Capim Macio', status: 'INACTIVE', images: fotos(12) }),
      doCanalPro({
        externalId: 'Casa nova',
        unitTypes: ['HOME'],
        usableAreas: [120],
        totalAreas: [200],
        address: { city: 'Parnamirim', neighborhood: 'Centro' },
        images: fotos(5),
      }),
      doCanalPro({ externalId: 'VELHO', images: fotos(3) }),
      doCanalPro({ externalId: 'APAGADO', status: 'DELETED' }),
    ]),
    [TE0001, SA0012, SIMONE, VELHO],
    linhas,
  );

  it('conta cada código uma vez e deixa os apagados de fora', () => {
    expect(c.vieram).toBe(6);
    expect(c.linhas.map((l) => l.codigo)).toEqual([
      'TE0001_IMOVA',
      'SA0012_IMOVA',
      'Edifício Simone',
      'Terreno Capim Macio',
      'Casa nova',
      'VELHO',
    ]);
  });
  it('o mesmo código casa (inclusive o ligado pelo "trazer")', () => {
    expect(c.casam.map((x) => x.anuncioId)).toEqual(['te1', 'sa12', 'simone']);
  });
  it('o TE0001 de outro código é cópia antiga: não entra', () => {
    expect(c.copias).toEqual([
      {
        codigo: 'Terreno Capim Macio',
        situacao: 'Inativo',
        anuncioId: 'te1',
        codigoNoCrm: 'TE0001_IMOVA',
      },
    ]);
  });
  it('só é novo o que não casa nem é cópia; o excluído no CRM não volta', () => {
    expect(c.novos.map((n) => n.codigo)).toEqual(['Casa nova']);
  });
  it('as fotos vêm para quem tem menos: todas no vazio, troca no que tem algumas', () => {
    expect(c.fotos.map((f) => [f.codigo, f.modo, f.tem, f.vem])).toEqual([
      ['SA0012_IMOVA', 'trocar', 7, 8],
      ['Edifício Simone', 'se_vazio', 0, 47],
      ['Casa nova', 'se_vazio', 0, 5],
    ]);
    expect(c.fotos.find((f) => f.codigo === 'Casa nova')?.anuncioId).toBeNull();
    expect(fotosQueVem(c)).toBe(1 + 47 + 5);
  });
  it('diz o que estava na última lista e não veio', () => {
    expect(c.sairam).toEqual(['Sumiu do Canal Pro']);
  });
});

describe('pareceComNoCrm', () => {
  it('mesma regra do banco: cidade, área igual e bairro quando os dois dizem', () => {
    const a = [
      anuncio({ id: 'te1', codigo: 'TE0001_IMOVA', area_total: 3000, bairro: 'Capim Macio' }),
    ];
    const r = { codigo: 'Terreno Capim Macio', cidade: 'natal', bairro: 'capim macio', area: 3000 };
    expect(pareceComNoCrm(r, a)).toBe('te1');
    expect(pareceComNoCrm({ ...r, area: 3001 }, a)).toBeNull();
    expect(pareceComNoCrm({ ...r, bairro: null }, a)).toBe('te1');
    expect(pareceComNoCrm({ ...r, codigo: 'TE0001_IMOVA' }, a)).toBeNull();
  });
});

describe('o favorito', () => {
  it('é um endereço javascript: com o endereço do CRM', () => {
    const f = favoritoDeSincronizar('https://imova-crm.vercel.app/');
    expect(f.startsWith('javascript:')).toBe(true);
    expect(decodeURIComponent(f.slice('javascript:'.length))).toContain(
      '"https://imova-crm.vercel.app"',
    );
  });

  /** Roda o coletor numa página falsa do Canal Pro. */
  function rodar(opcoes: { host?: string; token?: string | null; paginas?: unknown[] }) {
    const respostas = [...(opcoes.paginas ?? [])];
    const pedidos: { url: string; init: RequestInit }[] = [];
    const janela = {
      document: { write: vi.fn() },
      location: { href: '' },
      closed: false,
      close: vi.fn(),
    };
    const loja = {
      getters: {
        'account/token': () =>
          opcoes.token === null
            ? {}
            : {
                token: opcoes.token ?? 'tk',
                publisherId: 'p1',
                odinId: 'o1',
                contractId: '',
                publisherContractType: 'PRO',
              },
        'account/selectedPublisher': { contract: 'c9' },
      },
    };
    const app = { __vue__: { $root: { $store: loja } } };
    const d = { getElementById: () => app, querySelectorAll: () => [] };
    const l = {
      hostname: opcoes.host ?? 'canalpro.grupozap.com',
      origin: 'https://canalpro.grupozap.com',
      href: '',
    };
    const alertas: string[] = [];
    const j = {
      alert: (t: string) => alertas.push(t),
      open: vi.fn(() => janela),
      fetch: vi.fn((url: string, init: RequestInit) => {
        pedidos.push({ url, init });
        return Promise.resolve({ json: () => Promise.resolve(respostas.shift()) });
      }),
    };
    const fn = new Function(`return (${COLETOR})`)() as (...a: unknown[]) => void;
    fn(d, l, j, 'https://imova-crm.vercel.app');
    return { pedidos, janela, alertas, j, l };
  }
  const espera = () => new Promise((r) => setTimeout(r, 0));

  it('pede todas as páginas com a sessão do Canal Pro e abre o CRM com o pacote', async () => {
    const r = rodar({
      paginas: [
        {
          data: {
            listings: {
              listListing: [{ externalId: 'A' }],
              pageNumber: 1,
              totalPages: 2,
              totalResults: 2,
            },
          },
        },
        {
          data: {
            listings: {
              listListing: [{ externalId: 'B' }],
              pageNumber: 2,
              totalPages: 2,
              totalResults: 2,
            },
          },
        },
      ],
    });
    await espera();
    await espera();
    await espera();
    expect(r.pedidos).toHaveLength(2);
    expect(r.pedidos[0]!.url).toBe('https://gandalf-api.grupozap.com/');
    const cab = r.pedidos[0]!.init.headers as Record<string, string>;
    expect(cab).toMatchObject({
      Authorization: 'tk',
      'X-PublisherId': 'p1',
      'X-OdinID': 'o1',
      'X-Company': 'c9',
      'X-ClientID': 'CANALPRO_WEB',
    });
    expect(cab).not.toHaveProperty('X-ContractID');
    const corpo = JSON.parse(String(r.pedidos[1]!.init.body)) as {
      variables: { pageNumber: number };
      query: string;
    };
    expect(corpo.variables.pageNumber).toBe(2);
    expect(corpo.query).toContain('images { imageId imageUrl resizedUrl newResizedUrl }');
    expect(
      r.janela.location.href.startsWith('https://imova-crm.vercel.app/anuncios/sincronizar#d='),
    ).toBe(true);
    const p = lerPacote(r.janela.location.href.slice(r.janela.location.href.indexOf('#')));
    expect(p?.anuncios.map((a) => a.externalId)).toEqual(['A', 'B']);
    expect(p?.total).toBe(2);
  });

  it('sem título no esquema, tenta de novo sem ele', async () => {
    const r = rodar({
      paginas: [
        { errors: [{ message: 'Cannot query field "title"' }] },
        {
          data: {
            listings: { listListing: [{ externalId: 'A' }], totalPages: 1, totalResults: 1 },
          },
        },
      ],
    });
    await espera();
    await espera();
    await espera();
    expect(String(r.pedidos[0]!.init.body)).toContain('title description');
    expect(String(r.pedidos[1]!.init.body)).not.toContain('title description');
    expect(r.janela.location.href).toContain('/anuncios/sincronizar#d=');
  });

  it('fora do Canal Pro, ou sem login, só avisa', () => {
    expect(rodar({ host: 'www.google.com' }).alertas[0]).toMatch(/abra o Canal Pro/);
    const semLogin = rodar({ token: null });
    expect(semLogin.alertas[0]).toMatch(/não está logada/);
    expect(semLogin.j.open).not.toHaveBeenCalled();
  });

  it('quando o Canal Pro recusa, fecha a aba e avisa', async () => {
    const r = rodar({
      paginas: [
        { errors: [{ message: 'Unauthorized' }] },
        { errors: [{ message: 'Unauthorized' }] },
      ],
    });
    await espera();
    await espera();
    await espera();
    expect(r.janela.close).toHaveBeenCalled();
    expect(r.alertas[0]).toMatch(/não entregou a lista \(Unauthorized\)/);
  });
});
