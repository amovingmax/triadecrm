import { describe, expect, it } from 'vitest';

import {
  FOLGA_DA_ANUNCIADA_MS,
  TETO_DE_ANUNCIADAS,
  anunciadasDepois,
  botaoDaEspera,
  chaveDaEspera,
  duracaoDaEspera,
  esperasNovas,
  lerAnunciadas,
  lerEspera,
  linhaDaEspera,
  marcaDaEspera,
  textoDoAvisoDeEspera,
  tituloDaEspera,
  type EsperaParaAvisar,
} from './aviso-de-espera';

const MARIA = '3f2b8a10-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const LUCAS = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const DESDE = '2026-11-09T13:00:00+00:00';

function espera(campos: Partial<EsperaParaAvisar> = {}): EsperaParaAvisar {
  return {
    conversaId: MARIA,
    organizacaoId: null,
    nome: 'Maria Souza',
    desde: DESDE,
    degrau: 'espera',
    minutos: 15.2,
    responsavel: null,
    ...campos,
  };
}

describe('lerEspera', () => {
  it('lê a linha do banco (public.esperas_para_avisar)', () => {
    expect(
      lerEspera({
        conversa_id: MARIA,
        organizacao_id: null,
        nome: 'Maria Souza',
        desde: '2026-11-09T10:00:00-03:00',
        degrau: 'espera_gestao',
        minutos: '60.00',
        responsavel: 'João',
      }),
    ).toEqual({
      conversaId: MARIA,
      organizacaoId: null,
      nome: 'Maria Souza',
      desde: '2026-11-09T10:00:00-03:00',
      degrau: 'espera_gestao',
      minutos: 60,
      responsavel: 'João',
    });
  });
  it('deixa de lado a linha que não faz sentido', () => {
    expect(lerEspera(null)).toBeNull();
    expect(
      lerEspera({ conversa_id: MARIA, desde: 'ontem', degrau: 'espera', minutos: 15 }),
    ).toBeNull();
    expect(
      lerEspera({ conversa_id: MARIA, desde: DESDE, degrau: 'atrasada', minutos: 15 }),
    ).toBeNull();
    expect(
      lerEspera({ conversa_id: MARIA, desde: DESDE, degrau: 'espera', minutos: 'x' }),
    ).toBeNull();
  });
  it('sem nome, "Um contato": nunca o telefone', () => {
    expect(
      lerEspera({ conversa_id: MARIA, desde: DESDE, degrau: 'espera', minutos: 15 })?.nome,
    ).toBe('Um contato');
  });
});

describe('duracaoDaEspera', () => {
  it('minutos, horas, e horas com minutos', () => {
    expect(duracaoDaEspera(15.7)).toBe('15 min');
    expect(duracaoDaEspera(60.4)).toBe('1 h');
    expect(duracaoDaEspera(90)).toBe('1 h 30 min');
    expect(duracaoDaEspera(-3)).toBe('0 min');
  });
});

describe('linhaDaEspera e o título', () => {
  it('o degrau de quem atende: quem e há quanto tempo', () => {
    expect(linhaDaEspera(espera())).toBe('Maria Souza espera resposta há 15 min');
    expect(tituloDaEspera(espera())).toBe('Cliente esperando resposta');
    expect(botaoDaEspera(espera())).toBe('Responder');
  });
  it('o degrau da gestão diz com quem está, ou que está sem responsável', () => {
    const gestao = espera({ degrau: 'espera_gestao', minutos: 60, responsavel: 'João' });
    expect(linhaDaEspera(gestao)).toBe('Maria Souza espera resposta há 1 h · com João');
    expect(linhaDaEspera({ ...gestao, responsavel: null })).toBe(
      'Maria Souza espera resposta há 1 h · sem responsável',
    );
    expect(tituloDaEspera(gestao)).toBe('Cliente ainda sem resposta');
    expect(botaoDaEspera(gestao)).toBe('Ver conversa');
  });
});

describe('textoDoAvisoDeEspera', () => {
  it('uma espera: a empresa no título e a linha no corpo', () => {
    expect(textoDoAvisoDeEspera([espera()], 'Imova')).toEqual({
      titulo: 'Imova · Cliente esperando resposta',
      corpo: 'Maria Souza espera resposta há 15 min',
    });
  });
  it('várias: quantas e os nomes', () => {
    const varias = ['Ana', 'Bia', 'Caio', 'Davi'].map((nome, i) =>
      espera({ conversaId: `c${i}`, nome }),
    );
    expect(textoDoAvisoDeEspera(varias.slice(0, 2), 'Imova')).toEqual({
      titulo: 'Imova · 2 clientes esperando resposta',
      corpo: 'Ana e Bia',
    });
    expect(textoDoAvisoDeEspera(varias, 'Imova').corpo).toBe('Ana, Bia, Caio e mais 1');
  });
});

