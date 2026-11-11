import { describe, expect, it } from 'vitest';

import {
  ADIAR_A_FAIXA_MS,
  adiarAte,
  assinaturaDoEstado,
  dicaDoSistema,
  estaAdiada,
  faixaDosAvisos,
  idDoAparelhoValido,
  identificarNavegador,
  lerUltimoRegistro,
  motivoDoNavegador,
  passosParaDesbloquear,
  precisaRegistrar,
  resumoDaEquipe,
  rotuloDoNavegador,
  situacaoDe,
  TEXTO_DA_SITUACAO,
  textoDoCelular,
  textoDoComputador,
  UMA_HORA_MS,
  ultimoSinal,
  type QuemRecebe,
} from './avisos-da-equipe';

/**
 * Toda a equipe recebe aviso, e a gestão vê quem não recebe (11/11/2026, só na
 * Imova). O que estes testes travam: o rótulo que a gestão lê ("Chrome no Mac"),
 * quando a faixa "Ligar avisos" aparece, quando o navegador volta a contar ao
 * banco, e as frases da visão "Quem recebe avisos".
 *
 * As identificações são as de verdade: o Edge e o Opera dizem "Chrome", o Chrome
 * diz "Safari", o iPhone diz "Mac OS X", o Android diz "Linux", e o iPad diz
 * "Macintosh".
 */
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0';
const OPERA_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 OPR/121.0.0.0';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';
const CHROME_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/152.0.0.0 Mobile/15E148 Safari/604.1';
const CHROMEBOOK =
  'Mozilla/5.0 (X11; CrOS x86_64 16181.61.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

describe('rotuloDoNavegador: o nome que a gestão lê', () => {
  it.each([
    [CHROME_MAC, 0, 'Chrome no Mac'],
    [CHROME_WINDOWS, 0, 'Chrome no Windows'],
    [EDGE_WINDOWS, 0, 'Edge no Windows'],
    [OPERA_MAC, 0, 'Opera no Mac'],
    [SAFARI_MAC, 0, 'Safari no Mac'],
    [FIREFOX_LINUX, 0, 'Firefox no Linux'],
    [SAFARI_IPHONE, 5, 'Safari no iPhone'],
    [CHROME_IPHONE, 5, 'Chrome no iPhone'],
    [CHROME_ANDROID, 5, 'Chrome no Android'],
    [CHROMEBOOK, 0, 'Chrome no Chromebook'],
    // O iPad se diz Mac; os toques o denunciam.
    [SAFARI_MAC, 5, 'Safari no iPad'],
  ])('%s → %s', (identificacao, toques, rotulo) => {
    expect(rotuloDoNavegador(identificacao, toques)).toBe(rotulo);
  });

  it('o que não reconhece vira "Navegador", com o sistema quando dá', () => {
    expect(rotuloDoNavegador('curl/8.0')).toBe('Navegador');
    expect(rotuloDoNavegador('Algo (Windows NT 10.0)')).toBe('Navegador no Windows');
  });

  it('nunca leva a identificação inteira, nem versão', () => {
    expect(rotuloDoNavegador(CHROME_MAC)).not.toMatch(/\d/);
    expect(rotuloDoNavegador(CHROME_MAC).length).toBeLessThanOrEqual(60);
  });

  it('identificarNavegador separa navegador e sistema', () => {
    expect(identificarNavegador(EDGE_WINDOWS)).toEqual({ navegador: 'Edge', sistema: 'Windows' });
    expect(identificarNavegador('curl/8.0')).toEqual({ navegador: 'Navegador', sistema: null });
  });
});

describe('faixaDosAvisos: quando a faixa aparece', () => {
  const AGORA = Date.parse('2026-11-11T15:00:00Z');
  const base = {
    ligada: true,
    noApp: false,
    computador: true,
    permissao: 'a_pedir' as const,
    silenciado: false,
    adiadaAte: null,
    agora: AGORA,
  };

  it('navegador que ainda não perguntou: "ligar"', () => {
    expect(faixaDosAvisos(base)).toBe('ligar');
  });

  it('notificação recusada: "desbloquear"', () => {
    expect(faixaDosAvisos({ ...base, permissao: 'bloqueada' })).toBe('desbloquear');
  });

  it('já liberada, ou navegador sem notificação: nada', () => {
    expect(faixaDosAvisos({ ...base, permissao: 'liberada' })).toBeNull();
    expect(faixaDosAvisos({ ...base, permissao: 'sem_suporte' })).toBeNull();
  });

  it('fora da Imova, ou para quem não recebe avisos: nada', () => {
    expect(faixaDosAvisos({ ...base, ligada: false })).toBeNull();
  });

  it('dentro do app de celular e no celular: nada', () => {
    expect(faixaDosAvisos({ ...base, noApp: true })).toBeNull();
    expect(faixaDosAvisos({ ...base, computador: false })).toBeNull();
  });

  it('quem silenciou os avisos no menu não é cobrado', () => {
    expect(faixaDosAvisos({ ...base, silenciado: true })).toBeNull();
    expect(faixaDosAvisos({ ...base, permissao: 'bloqueada', silenciado: true })).toBeNull();
  });

  it('"Agora não" esconde por três dias, e ela volta depois', () => {
    const ate = adiarAte(AGORA);
    expect(Date.parse(ate) - AGORA).toBe(ADIAR_A_FAIXA_MS);
    expect(ADIAR_A_FAIXA_MS).toBe(3 * 24 * 60 * 60 * 1000);
    expect(faixaDosAvisos({ ...base, adiadaAte: ate })).toBeNull();
    expect(
      faixaDosAvisos({ ...base, adiadaAte: ate, agora: AGORA + ADIAR_A_FAIXA_MS - 1 }),
    ).toBeNull();
    expect(faixaDosAvisos({ ...base, adiadaAte: ate, agora: AGORA + ADIAR_A_FAIXA_MS })).toBe(
      'ligar',
    );
  });

  it('data ilegível no aparelho não esconde a faixa', () => {
    expect(estaAdiada('ontem', AGORA)).toBe(false);
    expect(estaAdiada(null, AGORA)).toBe(false);
  });
});

