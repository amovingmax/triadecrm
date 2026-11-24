import { describe, expect, it } from 'vitest';

import {
  campoDaLinha,
  casaComABusca,
  copiaAtiva,
  estadoDoCartao,
  fotosQueFaltam,
  inteiroDaLinha,
  itensDeAtencao,
  juntarDoCanalPro,
  type LinhaDoCanalPro,
  naoPublicadoPronto,
  parecidosNoCrm,
} from './aba-dos-anuncios';
import type { AnuncioNaLista } from './tipos';

/** Um anúncio da lista com o mínimo; os testes trocam o que importa. */
function anuncio(
  p: Partial<AnuncioNaLista> & Pick<AnuncioNaLista, 'id' | 'codigo'>,
): AnuncioNaLista {
  return {
    situacao: 'rascunho',
    titulo: 'Terreno à venda',
    tipo: 'terreno',
    negocio: 'venda',
    preco_venda: 1_000_000,
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

function linha(
  p: Partial<LinhaDoCanalPro> & Pick<LinhaDoCanalPro, 'id' | 'codigo'>,
): LinhaDoCanalPro {
  return {
    titulo: null,
    situacao: 'Ativo',
    anuncio_id: null,
    parece_com: null,
    excluido_em: null,
    marcado_excluido_em: null,
    visto_em: '2026-11-09T15:57:59Z',
    preco_venda: null,
    preco_aluguel: null,
    fotos: null,
    visualizacoes: null,
    contatos: null,
    ...p,
  };
}

// Os anúncios de 18/11/2026 que importam para as regras.
const TE0001 = anuncio({
  id: 'te1',
  codigo: 'TE0001_IMOVA',
  area_total: 3000,
  area_util: 3000,
  bairro: 'Capim Macio',
  fotos: 12,
  origem: 'sistema_atual',
  no_sistema_atual: true,
  sistema_atual_em: '2026-11-06T20:57:43Z',
  no_canal_pro_situacao: 'Ativo',
  no_canal_pro_visto_em: '2026-11-09T15:57:59Z',
});
const SA0012 = anuncio({
  id: 'sa12',
  codigo: 'SA0012_IMOVA',
  tipo: 'sala_comercial',
  negocio: 'aluguel',
  area_total: 19,
  bairro: 'Ponta Negra',
  fotos: 7,
  no_sistema_atual: true,
  sistema_atual_em: '2026-11-06T20:57:43Z',
  no_canal_pro_situacao: 'Ativo',
  no_canal_pro_visto_em: '2026-11-09T15:57:59Z',
});
const SIMONE = anuncio({
  id: 'simone',
  codigo: 'Edifício Simone',
  tipo: 'apartamento',
  area_util: 57,
  bairro: 'Lagoa Nova',
  fotos: 0,
  pendencias: ['pelo menos 1 foto'],
  origem: 'relatorio_canal_pro',
  no_canal_pro_situacao: 'Inativo',
  no_canal_pro_visto_em: '2026-11-09T15:57:59Z',
  no_canal_pro_visualizacoes: 1073,
});
const TE0006 = anuncio({
  id: 'te6',
  codigo: 'TE0006',
  titulo: '',
  fotos: 2,
  area_total: 900,
  pendencias: ['título com 10 a 100 caracteres (tem 0)', 'CEP', 'bairro'],
});

const LISTA: LinhaDoCanalPro[] = [
  linha({ id: 'l1', codigo: 'TE0001_IMOVA', fotos: 12, visualizacoes: 97 }),
  linha({
    id: 'l2',
    codigo: 'Terreno Capim Macio',
    situacao: 'Inativo',
    parece_com: 'te1',
    excluido_em: '2026-11-11T18:45:47Z',
    fotos: 12,
  }),
  linha({ id: 'l3', codigo: 'SA0012_IMOVA', fotos: 8 }),
  linha({
    id: 'l4',
    codigo: 'Edifício Simone',
    situacao: 'Inativo',
    anuncio_id: 'simone',
    fotos: 47,
  }),
  linha({ id: 'l5', codigo: 'Brisa Mall - Sala 05', situacao: 'Ativo', parece_com: 'sa12' }),
  linha({ id: 'l6', codigo: 'Casa nova lá', situacao: 'Ativo' }),
];

describe('campoDaLinha e inteiroDaLinha', () => {
  it('acham a coluna pelo nome sem acento nem caixa', () => {
    const l = { 'Número de fotos': '47', 'Total de visualizações': '1.073' };
    expect(campoDaLinha(l, ['numero de fotos'])).toBe('47');
    expect(inteiroDaLinha(l, ['numero de fotos'])).toBe(47);
    expect(inteiroDaLinha(l, ['total de visualizacoes'])).toBe(1073);
    expect(inteiroDaLinha(l, ['contatos'])).toBeNull();
    expect(inteiroDaLinha(null, ['fotos'])).toBeNull();
  });
});

describe('juntarDoCanalPro', () => {
  const { porAnuncio, soltas } = juntarDoCanalPro([TE0001, SA0012, SIMONE, TE0006], LISTA);

  it('a linha de mesmo código é a própria do anúncio', () => {
    expect(porAnuncio.get('te1')?.propria?.id).toBe('l1');
    expect(porAnuncio.get('sa12')?.propria?.id).toBe('l3');
  });
  it('a linha ligada pelo "trazer" também é a própria', () => {
    expect(porAnuncio.get('simone')?.propria?.id).toBe('l4');
  });
  it('o mesmo imóvel com outro código vira cópia antiga, mesmo excluída', () => {
    expect(porAnuncio.get('te1')?.copias.map((c) => c.codigo)).toEqual(['Terreno Capim Macio']);
    expect(porAnuncio.get('sa12')?.copias.map((c) => c.codigo)).toEqual(['Brisa Mall - Sala 05']);
  });
  it('só fica solta a que não tem cartão nem é cópia', () => {
    expect(soltas.map((s) => s.codigo)).toEqual(['Casa nova lá']);
  });
  it('a solta excluída não pede nada', () => {
    const r = juntarDoCanalPro(
      [],
      [linha({ id: 'x', codigo: 'X', excluido_em: '2026-11-10T00:00:00Z' })],
    );
    expect(r.soltas).toEqual([]);
  });
});

describe('copiaAtiva e fotosQueFaltam', () => {
  it('cópia ativa é a ativa no Canal Pro que ninguém marcou como excluída', () => {
    expect(copiaAtiva({ situacao: 'Ativo', excluido_em: null })).toBe(true);
    expect(copiaAtiva({ situacao: 'Ativo', excluido_em: '2026-11-10T00:00:00Z' })).toBe(false);
    expect(copiaAtiva({ situacao: 'Inativo', excluido_em: null })).toBe(false);
  });
  it('conta as fotos que o Canal Pro tem a mais', () => {
    const { porAnuncio } = juntarDoCanalPro([TE0001, SA0012, SIMONE], LISTA);
    expect(fotosQueFaltam(SIMONE, porAnuncio.get('simone'))).toBe(47);
    expect(fotosQueFaltam(SA0012, porAnuncio.get('sa12'))).toBe(1);
    expect(fotosQueFaltam(TE0001, porAnuncio.get('te1'))).toBe(0);
    expect(fotosQueFaltam(TE0006, undefined)).toBe(0);
  });
});

describe('estadoDoCartao', () => {
  it('uma etiqueta só para o rascunho que a Arbo publica', () => {
    expect(estadoDoCartao(TE0001)).toMatchObject({ rotulo: 'Publicado pela Arbo', tom: 'arbo' });
  });
  it('inativo no Canal Pro é "Não publicado"', () => {
    expect(estadoDoCartao(SIMONE)).toMatchObject({ rotulo: 'Não publicado', tom: 'fora' });
  });
  it('rascunho diz quanto falta', () => {
    expect(estadoDoCartao(TE0006)).toMatchObject({ rotulo: 'Rascunho · falta 3', tom: 'rascunho' });
    expect(estadoDoCartao({ ...TE0006, pendencias: [] }).rotulo).toBe('Rascunho · pronto');
  });
  it('no ar sem leitura do Grupo OLX aguarda a troca; lido, é do CRM', () => {
    const noAr = { ...TE0001, situacao: 'no_ar' as const, publicado_em: '2026-11-18T15:00:00Z' };
    expect(estadoDoCartao(noAr).rotulo).toBe('No ar no CRM · aguarda a troca');
    expect(
      estadoDoCartao({ ...noAr, ultima_leitura_do_portal: '2026-11-18T12:00:00Z' }).rotulo,
    ).toBe('Publicado · entra na próxima leitura');
    expect(
      estadoDoCartao({ ...noAr, ultima_leitura_do_portal: '2026-11-19T03:07:00Z' }),
    ).toMatchObject({ rotulo: 'Publicado pelo CRM', tom: 'crm' });
  });
  it('no ar com pendência é alerta, e excluído é excluído', () => {
    expect(estadoDoCartao({ ...TE0001, situacao: 'no_ar', pendencias: ['CEP'] }).tom).toBe(
      'alerta',
    );
    expect(estadoDoCartao({ ...TE0001, excluido_em: '2026-11-18T00:00:00Z' }).rotulo).toBe(
      'Excluído',
    );
  });
});

describe('itensDeAtencao', () => {
  const anuncios = [TE0001, SA0012, SIMONE, TE0006];
  const { porAnuncio, soltas } = juntarDoCanalPro(anuncios, LISTA);
  const itens = itensDeAtencao({ anuncios, porAnuncio, soltas, vagasLivres: 3 });
  const ids = itens.map((i) => i.id);

  it('junta as fotos que faltam numa linha só, com o total', () => {
    const fotos = itens.find((i) => i.id === 'fotos')!;
    expect(fotos.titulo).toBe('2 anúncios com fotos faltando · 48 estão no Canal Pro');
    expect(fotos.texto).toBe('Edifício Simone sem nenhuma; SA0012_IMOVA com 7 de 8.');
    expect(fotos.curto).toBe('2 com fotos faltando');
    expect(fotos.acao).toEqual({ tipo: 'sincronizar' });
  });
  it('o rascunho que só espera as fotos do Canal Pro não aparece de novo', () => {
    expect(ids).not.toContain('rascunho-simone');
  });
  it('o rascunho incompleto aparece com o que falta', () => {
    const te6 = itens.find((i) => i.id === 'rascunho-te6')!;
    expect(te6.titulo).toMatch(/^TE0006 · falta /);
    expect(te6.acao).toEqual({ tipo: 'editar', anuncioId: 'te6' });
  });
  it('a cópia ativa pede para excluir no Canal Pro; a excluída, não', () => {
    const c = itens.find((i) => i.id === 'copias')!;
    expect(c.titulo).toBe('1 cópia antiga ainda ativa no Canal Pro');
    expect(c.texto).toContain('Brisa Mall - Sala 05 (= SA0012_IMOVA)');
    expect(c.texto).not.toContain('Terreno Capim Macio');
  });
  it('o que está no Canal Pro sem cartão nem par pede sincronizar', () => {
    expect(itens.find((i) => i.id === 'soltas')?.titulo).toBe(
      '1 anúncio do Canal Pro ainda sem cartão no CRM',
    );
  });
  it('não publicado pronto aparece só com vaga livre', () => {
    const pronto = { ...SIMONE, fotos: 47, pendencias: [] };
    const j = juntarDoCanalPro([pronto], LISTA);
    expect(naoPublicadoPronto(pronto)).toBe(true);
    const com = itensDeAtencao({
      anuncios: [pronto],
      porAnuncio: j.porAnuncio,
      soltas: [],
      vagasLivres: 3,
    });
    expect(com.find((i) => i.id === 'prontos')?.titulo).toBe(
      '1 não publicado já pode ir ao ar · 3 vagas livres',
    );
    const sem = itensDeAtencao({
      anuncios: [pronto],
      porAnuncio: j.porAnuncio,
      soltas: [],
      vagasLivres: 0,
    });
    expect(sem.find((i) => i.id === 'prontos')).toBeUndefined();
  });
  it('sem nada pendente, nada', () => {
    const ok = { ...TE0001 };
    const j = juntarDoCanalPro([ok], [LISTA[0]!]);
    expect(
      itensDeAtencao({ anuncios: [ok], porAnuncio: j.porAnuncio, soltas: [], vagasLivres: 3 }),
    ).toEqual([]);
  });
});

describe('parecidosNoCrm', () => {
  const anuncios = [TE0001, SA0012, SIMONE];
  it('acha o TE0001 para um terreno de 3.000 m² em Capim Macio, Natal', () => {
    expect(
      parecidosNoCrm(
        { tipo: 'terreno', cidade: 'natal', bairro: 'Capim  Macio', area: 3000 },
        anuncios,
      ),
    ).toEqual(['te1']);
  });
  it('aceita até 5% de diferença na área e junta terreno com terreno comercial', () => {
    expect(
      parecidosNoCrm(
        { tipo: 'terreno_comercial', cidade: 'Natal', bairro: '', area: 3100 },
        anuncios,
      ),
    ).toEqual(['te1']);
    expect(
      parecidosNoCrm({ tipo: 'terreno', cidade: 'Natal', bairro: '', area: 3300 }, anuncios),
    ).toEqual([]);
  });
  it('loja e sala contam juntas', () => {
    expect(
      parecidosNoCrm({ tipo: 'loja', cidade: 'Natal', bairro: 'Ponta Negra', area: 19 }, anuncios),
    ).toEqual(['sa12']);
  });
  it('bairro diferente não é o mesmo imóvel; sem tipo, cidade ou área, nada', () => {
    expect(
      parecidosNoCrm({ tipo: 'terreno', cidade: 'Natal', bairro: 'Tirol', area: 3000 }, anuncios),
    ).toEqual([]);
    expect(parecidosNoCrm({ tipo: '', cidade: 'Natal', bairro: '', area: 3000 }, anuncios)).toEqual(
      [],
    );
    expect(
      parecidosNoCrm({ tipo: 'terreno', cidade: 'Natal', bairro: '', area: null }, anuncios),
    ).toEqual([]);
  });
});

describe('casaComABusca', () => {
  it('acha pelo código, pelo título, pelo bairro e pelo código da cópia antiga', () => {
    expect(casaComABusca(TE0001, [], 'te0001')).toBe(true);
    expect(casaComABusca(TE0001, [], 'capim')).toBe(true);
    expect(casaComABusca(TE0001, [{ codigo: 'Terreno Capim Macio' }], 'terreno capim')).toBe(true);
    expect(casaComABusca(TE0001, [], 'Lagoa')).toBe(false);
    expect(casaComABusca(TE0001, [], '  ')).toBe(true);
  });
});
