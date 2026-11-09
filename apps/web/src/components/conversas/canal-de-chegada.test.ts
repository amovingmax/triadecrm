import { describe, expect, it } from 'vitest';

import {
  automaticaEra,
  cabeNoCanal,
  canalDaFicha,
  canalNaLista,
  canalNoTopo,
  chegadasNaFicha,
  erroDoMarcar,
  fraseDaFoto,
  lerEvidencias,
  lerFoto,
  linhaDoCanal,
  montarCanais,
  montarChegada,
  porqueDoCanal,
  rotuloDaFoto,
  subcanaisParaEscolher,
  type ChegadaCrua,
  type ChegadaDaConversa,
} from './canal-de-chegada-regra';
import { aplicarFiltros, filtrarClientes } from './montagem';
import { estadoDaUrl, FILTROS_VAZIOS, urlDoEstado, contarFiltros, temRecorte } from './tipos';
import type { FioCru } from './mensagens';
import type { ItemConversa } from './tipos';

function crua(extra: Partial<ChegadaCrua> = {}): ChegadaCrua {
  return {
    id: 'c1',
    conversation_id: 'conv-1',
    organization_id: null,
    inicio_em: '2026-11-06T17:02:00Z',
    situacao: 'fechada',
    canal: 'placa',
    subcanal: 'foto_da_placa',
    confianca: 0.82,
    decidido_por: 'ia',
    motivo: null,
    regra_slug: null,
    evidencias: [],
    foto: null,
    canal_automatico: 'placa',
    subcanal_automatico: 'foto_da_placa',
    motivo_automatico: null,
    decidido_automatico_por: 'ia',
    canal_marcado: null,
    subcanal_marcado: null,
    marcado_em: null,
    marcado_por_nome: null,
    sugestao_da_ia: null,
    fechada_em: null,
    ...extra,
  };
}

function chegada(extra: Partial<ChegadaCrua> = {}): ChegadaDaConversa {
  const c = montarChegada(crua(extra));
  if (!c) throw new Error('chegada de teste inválida');
  return c;
}

describe('montarChegada', () => {
  it('lê a linha da view na forma da tela', () => {
    const c = chegada({
      evidencias: [{ message_id: 'm1', tipo: 'foto', trecho: 'Placa azul da Imova' }],
      foto: {
        message_id: 'm1',
        peca: 'placa',
        marca: 'imova',
        descricao: 'Placa azul presa no portão',
        codigo_do_imovel: 'sa0012',
      },
    });
    expect(c.canal).toBe('placa');
    expect(c.subcanal).toBe('foto_da_placa');
    expect(c.confianca).toBe(0.82);
    expect(c.evidencias).toEqual([
      { mensagemId: 'm1', tipo: 'foto', trecho: 'Placa azul da Imova' },
    ]);
    expect(c.foto).toMatchObject({ peca: 'placa', marca: 'imova', codigo: 'SA0012' });
    expect(c.marcada).toBeNull();
  });

  it('linha sem id, conversa ou início fica de fora', () => {
    expect(montarChegada(crua({ id: null }))).toBeNull();
    expect(montarChegada(crua({ conversation_id: null }))).toBeNull();
    expect(montarChegada(crua({ inicio_em: null }))).toBeNull();
  });

  it('canal que a tela não conhece vira nulo, e subcanal de outro canal também', () => {
    expect(chegada({ canal: 'outro' }).canal).toBeNull();
    expect(chegada({ canal: 'placa', subcanal: 'portal_zap' }).subcanal).toBeNull();
  });

  it('aceita a confiança que vem como texto e recusa a fora de 0 a 1', () => {
    expect(chegada({ confianca: '0.95' }).confianca).toBe(0.95);
    expect(chegada({ confianca: 7 }).confianca).toBeNull();
  });

  it('guarda a correção de gente com quem e quando', () => {
    const c = chegada({
      canal: 'outros',
      subcanal: 'indicacao',
      decidido_por: 'gente',
      canal_marcado: 'outros',
      subcanal_marcado: 'indicacao',
      marcado_em: '2026-11-06T18:00:00Z',
      marcado_por_nome: 'Ana Paula Souza',
    });
    expect(c.marcada).toEqual({
      canal: 'outros',
      subcanal: 'indicacao',
      em: '2026-11-06T18:00:00Z',
      porNome: 'Ana Paula Souza',
    });
  });
});

