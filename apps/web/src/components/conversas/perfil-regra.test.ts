import { describe, expect, it } from 'vitest';

import {
  contarPorTipo,
  dataCurta,
  descricaoDoParceiro,
  esperamPorCaixa,
  filtrarParceiros,
  mapaDosParceiros,
  RECORTE_INICIAL,
  recadoDoPerfil,
  rotuloDaParceria,
  rotuloDoImovel,
  sugestaoDeTipo,
} from './perfil-regra';
import type { ItemConversa, PerfilDoParceiro } from './tipos';

function item(
  id: string,
  nome: string,
  parceiro: PerfilDoParceiro | null,
  extra: Partial<ItemConversa> = {},
): ItemConversa {
  return {
    id,
    nome,
    categoria: null,
    bairro: null,
    cidade: null,
    temperatura: 'morno',
    fechou: parceiro !== null,
    precisaAtencao: false,
    telefone: null,
    telefoneMascarado: true,
    email: null,
    naoContatar: false,
    etapa: null,
    funil: null,
    responsavelId: null,
    responsavel: null,
    leituraDaIa: null,
    etiquetas: [],
    parceiro,
    ultimaEm: null,
    diasSemContato: null,
    resumo: null,
    ultimoCanal: null,
    canais: [],
    quemFalou: [],
    interacoes: 0,
    fio: null,
    naoLidas: 0,
    rascunhoPendente: null,
    ...extra,
  } as ItemConversa;
}

const perfil = (p: Partial<PerfilDoParceiro> = {}): PerfilDoParceiro => ({
  tipo: 'inquilino',
  anuncioId: null,
  imovel: null,
  desde: '2026-11-21T13:00:00Z',
  porId: null,
  ...p,
});

describe('mapaDosParceiros (a marca da Consultoria vira o perfil)', () => {
  it('lê o tipo, o imóvel e quem mudou', () => {
    const mapa = mapaDosParceiros([
      {
        organization_id: 'a',
        tipo: 'inquilino',
        anuncio_id: 'x',
        desde: '2026-11-21T13:00:00Z',
        por: 'p1',
        anuncios: { codigo: 'TE0007', titulo: 'Lote em Pipa' },
      },
    ]);
    expect(mapa.get('a')).toEqual({
      tipo: 'inquilino',
      anuncioId: 'x',
      imovel: 'TE0007 · Lote em Pipa',
      desde: '2026-11-21T13:00:00Z',
      porId: 'p1',
    });
  });

  it('a marca sem tipo (botão de Prospectados) e o tipo estranho viram tipo nulo', () => {
    const mapa = mapaDosParceiros([
      { organization_id: 'a' },
      { organization_id: 'b', tipo: 'socio' },
    ]);
    expect(mapa.get('a')?.tipo).toBeNull();
    expect(mapa.get('b')?.tipo).toBeNull();
    expect(mapa.get('a')?.imovel).toBeNull();
  });
});

describe('rotuloDoImovel e rotuloDaParceria', () => {
  it('junta o código e o título que existirem', () => {
    expect(rotuloDoImovel({ codigo: 'TE0007', titulo: '  ' })).toBe('TE0007');
    expect(rotuloDoImovel({ codigo: null, titulo: 'Casa' })).toBe('Casa');
    expect(rotuloDoImovel(null)).toBeNull();
  });
  it('sem tipo, diz só "Parceiro"', () => {
    expect(rotuloDaParceria('proprietario')).toBe('Proprietário');
    expect(rotuloDaParceria(null)).toBe('Parceiro');
  });
});