describe('precisaRegistrar: o navegador conta ao banco', () => {
  const AGORA = Date.parse('2026-11-11T15:00:00Z');
  const estado = {
    permissao: 'liberada',
    som: true,
    silenciado: false,
    rotulo: 'Chrome no Mac',
  } as const;
  const assinatura = assinaturaDoEstado(estado);

  it('na primeira vez', () => {
    expect(precisaRegistrar(null, assinatura, AGORA)).toBe(true);
  });

  it('o mesmo estado dentro da hora: não', () => {
    expect(precisaRegistrar({ assinatura, em: AGORA - UMA_HORA_MS + 1 }, assinatura, AGORA)).toBe(
      false,
    );
  });

  it('o mesmo estado depois de uma hora: sim, para renovar o sinal', () => {
    expect(precisaRegistrar({ assinatura, em: AGORA - UMA_HORA_MS }, assinatura, AGORA)).toBe(true);
  });

  it('mudou a permissão, o som ou o silêncio: na hora', () => {
    for (const mudanca of [
      { permissao: 'bloqueada' as const },
      { som: false },
      { silenciado: true },
    ]) {
      const nova = assinaturaDoEstado({ ...estado, ...mudanca });
      expect(nova).not.toBe(assinatura);
      expect(precisaRegistrar({ assinatura, em: AGORA - 1000 }, nova, AGORA)).toBe(true);
    }
  });

  it('relógio que voltou para trás conta como "passou a hora"', () => {
    expect(precisaRegistrar({ assinatura, em: AGORA + 60_000 }, assinatura, AGORA)).toBe(true);
  });

  it('o que estava guardado e não se lê vale como nunca registrou', () => {
    expect(lerUltimoRegistro(null)).toBeNull();
    expect(lerUltimoRegistro('{quebrado')).toBeNull();
    expect(lerUltimoRegistro('{"assinatura": 1, "em": "x"}')).toBeNull();
    expect(lerUltimoRegistro(JSON.stringify({ assinatura, em: AGORA }))).toEqual({
      assinatura,
      em: AGORA,
    });
  });

  it('o id do navegador é um UUID, ou é sorteado de novo', () => {
    expect(idDoAparelhoValido('3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')).toBe(true);
    expect(idDoAparelhoValido('qualquer-coisa')).toBe(false);
    expect(idDoAparelhoValido(null)).toBe(false);
  });
});

describe('desbloquear e conferir o sistema', () => {
  it('cada navegador tem o seu caminho, e o Mac lembra os Ajustes do Sistema', () => {
    const chrome = passosParaDesbloquear('Chrome', 'Mac');
    expect(chrome.join(' ')).toContain('“Notificações”, escolha “Permitir”');
    expect(chrome.at(-1)).toContain('Ajustes do Sistema → Notificações → Google Chrome');
    expect(passosParaDesbloquear('Safari', 'Mac')[0]).toContain('menu “Safari”');
    expect(passosParaDesbloquear('Firefox', 'Linux').join(' ')).toContain('Enviar notificações');
    expect(passosParaDesbloquear('Edge', 'Windows').at(-1)).toContain(
      'Configurações → Sistema → Notificações: Microsoft Edge',
    );
  });

  it('fora do Mac e do Windows não há dica do sistema', () => {
    expect(dicaDoSistema('Chrome', 'Linux')).toBeNull();
    expect(passosParaDesbloquear('Chrome', 'Linux')).toHaveLength(3);
  });
});