describe('lerEvidencias e lerFoto', () => {
  it('descarta prova sem tipo conhecido ou sem trecho e corta em quatro', () => {
    const muitas = Array.from({ length: 6 }, (_, i) => ({
      message_id: `m${i}`,
      tipo: 'texto',
      trecho: `trecho ${i}`,
    }));
    expect(
      lerEvidencias([
        { tipo: 'boato', trecho: 'x' },
        { tipo: 'texto', trecho: '  ' },
      ]),
    ).toEqual([]);
    expect(lerEvidencias(muitas)).toHaveLength(4);
    expect(lerEvidencias(null)).toEqual([]);
  });

  it('foto sem campos válidos cai no seguro, e o código estranho some', () => {
    expect(lerFoto({ peca: 'selfie', marca: 'x', codigo_do_imovel: 'tem espaço' })).toEqual({
      mensagemId: null,
      peca: 'outra',
      marca: 'ilegivel',
      descricao: null,
      codigo: null,
    });
    expect(lerFoto(null)).toBeNull();
  });
});

describe('montarCanais', () => {
  it('fica com a chegada mais recente de cada conversa', () => {
    const mapa = montarCanais([
      crua({ id: 'antiga', inicio_em: '2026-06-01T12:00:00Z', canal: 'anuncios', subcanal: null }),
      crua({ id: 'nova', inicio_em: '2026-11-06T12:00:00Z' }),
      crua({ id: 'outra', conversation_id: 'conv-2' }),
    ]);
    expect(mapa.get('conv-1')?.id).toBe('nova');
    expect(mapa.get('conv-2')?.id).toBe('outra');
  });
});

describe('onde o canal aparece', () => {
  it('a lista não mostra Não identificado nem quem ainda está sendo lido', () => {
    expect(canalNaLista(chegada())).toBe('placa');
    expect(
      canalNaLista(chegada({ canal: 'nao_identificado', subcanal: 'desconhecido' })),
    ).toBeNull();
    expect(canalNaLista(chegada({ canal: null, situacao: 'lendo' }))).toBeNull();
    expect(canalNaLista(undefined)).toBeNull();
  });

  it('o topo mostra Não identificado discreto e "identificando…"', () => {
    expect(canalNoTopo(undefined)).toEqual({ tipo: 'sem_chegada' });
    expect(canalNoTopo(chegada({ canal: null, situacao: 'lendo' }))).toEqual({
      tipo: 'identificando',
    });
    expect(canalNoTopo(chegada({ canal: 'nao_identificado' }))).toEqual({
      tipo: 'canal',
      canal: 'nao_identificado',
      discreto: true,
    });
    expect(canalNoTopo(chegada())).toEqual({ tipo: 'canal', canal: 'placa', discreto: false });
  });

  it('a etiqueta é só o canal; o subcanal vem ao tocar, sem repetir o canal', () => {
    expect(linhaDoCanal('placa', 'foto_da_placa')).toBe('Placa · Foto da placa');
    expect(linhaDoCanal('anuncios', 'portal_zap')).toBe('Anúncios · ZAP Imóveis');
    expect(linhaDoCanal('outros', 'indicacao')).toBe('Outros · Indicação');
    expect(linhaDoCanal('outros', 'outro_meio')).toBe('Outros · Outro meio');
    expect(linhaDoCanal('nao_identificado', 'desconhecido')).toBe('Não identificado');
    expect(linhaDoCanal('placa', null)).toBe('Placa');
  });
});

describe('porqueDoCanal', () => {
  it('a frase do banco vale, e a IA ganha a confiança no fim', () => {
    expect(
      porqueDoCanal(
        chegada({ decidido_por: 'regra', motivo: "Clicou no anúncio 'Apto Ponta Negra'" }),
      ),
    ).toBe("Clicou no anúncio 'Apto Ponta Negra'");
    expect(porqueDoCanal(chegada({ motivo: 'A IA leu "vi a placa de vocês"' }))).toBe(
      'A IA leu "vi a placa de vocês" · 82%',
    );
  });

  it('sem frase do banco, a IA que viu a foto diz o quê, com código e confiança', () => {
    const c = chegada({
      foto: {
        message_id: 'm3',
        peca: 'placa',
        marca: 'imova',
        descricao: null,
        codigo_do_imovel: 'SA0012',
      },
    });
    expect(porqueDoCanal(c)).toBe('A IA viu uma foto de placa da Imova, código SA0012 · 82%');
  });

  it('não repete a porcentagem que a frase já tem', () => {
    expect(porqueDoCanal(chegada({ motivo: 'Foto da placa (82%)' }))).toBe('Foto da placa (82%)');
  });

  it('a correção diz quem e quando, pelo primeiro nome', () => {
    const c = chegada({
      decidido_por: 'gente',
      canal_marcado: 'placa',
      marcado_em: '2026-11-06T18:00:00Z',
      marcado_por_nome: 'Ana Paula Souza',
    });
    expect(porqueDoCanal(c)).toBe('Corrigido por Ana em 06/11');
  });

  it('enquanto lê, diz que está lendo', () => {
    expect(porqueDoCanal(chegada({ canal: null, situacao: 'lendo', decidido_por: null }))).toMatch(
      /^Lendo as primeiras mensagens/,
    );
  });

  it('depois da correção, lembra o que a automática dizia', () => {
    const c = chegada({
      canal: 'outros',
      subcanal: 'indicacao',
      decidido_por: 'gente',
      canal_marcado: 'outros',
      canal_automatico: 'anuncios',
      subcanal_automatico: 'meta_anuncio',
    });
    expect(automaticaEra(c)).toBe('Anúncios · Anúncio no Instagram/Facebook');
    expect(automaticaEra(chegada())).toBeNull();
  });
});

