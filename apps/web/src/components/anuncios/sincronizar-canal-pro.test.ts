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
    expect(r?.versao).toBe(3);
  });
  it('lê a versão 4, do Canal Pro novo, com o jeito do login e as falhas', () => {
    const p = {
      v: 4,
      de: 'https://canal-pro.grupozap.com',
      em: 'x',
      total: null,
      como: 'react',
      falhas: ['Internal server error', 7],
      anuncios: [{ externalId: 'A' }],
    };
    const r = lerPacote(`#d=${encodeURIComponent(JSON.stringify(p))}`);
    expect(r).toMatchObject({ versao: 4, como: 'react', total: null });
    expect(r?.falhas).toEqual(['Internal server error']);
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
  it('o "pronto para publicar" do Canal Pro novo ganha nome', () => {
    expect(paraORelatorio(doCanalPro({ status: 'READY_TO_PUBLISH' }))?.situacao).toBe(
      'Pronto para publicar',
    );
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
  it('no Canal Pro novo, o molde {extension} vira jpg', () => {
    const f = fotosDoCanalPro(
      doCanalPro({
        images: [
          {
            imageUrl: 'https://resizedimgs.zapimoveis.com.br/img/vr-listing/abc/foto.webp',
            newResizedUrl:
              'https://resizedimgs.zapimoveis.com.br/{action}/{width}x{height}/vr.images.sp/abc.{extension}',
          },
        ],
      }),
    );
    expect(f).toEqual([
      [
        'https://resizedimgs.zapimoveis.com.br/img/vr-listing/abc/foto.webp',
        'https://resizedimgs.zapimoveis.com.br/fit-in/1920x1080/vr.images.sp/abc.jpg',
        'https://resizedimgs.zapimoveis.com.br/fit-in/870x707/vr.images.sp/abc.jpg',
      ],
    ]);
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

describe('conferir: o que a revisão de 18/11 pediu', () => {
  const fotos = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ imageUrl: `https://x.example/${i}.jpg` }));
  const base = anuncio({ id: 'a', codigo: 'A1', area_util: 100, fotos: 30 });

  it('a lista só é inteira com o total e com códigos bastantes', () => {
    const um = [doCanalPro({ externalId: 'A1' })];
    expect(conferir(pacote(um, 1), [], []).inteira).toBe(true);
    expect(conferir(pacote(um, null), [], []).inteira).toBe(false);
    expect(conferir(pacote(um, 2), [], []).inteira).toBe(false);
    // O apagado conta como código que veio (o total do Canal Pro pode incluí-lo).
    const comApagado = [
      doCanalPro({ externalId: 'A1' }),
      doCanalPro({ externalId: 'X', status: 'DELETED' }),
    ];
    expect(conferir(pacote(comApagado, 2), [], []).inteira).toBe(true);
  });

  it('não propõe troca quando as duas somam mais de 60 fotos', () => {
    const c = conferir(pacote([doCanalPro({ externalId: 'A1', images: fotos(40) })]), [base], []);
    expect(c.fotos).toEqual([]);
    expect(c.semTroca).toEqual([{ codigo: 'A1', tem: 30, vem: 40 }]);
  });

  it('não mexe nas fotos do anúncio que o CRM já publica pelo arquivo', () => {
    const publicado = {
      ...base,
      fotos: 3,
      situacao: 'no_ar' as const,
      ultima_leitura_do_portal: '2026-11-19T03:07:00Z',
    };
    const c = conferir(
      pacote([doCanalPro({ externalId: 'A1', images: fotos(8) })]),
      [publicado],
      [],
    );
    expect(c.fotos).toEqual([]);
    expect(c.semTroca).toEqual([]);
  });

  it('dois novos do mesmo imóvel: entra o ativo, o outro é cópia dele', () => {
    const c = conferir(
      pacote([
        doCanalPro({
          externalId: 'Velho',
          status: 'INACTIVE',
          usableAreas: [250],
          totalAreas: [250],
          address: { city: 'Natal', neighborhood: 'Tirol' },
        }),
        doCanalPro({
          externalId: 'Novo',
          status: 'ACTIVE',
          usableAreas: [250],
          totalAreas: [250],
          address: { city: 'Natal', neighborhood: 'Tirol' },
        }),
      ]),
      [],
      [],
    );
    expect(c.novos.map((n) => n.codigo)).toEqual(['Novo']);
    expect(c.copias).toEqual([
      { codigo: 'Velho', situacao: 'Inativo', anuncioId: null, codigoNoCrm: 'Novo' },
    ]);
  });

  it('área em texto ou com casas decimais vira inteiro', () => {
    const r = paraORelatorio(doCanalPro({ usableAreas: ['57.4'], totalAreas: [86] }))!;
    expect(r.area).toBe(57);
    expect(r.linha['Área útil']).toBe('57');
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

  type Resposta = unknown | { status: number; corpo?: unknown };
  /**
   * Roda o coletor numa página falsa do Canal Pro. `site` escolhe o site: 'react'
   * (canal-pro.grupozap.com, loja Redux na árvore do React), 'cookies' (só os
   * cookies do site novo), 'vue' (canalpro.grupozap.com) ou 'nada' (sem login).
   * `responder` recebe o corpo de cada pedido e devolve a resposta da API.
   */
  function rodar(opcoes: {
    host?: string;
    site?: 'react' | 'cookies' | 'vue' | 'nada';
    j?: Record<string, unknown>;
    /** A página ainda sem o site (nem `#root` nem `#app`). */
    semRaiz?: boolean;
    responder?: (corpo: { query: string; variables: Record<string, unknown> }) => Resposta;
  }) {
    const site = opcoes.site ?? 'react';
    const pedidos: { url: string; init: RequestInit }[] = [];
    const janela = {
      document: { write: vi.fn() },
      location: { href: '' },
      closed: false,
      close: vi.fn(),
    };
    const auth = {
      gandalf_token: 'tk-loja',
      publisher_id: '81234',
      odin_id: 'odin-1',
      contract_id: 'ct-1',
      currentPublisher: { publisherContractType: 'REAL_ESTATE' },
      currentContract: { contractCompany: 'ZAP_OLX' },
    };
    const outraLoja = { getState: () => ({ auth: { gandalf_token: null } }) };
    const loja = { getState: () => ({ auth }) };
    // A árvore do React: a raiz, um provedor sem login e, mais fundo, o com login.
    const fibra = {
      memoizedProps: null,
      child: {
        memoizedProps: { store: outraLoja },
        sibling: { memoizedProps: { children: [] }, child: { memoizedProps: { store: loja } } },
      },
    };
    const raiz = site === 'react' ? { __reactContainer$abc123: fibra } : {};
    const app =
      site === 'vue'
        ? {
            __vue__: {
              $root: {
                $store: {
                  getters: {
                    'account/token': () => ({
                      token: 'tk-vue',
                      publisherId: 'p1',
                      odinId: 'o1',
                      contractId: '',
                      publisherContractType: 'PRO',
                    }),
                    'account/selectedPublisher': { contract: 'c9' },
                  },
                },
              },
            },
          }
        : null;
    const cookie =
      site === 'react' || site === 'cookies'
        ? 'auid=x; bb-authenticationToken=tk%20cookie; publisher_id=81234; odin_id=odin-1; contract_id=ct-1'
        : 'auid=x';
    const d = {
      cookie,
      getElementById: (id: string) =>
        opcoes.semRaiz
          ? null
          : id === 'root' && site !== 'vue'
            ? raiz
            : id === 'app' && site === 'vue'
              ? app
              : null,
      querySelectorAll: () => [],
    };
    const host =
      opcoes.host ?? (site === 'vue' ? 'canalpro.grupozap.com' : 'canal-pro.grupozap.com');
    const l = { hostname: host, origin: `https://${host}`, href: '' };
    const alertas: string[] = [];
    const responder =
      opcoes.responder ??
      (() => ({ data: { listings: { listListing: [], totalPages: 1, totalResults: 0 } } }));
    const j: Record<string, unknown> = {
      alert: (t: string) => alertas.push(t),
      open: vi.fn(() => janela),
      localStorage: { getItem: () => null },
      sessionStorage: { getItem: () => null },
      fetch: vi.fn((url: string, init: RequestInit) => {
        pedidos.push({ url, init });
        const r = responder(
          JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> },
        ) as { status?: number; corpo?: unknown };
        const status = typeof r?.status === 'number' ? r.status : 200;
        const corpo = typeof r?.status === 'number' ? r.corpo : r;
        return Promise.resolve({ status, json: () => Promise.resolve(corpo) });
      }),
      ...opcoes.j,
    };
    const fn = new Function(`return (${COLETOR})`)() as (...a: unknown[]) => void;
    fn(d, l, j, 'https://imova-crm.vercel.app');
    const corpos = () =>
      pedidos.map(
        (p) =>
          JSON.parse(String(p.init.body)) as { query: string; variables: Record<string, unknown> },
      );
    return { pedidos, corpos, janela, alertas, j, l };
  }
  const espera = async (vezes = 30) => {
    for (let i = 0; i < vezes; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const pacoteDa = (r: { janela: { location: { href: string } } }) =>
    lerPacote(r.janela.location.href.slice(r.janela.location.href.indexOf('#')));
  /** Uma API que tem A (ativo, 2 páginas com B), C (pronto para publicar) e D (bloqueado). */
  const apiComQuatro = (c: { query: string; variables: Record<string, unknown> }) => {
    const sit = (c.variables.listingStatus as string[] | undefined)?.[0];
    const n = c.variables.pageNumber as number;
    const pag = (itens: unknown[], totalPages: number, totalResults: number) => ({
      data: { listings: { listListing: itens, pageNumber: n, totalPages, totalResults } },
    });
    if (sit === 'ACTIVE')
      return pag(n === 1 ? [{ id: '1', externalId: 'A' }] : [{ id: '2', externalId: 'B' }], 2, 2);
    if (sit === 'READY_TO_PUBLISH') return pag([{ id: '3', externalId: 'C' }], 1, 1);
    if (sit === 'BLOCKED') return pag([{ id: '4', externalId: 'D' }], 1, 1);
    if (sit === 'PENDING')
      return {
        errors: [{ message: 'Value "PENDING" does not exist in "ListingStatusEnumType" enum.' }],
      };
    if (!sit) return pag([{ id: '1', externalId: 'A' }], 1, 1);
    return pag([], 0, 0);
  };

  it('no Canal Pro novo (React), acha o login na loja e manda os cabeçalhos do site', async () => {
    const r = rodar({ responder: apiComQuatro });
    await espera();
    expect(r.alertas).toEqual([]);
    expect(r.pedidos[0]!.url).toBe('https://gandalf-api.grupozap.com/');
    const cab = r.pedidos[0]!.init.headers as Record<string, string>;
    expect(cab).toEqual({
      authorization: 'tk cookie',
      'x-publisherid': '81234',
      'x-odinid': 'odin-1',
      'x-contractid': 'ct-1',
      'x-publishercontracttype': 'REAL_ESTATE',
      'x-company': 'ZAP_OLX',
      'x-clientid': 'CANALPRO_WEB',
      'content-type': 'application/json',
    });
    expect(r.corpos()[0]!.query).toContain('images { imageId imageUrl resizedUrl newResizedUrl }');
    expect(r.corpos()[0]!.query).toContain('title description');
    expect(
      r.janela.location.href.startsWith('https://imova-crm.vercel.app/anuncios/sincronizar#d='),
    ).toBe(true);
    const p = pacoteDa(r);
    expect(p?.versao).toBe(4);
    expect(p?.como).toBe('react');
    expect(p?.anuncios.map((a) => a.externalId)).toEqual(['A', 'B', 'C', 'D']);
    // 2 ativos + 1 pronto para publicar + 1 bloqueado; o PENDING desconhecido não conta.
    expect(p?.total).toBe(4);
    expect(p?.falhas).toEqual([]);
  });

  it('pede cada situação à parte, com o "pronto para publicar", e por último sem filtro', async () => {
    const r = rodar({ responder: apiComQuatro });
    await espera();
    const pedidas = r
      .corpos()
      .filter((c) => c.variables.pageNumber === 1 && c.query.includes('title'))
      .map((c) => (c.variables.listingStatus as string[] | undefined)?.[0] ?? 'sem filtro');
    expect(pedidas).toEqual([
      'ACTIVE',
      'INACTIVE',
      'READY_TO_PUBLISH',
      'DRAFT',
      'BLOCKED',
      'PENDING',
      'sem filtro',
    ]);
    const semFiltro = r.corpos().at(-1)!;
    expect(semFiltro.query).not.toContain('listingStatus');
    expect(semFiltro.variables.listingStatus).toBeUndefined();
    // A segunda página dos ativos foi pedida.
    expect(
      r
        .corpos()
        .some(
          (c) =>
            (c.variables.listingStatus as string[])?.[0] === 'ACTIVE' &&
            c.variables.pageNumber === 2,
        ),
    ).toBe(true);
  });

  it('só com os cookies do site novo também funciona', async () => {
    const r = rodar({ site: 'cookies', responder: apiComQuatro });
    await espera();
    const cab = r.pedidos[0]!.init.headers as Record<string, string>;
    expect(cab.authorization).toBe('tk cookie');
    expect(cab['x-publisherid']).toBe('81234');
    expect(cab['x-odinid']).toBe('odin-1');
    expect(cab).not.toHaveProperty('x-company');
    expect(pacoteDa(r)?.como).toBe('cookies');
  });

  it('no endereço antigo (Vue), usa a loja do Vue', async () => {
    const r = rodar({ site: 'vue', responder: apiComQuatro });
    await espera();
    const cab = r.pedidos[0]!.init.headers as Record<string, string>;
    expect(cab).toMatchObject({
      authorization: 'tk-vue',
      'x-publisherid': 'p1',
      'x-odinid': 'o1',
      'x-company': 'c9',
      'x-clientid': 'CANALPRO_WEB',
    });
    expect(cab).not.toHaveProperty('x-contractid');
    expect(pacoteDa(r)?.como).toBe('vue');
  });

  it('se o Canal Pro recusar o título, pede de novo sem ele e segue sem ele', async () => {
    const r = rodar({
      responder: (c) =>
        c.query.includes('title')
          ? { errors: [{ message: 'Cannot query field "title" on type "Listing"' }] }
          : apiComQuatro(c),
    });
    await espera();
    const corpos = r.corpos();
    expect(corpos[0]!.query).toContain('title description');
    expect(corpos[1]!.query).not.toContain('title description');
    // Depois de descobrir, as outras situações já vão sem o título.
    expect(corpos.filter((c) => c.query.includes('title'))).toHaveLength(1);
    expect(pacoteDa(r)?.anuncios.map((a) => a.externalId)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('uma situação que falha de verdade deixa a lista sem total (o CRM trava o Aplicar)', async () => {
    const r = rodar({
      responder: (c) =>
        (c.variables.listingStatus as string[] | undefined)?.[0] === 'INACTIVE'
          ? { errors: [{ message: 'Internal server error' }] }
          : apiComQuatro(c),
    });
    await espera();
    const p = pacoteDa(r);
    expect(p?.total).toBeNull();
    expect(p?.falhas).toEqual(['Internal server error']);
    expect(p?.anuncios).toHaveLength(4);
  });

  it('a API recusando o login (401) fecha a aba e diz que foi a API', async () => {
    const r = rodar({ responder: () => ({ status: 401, corpo: { message: 'Unauthorized' } }) });
    await espera();
    expect(r.pedidos).toHaveLength(1);
    expect(r.janela.close).toHaveBeenCalled();
    expect(r.alertas[0]).toMatch(/a API do Canal Pro recusou o pedido \(código 401\)/);
  });

  it('a API recusando pelo GraphQL (UNAUTHENTICATED) também é recusa', async () => {
    const r = rodar({
      responder: () => ({ errors: [{ message: 'x', extensions: { code: 'UNAUTHENTICATED' } }] }),
    });
    await espera();
    expect(r.alertas[0]).toMatch(/recusou o pedido/);
  });

  it('quando nada vem, fecha a aba e avisa com o motivo', async () => {
    const r = rodar({ responder: () => ({ errors: [{ message: 'Bad gateway' }] }) });
    await espera();
    expect(r.janela.close).toHaveBeenCalled();
    expect(r.alertas[0]).toMatch(/não entregou a lista \(Bad gateway\)/);
  });

  it('fora do Canal Pro, sem o site ou sem login: só avisa, com a mensagem certa', () => {
    expect(rodar({ host: 'www.google.com' }).alertas[0]).toMatch(/abra o Canal Pro/);
    const semLogin = rodar({ site: 'nada' });
    expect(semLogin.alertas[0]).toMatch(/não achei o login nesta aba/);
    expect(semLogin.j.open).not.toHaveBeenCalled();
    const semSite = rodar({ site: 'nada', semRaiz: true });
    expect(semSite.alertas[0]).toMatch(/não encontrei o site do Canal Pro/);
  });

  it('sem login à vista, escuta a página; o clique seguinte usa os cabeçalhos dela', async () => {
    const original = vi.fn((url: string, init: RequestInit) => {
      void url;
      void init;
      return Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve({
            data: {
              listings: {
                listListing: [{ id: '9', externalId: 'Z' }],
                totalPages: 1,
                totalResults: 1,
              },
            },
          }),
      });
    });
    const primeiro = rodar({ site: 'nada', j: { fetch: original } });
    expect(primeiro.alertas[0]).toMatch(/não achei o login/);
    // A própria página pede algo à API, com os cabeçalhos dela.
    const j = primeiro.j as { fetch: typeof fetch };
    await j.fetch('https://gandalf-api.grupozap.com/', {
      method: 'POST',
      headers: { Authorization: 'tk-pagina', 'X-PublisherId': '81234', 'X-Ignorado': 'y' },
      body: '{}',
    });
    expect(original).toHaveBeenCalledTimes(1);
    // Segundo clique, na mesma aba.
    const fn = new Function(`return (${COLETOR})`)() as (...a: unknown[]) => void;
    const janela = {
      document: { write: vi.fn() },
      location: { href: '' },
      closed: false,
      close: vi.fn(),
    };
    (primeiro.j as { open: unknown }).open = vi.fn(() => janela);
    fn(
      { cookie: '', getElementById: () => null, querySelectorAll: () => [] },
      { hostname: 'canal-pro.grupozap.com', origin: 'https://canal-pro.grupozap.com', href: '' },
      primeiro.j,
      'https://imova-crm.vercel.app',
    );
    await espera();
    const cab = original.mock.calls[1]![1].headers as Record<string, string>;
    expect(cab).toEqual({
      authorization: 'tk-pagina',
      'x-publisherid': '81234',
      'x-clientid': 'CANALPRO_WEB',
      'content-type': 'application/json',
    });
    expect(pacoteDa({ janela })?.como).toBe('pagina');
  });
});