describe('a visão "Quem recebe avisos"', () => {
  const AGORA = new Date('2026-11-11T15:00:00-03:00');
  const pessoa: QuemRecebe = {
    pessoa_id: 'p1',
    nome: 'Bia',
    papel: 'sdr',
    celular_aparelhos: 0,
    celular_visto_em: null,
    celular_mensagem_ligada: true,
    celular_push_ligado: true,
    computador_ligados: 0,
    computador_visto_em: null,
    navegadores: [],
    situacao: 'nenhum',
  };

  it('as quatro situações, em linguagem simples', () => {
    expect(TEXTO_DA_SITUACAO).toEqual({
      celular_e_computador: 'Recebe no celular e no computador',
      so_computador: 'Só no computador',
      so_celular: 'Só no celular',
      nenhum: 'Não recebe aviso nenhum',
    });
  });

  it('situação desconhecida vira "nenhum": na dúvida, a linha pede atenção', () => {
    expect(situacaoDe('so_celular')).toBe('so_celular');
    expect(situacaoDe('toString')).toBe('nenhum');
    expect(situacaoDe(null)).toBe('nenhum');
  });

  it('o último sinal', () => {
    expect(ultimoSinal(null, AGORA)).toBeNull();
    expect(ultimoSinal('2026-11-11T14:59:40-03:00', AGORA)).toBe('último sinal agora mesmo');
    expect(ultimoSinal('2026-11-11T12:00:00-03:00', AGORA)).toBe('último sinal há 3 h');
    expect(ultimoSinal('2026-11-08T12:00:00-03:00', AGORA)).toBe('último sinal há 3 dias');
  });

  it('celular: sem o app, com o app, e o app que não avisa', () => {
    expect(textoDoCelular(pessoa, AGORA)).toMatchObject({ texto: 'Sem o app', apagado: true });
    const comApp = {
      ...pessoa,
      celular_aparelhos: 1,
      celular_visto_em: '2026-11-10T09:00:00-03:00',
    };
    expect(textoDoCelular(comApp, AGORA)).toMatchObject({
      texto: 'App com aviso ligado',
      sinal: 'último sinal ontem',
      apagado: false,
    });
    expect(textoDoCelular({ ...comApp, celular_aparelhos: 2 }, AGORA).texto).toBe(
      'App com aviso ligado em 2 aparelhos',
    );
    expect(textoDoCelular({ ...comApp, celular_mensagem_ligada: false }, AGORA)).toMatchObject({
      texto: 'App instalado, sem o aviso de mensagem nova',
      apagado: true,
    });
    expect(textoDoCelular({ ...comApp, celular_push_ligado: false }, AGORA)).toMatchObject({
      texto: 'App instalado, sem aviso',
      apagado: true,
    });
  });

  it('computador: quantos avisam, e por que os outros não', () => {
    const visto = '2026-11-11T14:00:00-03:00';
    const navegadores = [
      {
        rotulo: 'Chrome no Mac',
        permissao: 'liberada',
        som: true,
        silenciado: false,
        visto_em: visto,
      },
      {
        rotulo: 'Edge no Windows',
        permissao: 'bloqueada',
        som: true,
        silenciado: false,
        visto_em: visto,
      },
      {
        rotulo: 'Safari no Mac',
        permissao: 'liberada',
        som: false,
        silenciado: false,
        visto_em: visto,
      },
    ];
    const texto = textoDoComputador(
      { ...pessoa, computador_ligados: 2, computador_visto_em: visto, navegadores },
      AGORA,
    );
    expect(texto).toMatchObject({ texto: '2 navegadores com aviso', sinal: 'último sinal há 1 h' });
    expect(texto.notas).toEqual([
      'Edge no Windows: notificação bloqueada no navegador',
      'Safari no Mac: avisa, sem som',
    ]);

    expect(
      textoDoComputador(
        { ...pessoa, computador_visto_em: visto, navegadores: navegadores.slice(1, 2) },
        AGORA,
      ),
    ).toMatchObject({ texto: 'Nenhum navegador com aviso', apagado: true });
    expect(textoDoComputador(pessoa, AGORA)).toMatchObject({
      texto: 'Não abriu o CRM nos últimos 30 dias',
      sinal: null,
      apagado: true,
    });
  });

  it('o motivo de cada navegador', () => {
    const n = { rotulo: 'X', permissao: 'liberada', som: true, silenciado: false, visto_em: '' };
    expect(motivoDoNavegador(n)).toBeNull();
    expect(motivoDoNavegador({ ...n, permissao: 'a_pedir' })).toBe('aviso ainda não ligado');
    expect(motivoDoNavegador({ ...n, permissao: 'sem_suporte' })).toBe(
      'este navegador não mostra aviso',
    );
    expect(motivoDoNavegador({ ...n, silenciado: true })).toBe('avisos silenciados no menu');
  });

  it('o resumo do alto', () => {
    expect(
      resumoDaEquipe([
        pessoa,
        { ...pessoa, pessoa_id: 'p2', situacao: 'so_celular' },
        { ...pessoa, pessoa_id: 'p3', situacao: 'celular_e_computador' },
      ]),
    ).toEqual({ total: 3, nenhum: 1, ambos: 1 });
  });
});