describe('a foto descrita', () => {
  it('banner da Imova, placa de outra imobiliária e print', () => {
    const base = { message_id: 'm1', descricao: null, codigo_do_imovel: null };
    expect(fraseDaFoto(lerFoto({ ...base, peca: 'banner', marca: 'imova' })!)).toBe(
      'uma foto de banner da Imova',
    );
    expect(rotuloDaFoto(lerFoto({ ...base, peca: 'placa', marca: 'outra_imobiliaria' })!)).toBe(
      'Foto de placa de outra imobiliária',
    );
    expect(rotuloDaFoto(lerFoto({ ...base, peca: 'print_de_anuncio', marca: 'sem_marca' })!)).toBe(
      'Print de anúncio',
    );
  });
});

describe('corrigir', () => {
  it('só oferece detalhe onde há mais de um', () => {
    expect(subcanaisParaEscolher('placa')).toEqual([
      'foto_da_placa',
      'foto_do_banner',
      'texto_da_placa',
    ]);
    expect(subcanaisParaEscolher('outros')).toEqual(['indicacao', 'site', 'google', 'outro_meio']);
    expect(subcanaisParaEscolher('nao_identificado')).toEqual([]);
  });

  it('traduz a recusa do banco', () => {
    expect(erroDoMarcar({ ok: true, canal: 'placa' })).toBeNull();
    expect(erroDoMarcar({ ok: false, motivo: 'sem_permissao' })).toMatch(/acesso/);
    expect(erroDoMarcar({ ok: false, motivo: 'subcanal_invalido' })).toMatch(/não combina/);
    expect(erroDoMarcar(null)).toBe('Não deu para gravar.');
  });
});

describe('chegadasNaFicha', () => {
  it('a primeira chegou, as seguintes voltaram, na ordem do tempo', () => {
    const itens = chegadasNaFicha([
      chegada({
        id: 'volta',
        inicio_em: '2027-02-03T15:00:00Z',
        canal: 'anuncios',
        subcanal: 'portal_zap',
        decidido_por: 'regra',
        motivo: 'Mandou o link do ZAP',
      }),
      chegada({
        id: 'primeira',
        inicio_em: '2026-11-06T15:00:00Z',
        motivo: 'Mandou foto da placa',
      }),
      chegada({ id: 'lendo', inicio_em: '2027-05-01T15:00:00Z', canal: null, situacao: 'lendo' }),
    ]);
    expect(itens.map((i) => i.frase)).toEqual([
      'Chegou pela placa em 06/11/2026',
      'Voltou por anúncio em 03/02/2027',
      'Voltou em 01/05/2027 · identificando o canal…',
    ]);
    expect(itens[0]?.detalhe).toBe('Foto da placa · Mandou foto da placa · 82%');
    expect(itens[1]?.detalhe).toBe('ZAP Imóveis · Mandou o link do ZAP');
  });

  it('Não identificado diz isso, sem inventar canal', () => {
    const [item] = chegadasNaFicha([
      chegada({ canal: 'nao_identificado', subcanal: 'desconhecido' }),
    ]);
    expect(item?.frase).toBe('Chegou em 06/11/2026 · canal não identificado');
  });

  it('Outros diz o meio que o cliente contou (09/11/2026)', () => {
    const frases = chegadasNaFicha([
      chegada({ id: 'a', inicio_em: '2026-11-06T15:00:00Z', canal: 'outros', subcanal: 'indicacao' }),
      chegada({ id: 'b', inicio_em: '2026-12-10T15:00:00Z', canal: 'outros', subcanal: 'google' }),
      chegada({ id: 'c', inicio_em: '2027-01-20T15:00:00Z', canal: 'outros', subcanal: 'outro_meio' }),
    ]).map((i) => i.frase);
    expect(frases).toEqual([
      'Chegou por indicação em 06/11/2026',
      'Voltou pelo Google em 10/12/2026',
      'Voltou por outro meio em 20/01/2027',
    ]);
  });

  it('a etiqueta do topo da ficha é a chegada mais recente que tem canal', () => {
    const placa = chegada({ id: 'a', inicio_em: '2026-11-06T15:00:00Z' });
    const outros = chegada({ id: 'b', inicio_em: '2026-12-10T15:00:00Z', canal: 'outros', subcanal: 'google' });
    const semCanal = chegada({
      id: 'c',
      inicio_em: '2027-01-20T15:00:00Z',
      canal: 'nao_identificado',
      subcanal: 'desconhecido',
    });
    const lendo = chegada({ id: 'd', inicio_em: '2027-02-01T15:00:00Z', canal: null, situacao: 'lendo' });
    expect(canalDaFicha([placa, outros, semCanal, lendo])?.id).toBe('b');
    expect(canalDaFicha([semCanal, lendo])).toBeNull();
    expect(canalDaFicha([])).toBeNull();
  });
});