describe('filtrarParceiros (a caixa Parceiros)', () => {
  const ana = item(
    'a',
    'Ana Costa',
    perfil({ tipo: 'inquilino', imovel: 'AP0003 · Apto em Ponta Negra' }),
  );
  const beto = item('b', 'Beto Lins', perfil({ tipo: 'comprador' }), { bairro: 'Pipa' });
  const caio = item('c', 'Caio Sá', perfil({ tipo: null }));

  it('sem recorte, mostra todos os abertos', () => {
    expect(filtrarParceiros([ana, beto, caio], RECORTE_INICIAL).map((i) => i.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('o tipo filtra, e quem não tem tipo conta como Outro', () => {
    expect(filtrarParceiros([ana, beto, caio], { ...RECORTE_INICIAL, tipo: 'comprador' })).toEqual([
      beto,
    ]);
    expect(filtrarParceiros([ana, beto, caio], { ...RECORTE_INICIAL, tipo: 'outro' })).toEqual([
      caio,
    ]);
  });

  it('a busca acha pelo nome, pelo bairro e pelo imóvel, sem acento', () => {
    const achar = (busca: string) =>
      filtrarParceiros([ana, beto, caio], { ...RECORTE_INICIAL, busca }).map((i) => i.id);
    expect(achar('ana')).toEqual(['a']);
    expect(achar('pipa')).toEqual(['b']);
    expect(achar('AP0003')).toEqual(['a']);
    expect(achar('ponta negra')).toEqual(['a']);
  });

  it('a gaveta separa as concluídas', () => {
    const fio = { arquivadaEm: '2026-11-20T10:00:00Z' } as ItemConversa['fio'];
    const concluida = item('d', 'Dora', perfil(), { fio });
    expect(filtrarParceiros([ana, concluida], RECORTE_INICIAL).map((i) => i.id)).toEqual(['a']);
    expect(
      filtrarParceiros([ana, concluida], { ...RECORTE_INICIAL, concluidas: true }).map((i) => i.id),
    ).toEqual(['d']);
  });

  it('contarPorTipo conta os sem tipo como Outro', () => {
    const contagem = contarPorTipo([ana, beto, caio]);
    expect(contagem.get('inquilino')).toBe(1);
    expect(contagem.get('comprador')).toBe(1);
    expect(contagem.get('outro')).toBe(1);
    expect(contagem.get('proprietario')).toBeUndefined();
  });
});

describe('esperamPorCaixa (o número de cada caixa)', () => {
  it('divide o número do menu pela marca; sem ficha é Cliente', () => {
    const parceiros = new Map([['p1', perfil()]]);
    expect(esperamPorCaixa(['p1', 'c1', null, 'c2'], parceiros)).toEqual({
      clientes: 3,
      parceiros: 1,
    });
  });
  it('enquanto o menu não sabe, ninguém sabe', () => {
    expect(esperamPorCaixa(null, new Map())).toEqual({ clientes: null, parceiros: null });
  });
  it('nada esperando é zero nas duas ("em dia")', () => {
    expect(esperamPorCaixa([], new Map())).toEqual({ clientes: 0, parceiros: 0 });
  });
});

describe('sugestaoDeTipo (o que o diálogo já traz marcado)', () => {
  it('Proprietário pela ficha, comprador pelo negócio ganho, e nada sem pista', () => {
    expect(sugestaoDeTipo({ tipo: 'fornecedor', ganhou: true })).toBe('proprietario');
    expect(sugestaoDeTipo({ tipo: 'produtor', ganhou: true })).toBe('comprador');
    expect(sugestaoDeTipo({ tipo: 'produtor', ganhou: false })).toBeNull();
  });
});

describe('descricaoDoParceiro (a faixa da conversa)', () => {
  const agora = new Date('2026-11-23T15:00:00Z');
  it('o imóvel, desde quando e por quem', () => {
    expect(
      descricaoDoParceiro(perfil({ imovel: 'TE0007 · Lote em Pipa', porId: 'p1' }), (id) =>
        id === 'p1' ? 'Janio' : null,
      ),
    ).toBe('TE0007 · Lote em Pipa · desde 21/11, por Janio');
  });
  it('sem imóvel nem pessoa, só a data', () => {
    expect(descricaoDoParceiro(perfil(), () => null)).toBe('desde 21/11');
  });
  it('a data de outro ano leva o ano; data ruim não escreve nada', () => {
    expect(dataCurta('2025-10-02T12:00:00Z', agora)).toBe('02/10/2025');
    expect(dataCurta('', agora)).toBe('');
  });
});

describe('recadoDoPerfil', () => {
  it('traduz as recusas do banco', () => {
    expect(recadoDoPerfil('tipo_invalido')).toBe('Escolha o tipo da parceria.');
    expect(recadoDoPerfil('qualquer')).toBe('Não deu certo. Tente de novo em instantes.');
  });
});