describe('chaveDaEspera e a marca', () => {
  it('conversa, degrau e começo da espera, no mesmo instante qualquer que seja o fuso', () => {
    expect(chaveDaEspera(espera())).toBe(`${MARIA}:espera:${Date.parse(DESDE)}`);
    expect(chaveDaEspera(espera({ desde: '2026-11-09T10:00:00-03:00' }))).toBe(
      chaveDaEspera(espera()),
    );
    expect(chaveDaEspera(espera({ degrau: 'espera_gestao' }))).not.toBe(chaveDaEspera(espera()));
  });
  it('duas abas chegam à mesma marca', () => {
    expect(marcaDaEspera([espera()])).toBe(marcaDaEspera([espera({ nome: 'Outro nome' })]));
  });
});

describe('esperasNovas', () => {
  it('anuncia o que não foi anunciado, e só isso', () => {
    const lidas = [espera(), espera({ conversaId: LUCAS, nome: 'Lucas' })];
    expect(esperasNovas(lidas, {}).map((e) => e.conversaId)).toEqual([MARIA, LUCAS]);
    expect(esperasNovas(lidas, { [chaveDaEspera(espera())]: 1 }).map((e) => e.nome)).toEqual([
      'Lucas',
    ]);
  });
  it('a mesma conversa nos dois degraus de uma vez: fica só o da gestão', () => {
    const gestao = espera({ degrau: 'espera_gestao', minutos: 70, responsavel: 'João' });
    expect(esperasNovas([espera(), gestao], {})).toEqual([gestao]);
    expect(esperasNovas([gestao, espera()], {})).toEqual([gestao]);
  });
  it('o degrau da gestão chega depois do primeiro, já anunciado: é novo', () => {
    const gestao = espera({ degrau: 'espera_gestao', minutos: 60 });
    expect(esperasNovas([espera(), gestao], { [chaveDaEspera(espera())]: 1 })).toEqual([gestao]);
  });
  it('o cliente volta a esperar depois de uma resposta: é outra espera', () => {
    const depois = espera({ desde: '2026-11-09T15:00:00+00:00' });
    expect(esperasNovas([depois], { [chaveDaEspera(espera())]: 1 })).toEqual([depois]);
  });
});

describe('anunciadasDepois', () => {
  const AGORA = Date.parse('2026-11-09T14:00:00Z');

  it('guarda tudo o que foi lido, com a hora em que foi visto primeiro', () => {
    const antes = { [chaveDaEspera(espera())]: AGORA - 60_000 };
    const lucas = espera({ conversaId: LUCAS });
    expect(anunciadasDepois(antes, [espera(), lucas], AGORA)).toEqual({
      [chaveDaEspera(espera())]: AGORA - 60_000,
      [chaveDaEspera(lucas)]: AGORA,
    });
  });
  it('esquece o que saiu da leitura só depois da folga (outra aba pode ter acabado de anunciar)', () => {
    const recente = { [chaveDaEspera(espera())]: AGORA - 60_000 };
    expect(anunciadasDepois(recente, [], AGORA)).toEqual(recente);
    const velha = { [chaveDaEspera(espera())]: AGORA - FOLGA_DA_ANUNCIADA_MS };
    expect(anunciadasDepois(velha, [], AGORA)).toEqual({});
  });
  it('não passa do teto, e fica com as mais novas', () => {
    const muitas: Record<string, number> = {};
    for (let i = 0; i < TETO_DE_ANUNCIADAS + 10; i += 1) muitas[`k${i}`] = AGORA - i;
    const depois = anunciadasDepois(muitas, [], AGORA);
    expect(Object.keys(depois)).toHaveLength(TETO_DE_ANUNCIADAS);
    expect(depois.k0).toBe(AGORA);
    expect(depois[`k${TETO_DE_ANUNCIADAS + 9}`]).toBeUndefined();
  });
});

describe('lerAnunciadas', () => {
  it('nada guardado, ou o que não se lê: primeira leitura (null)', () => {
    expect(lerAnunciadas(null)).toBeNull();
    expect(lerAnunciadas('{quebrado')).toBeNull();
    expect(lerAnunciadas('[1,2]')).toBeNull();
  });
  it('lê o registro e deixa de lado o que não é número', () => {
    expect(lerAnunciadas('{"a":1,"b":"x"}')).toEqual({ a: 1 });
  });
});