describe('o filtro "Canal de chegada"', () => {
  const canais = montarCanais([
    crua({ conversation_id: 'fio-placa' }),
    crua({ id: 'c2', conversation_id: 'fio-anuncio', canal: 'anuncios', subcanal: 'meta_anuncio' }),
    crua({
      id: 'c3',
      conversation_id: 'fio-cliente',
      canal: 'nao_identificado',
      subcanal: 'desconhecido',
    }),
  ]);

  it('cabeNoCanal: sem filtro passa tudo; com filtro, só o canal certo', () => {
    expect(cabeNoCanal(undefined, null)).toBe(true);
    expect(cabeNoCanal(canais.get('fio-placa'), 'placa')).toBe(true);
    expect(cabeNoCanal(canais.get('fio-placa'), 'anuncios')).toBe(false);
    expect(cabeNoCanal(undefined, 'nao_identificado')).toBe(false);
  });

  it('recorta parceiros pela conversa em foco e clientes pela conversa deles', () => {
    const item = (id: string, fioId: string | null) =>
      ({
        id,
        nome: id,
        categoria: null,
        bairro: null,
        cidade: null,
        responsavelId: null,
        quemFalou: [],
        canais: [],
        diasSemContato: null,
        fio: fioId ? { id: fioId, arquivadaEm: null, responsavelId: null, setorId: null } : null,
      }) as unknown as ItemConversa;
    const itens = [item('o1', 'fio-placa'), item('o2', 'fio-anuncio'), item('o3', null)];
    const so = { ...FILTROS_VAZIOS, chegada: 'placa' as const };
    expect(aplicarFiltros(itens, so, undefined, canais).map((i) => i.id)).toEqual(['o1']);
    expect(aplicarFiltros(itens, FILTROS_VAZIOS, undefined, canais)).toHaveLength(3);

    const fio = (id: string) =>
      ({
        id,
        organization_id: null,
        arquivada_em: null,
        assignee_id: null,
        setor_id: null,
        peer_nome: null,
        peer_phone_e164: '+5584999990000',
        channel: 'whatsapp',
      }) as unknown as FioCru;
    expect(
      filtrarClientes(
        [fio('fio-cliente'), fio('fio-sem-chegada')],
        { ...FILTROS_VAZIOS, chegada: 'nao_identificado' },
        undefined,
        canais,
      ).map((f) => f.id),
    ).toEqual(['fio-cliente']);
  });

  it('conta como filtro e é um recorte', () => {
    const com = { ...FILTROS_VAZIOS, chegada: 'outros' as const };
    expect(contarFiltros(com)).toBe(1);
    expect(temRecorte(com)).toBe(true);
  });

  it('vai para o endereço; fora da Imova o endereço é ignorado', () => {
    expect(urlDoEstado({ ...FILTROS_VAZIOS, chegada: 'placa' }, null)).toBe('?chegada=placa');
    // O teste roda como a KOMUNE (sem `NEXT_PUBLIC_EMPRESA`), onde o módulo não existe.
    expect(estadoDaUrl({ chegada: 'placa' }).filtros.chegada).toBeNull();
  });
});
