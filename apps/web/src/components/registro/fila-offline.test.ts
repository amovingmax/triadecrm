import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  anotarFalha,
  atualizarPedidoGuardado,
  definirDonoDaFila,
  drenarFila,
  guardarPendente,
  lerFila,
  lerFilaDaPessoa,
  limparFilaAoSair,
  reativarEsgotados,
  removerDaFila,
} from './fila-offline';
import { ErroDeRegistro } from './gravar';
import {
  CHAVE_FILA_REGISTRO,
  MAX_TENTATIVAS_FILA,
  registroContatoSchema,
  type RegistroContato,
  type ResultadoRegistro,
} from './tipos';

/**
 * A fila offline — o caderninho que não pode perder folha, e que tem dono.
 *
 * O primeiro defeito que estes testes travam: o registro só era guardado DEPOIS de a
 * rede falhar, então os 5 segundos do desfazer eram um buraco. Aba fechada ali dentro,
 * bateria no fim, app derrubado — e o trabalho sumia sem ninguém saber. Agora o pedido
 * é escrito antes de qualquer ida à rede, e nada sai da fila sem gravar, sem alguém
 * desfazer ou sem alguém mandar descartar.
 *
 * O segundo é do mesmo tamanho, do outro lado: a fila morava numa chave fixa. O celular
 * de campo passa de mão em mão, e o que uma pessoa anotou sobre três parceiros — nome,
 * o que foi dito, a frase da autorização — ficava legível para quem entrasse depois, e
 * subia assinado por ela. A chave passou a levar o id de quem está logado, sair apaga o
 * caderninho de quem saiu, e sem dono declarado esta fila não lê nem grava.
 *
 * O `localStorage` é montado à mão porque o Vitest de apps/web roda em `node`, sem DOM
 * (`vitest.config.mts`). É o mesmo contrato: `getItem`, `setItem`, `removeItem`, e
 * exceção quando o aparelho não deixa gravar.
 */

const HELOISA = '5f0c4d1e-1111-4111-8111-aaaaaaaaaaaa';
const GUSTAVO = '5f0c4d1e-2222-4222-8222-bbbbbbbbbbbb';

function chaveDe(usuarioId: string) {
  return `${CHAVE_FILA_REGISTRO}:${usuarioId}`;
}

function armazenamentoFalso(quebrado = false) {
  const mapa = new Map<string, string>();
  return {
    mapa,
    getItem: (chave: string) => mapa.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      if (quebrado) throw new DOMException('QuotaExceededError');
      mapa.set(chave, valor);
    },
    removeItem: (chave: string) => void mapa.delete(chave),
  };
}

type JanelaFalsa = { localStorage: ReturnType<typeof armazenamentoFalso> };

function montarJanela(quebrado = false): JanelaFalsa {
  const janelaFalsa: JanelaFalsa = { localStorage: armazenamentoFalso(quebrado) };
  (globalThis as { window?: unknown }).window = janelaFalsa;
  return janelaFalsa;
}

/** A mesma janela que o código sob teste enxerga. */
function janela(): JanelaFalsa {
  return (globalThis as unknown as { window: JanelaFalsa }).window;
}

/** Um pedido válido, na forma exata em que ele viaja para a RPC. */
function pedido(clientKey = '11111111-1111-4111-8111-111111111111'): RegistroContato {
  return registroContatoSchema.parse({
    clientKey,
    organizationId: '94a4ce96-1339-4fa5-b0b2-cc33f77a4ab8',
    dealId: 'b4eb6e39-d5ad-4144-932e-ff7fe921d894',
    etapaEsperadaId: 12,
    outcomeId: 8,
    superficie: 'ligacao',
    comQuem: 'nao_informado',
    ocorridoEm: '2026-09-04T13:00:00.000Z',
    observacao: null,
    duracaoMin: null,
    lostReasonId: null,
    reuniaoEm: null,
    reuniaoFormato: null,
    autorizacaoEvidencia: null,
    proximaAcao: null,
    confirmouOptout: false,
    temperaturaPrevista: 'frio',
  });
}

const ACEITO: ResultadoRegistro = {
  registrado: true,
  repetido: false,
  activity_id: 'a1b2c3d4-1111-4111-8111-111111111111',
  deal_id: 'b4eb6e39-d5ad-4144-932e-ff7fe921d894',
  task_id: null,
  outcome_slug: 'lig_nao_atendeu',
  etapa_antes: 'Prospectado',
  etapa_depois: null,
  etapa_aplicada: false,
  etapa_recusa: null,
  assumiu_negocio: false,
  temperatura_antes: 'frio',
  temperatura_depois: 'frio',
  precisa_atencao: false,
  porta_aberta: false,
  porta_batida: true,
  cooldown_ate: null,
  proxima_acao_em: null,
  proxima_acao_titulo: null,
  sem_negocio: false,
};

beforeEach(() => {
  montarJanela();
  definirDonoDaFila(HELOISA);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-04T13:00:00-03:00'));
});

afterEach(() => {
  definirDonoDaFila(null);
  vi.useRealTimers();
  delete (globalThis as { window?: unknown }).window;
});

describe('o registro é escrito no aparelho ANTES de qualquer ida à rede', () => {
  it('guarda no commit, com o prazo do desfazer no futuro', () => {
    expect(
      guardarPendente(pedido(), { parceiro: 'Agito Produções', desfecho: 'Não atendeu' }),
    ).toBe(true);

    const item = lerFila()[0]!;
    expect(item.parceiro).toBe('Agito Produções');
    expect(item.desfecho).toBe('Não atendeu');
    expect(item.esgotado).toBe(false);
    expect(Date.parse(item.enviarApos)).toBeGreaterThan(Date.now());
  });

  it('sobrevive ao aparelho: o que ficou guardado sobe no carregamento seguinte', async () => {
    guardarPendente(pedido(), { parceiro: 'Agito Produções', desfecho: 'Não atendeu' });

    // O "tombo": a aba morre dentro da janela de 5 s. Nada de rede aconteceu, e o
    // localStorage é a única coisa que sobrevive.
    const sobreviveu = janela().localStorage.getItem(chaveDe(HELOISA));
    montarJanela();
    janela().localStorage.setItem(chaveDe(HELOISA), sobreviveu ?? '[]');

    vi.setSystemTime(new Date('2026-09-04T13:05:00-03:00'));
    const enviar = vi.fn().mockResolvedValue(ACEITO);
    const resumo = await drenarFila(enviar);

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(resumo).toEqual({ enviados: 1, esperando: 0, parados: 0 });
    expect(lerFila()).toHaveLength(0);
  });

  it('não fura o desfazer: dentro da janela de 5 s o dreno não manda nada', async () => {
    guardarPendente(pedido(), { parceiro: 'Agito Produções', desfecho: 'Não atendeu' });

    const enviar = vi.fn().mockResolvedValue(ACEITO);
    const resumo = await drenarFila(enviar);

    expect(enviar).not.toHaveBeenCalled();
    expect(resumo.enviados).toBe(0);
    expect(lerFila()).toHaveLength(1);
  });

  it('não fura o desfazer PARADO: o registro segurado na tela não sobe pelas costas (laudo §3.12k)', async () => {
    // A pessoa tocou em "Anotar" e a contagem parou. O prazo do desfazer venceu no
    // relógio, mas o botão continua na tela — e o dreno do relógio da fila (a cada
    // INTERVALO_DRENO_MS) chegaria antes dela terminar de escrever.
    const p = pedido();
    guardarPendente(p, { parceiro: 'Agito Produções', desfecho: 'Não atendeu' });

    vi.setSystemTime(new Date('2026-09-04T13:05:00-03:00'));
    const enviar = vi.fn().mockResolvedValue(ACEITO);

    const resumo = await drenarFila(enviar, p.clientKey);

    expect(enviar).not.toHaveBeenCalled();
    expect(resumo.enviados).toBe(0);
    expect(lerFila()).toHaveLength(1);
  });

  it('segurar UM não segura os outros: o resto da fila sobe na mesma passada', async () => {
    const naMao = pedido('22222222-2222-4222-8222-222222222222');
    const outro = pedido('33333333-3333-4333-8333-333333333333');
    guardarPendente(naMao, { parceiro: 'Agito Produções', desfecho: 'Não atendeu' });
    guardarPendente(outro, { parceiro: 'Buffet Anne', desfecho: 'Não atendeu' });

    vi.setSystemTime(new Date('2026-09-04T13:05:00-03:00'));
    const enviar = vi.fn().mockResolvedValue(ACEITO);

    const resumo = await drenarFila(enviar, naMao.clientKey);

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(resumo.enviados).toBe(1);
    expect(lerFila().map((i) => i.clientKey)).toEqual([naMao.clientKey]);
  });

  it('o que ficou segurado quando a aba morreu sobe no carregamento seguinte: ninguém está mais olhando um desfazer', async () => {
    const p = pedido();
    guardarPendente(p, { parceiro: 'Agito Produções', desfecho: 'Não atendeu' });

    vi.setSystemTime(new Date('2026-09-04T13:20:00-03:00'));
    const enviar = vi.fn().mockResolvedValue(ACEITO);

    // Tela nova, ninguém segurando nada.
    const resumo = await drenarFila(enviar, null);

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(resumo.enviados).toBe(1);
    expect(lerFila()).toHaveLength(0);
  });

  it('desfazer tira da fila, e aí sim o registro deixa de existir', () => {
    const p = pedido();
    guardarPendente(p, { parceiro: 'Agito Produções', desfecho: 'Não atendeu' });
    removerDaFila(p.clientKey);
    expect(lerFila()).toHaveLength(0);
  });

  it('avisa quando o aparelho não deixou guardar, em vez de fingir que guardou', () => {
    montarJanela(true);
    expect(guardarPendente(pedido(), { parceiro: 'Agito', desfecho: 'Não atendeu' })).toBe(false);
  });

  it('correção feita no recibo troca o pedido guardado sem mexer no prazo', () => {
    const p = pedido();
    guardarPendente(p, { parceiro: 'Agito Produções', desfecho: 'Não atendeu' });
    const prazo = lerFila()[0]!.enviarApos;

    atualizarPedidoGuardado({ ...p, comQuem: 'decisor' });

    const item = lerFila()[0]!;
    expect(item.pedido.comQuem).toBe('decisor');
    expect(item.enviarApos).toBe(prazo);
  });
});

describe('o caderninho é de quem escreveu, e o aparelho é compartilhado', () => {
  it('a anotação de uma não aparece para a outra no mesmo aparelho', () => {
    guardarPendente(pedido(), { parceiro: 'Agito Produções', desfecho: 'Não atendeu' });
    expect(lerFila()).toHaveLength(1);

    // Ela entrega o celular. Quem entra depois não lê o que ela escreveu.
    definirDonoDaFila(GUSTAVO);
    expect(lerFila()).toEqual([]);

    // E o que ele registrar não se mistura com o dela.
    guardarPendente(pedido('44444444-4444-4444-8444-444444444444'), {
      parceiro: 'Buffet Anne',
      desfecho: 'Não atendeu',
    });
    expect(lerFila().map((i) => i.parceiro)).toEqual(['Buffet Anne']);

    definirDonoDaFila(HELOISA);
    expect(lerFila().map((i) => i.parceiro)).toEqual(['Agito Produções']);
  });

  it('o que uma pessoa guardou não sobe assinado pela outra', async () => {
    const dela = pedido();
    guardarPendente(dela, { parceiro: 'Agito Produções', desfecho: 'Não atendeu', esperaMs: 0 });

    definirDonoDaFila(GUSTAVO);
    const enviar = vi.fn().mockResolvedValue(ACEITO);
    expect((await drenarFila(enviar)).enviados).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('sair apaga o caderninho de quem saiu', () => {
    guardarPendente(pedido(), { parceiro: 'Agito Produções', desfecho: 'Não atendeu' });

    limparFilaAoSair(HELOISA);

    expect(janela().localStorage.getItem(chaveDe(HELOISA))).toBeNull();
    // Sem dono declarado, nem quem sabe a chave lê pela porta da frente.
    expect(lerFila()).toEqual([]);
    expect(lerFilaDaPessoa(HELOISA)).toEqual([]);
  });

  it('sair não mexe no que ainda está guardado de outra pessoa', () => {
    guardarPendente(pedido(), { parceiro: 'Agito Produções', desfecho: 'Não atendeu' });
    definirDonoDaFila(GUSTAVO);
    guardarPendente(pedido('44444444-4444-4444-8444-444444444444'), {
      parceiro: 'Buffet Anne',
      desfecho: 'Não atendeu',
    });

    limparFilaAoSair(GUSTAVO);

    expect(lerFilaDaPessoa(GUSTAVO)).toEqual([]);
    expect(lerFilaDaPessoa(HELOISA).map((i) => i.parceiro)).toEqual(['Agito Produções']);
  });

  it('a fila da chave antiga, sem dono, é apagada e não adotada por quem entrar', async () => {
    // Como estava antes desta correção: uma chave só, sem dizer de quem é. Adotar
    // significaria subir a anotação de alguém assinada por outra pessoa.
    const orfa = [
      {
        clientKey: '33333333-3333-4333-8333-333333333333',
        criadoEm: '2026-09-04T15:00:00.000Z',
        tentativas: 0,
        ultimoErro: null,
        parceiro: 'Agito Produções',
        desfecho: 'Não atendeu',
        pedido: pedido('33333333-3333-4333-8333-333333333333'),
      },
    ];
    janela().localStorage.setItem(CHAVE_FILA_REGISTRO, JSON.stringify(orfa));

    definirDonoDaFila(GUSTAVO);

    expect(janela().localStorage.getItem(CHAVE_FILA_REGISTRO)).toBeNull();
    expect(lerFila()).toEqual([]);
    const enviar = vi.fn().mockResolvedValue(ACEITO);
    expect((await drenarFila(enviar)).enviados).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('sem dono declarado a fila não guarda nada, em vez de guardar sem dono', () => {
    definirDonoDaFila(null);
    expect(guardarPendente(pedido(), { parceiro: 'Agito', desfecho: 'Não atendeu' })).toBe(false);
    expect(lerFila()).toEqual([]);
    expect(janela().localStorage.mapa.size).toBe(0);
  });
});

describe('nada some em silêncio', () => {
  function guardarVencido(clientKey?: string) {
    const p = pedido(clientKey);
    guardarPendente(p, { parceiro: 'Agito Produções', desfecho: 'Não atendeu', esperaMs: 0 });
    return p;
  }

  it('rede fora: o item fica guardado, com a tentativa anotada, e volta a tentar', async () => {
    guardarVencido();
    const enviar = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const resumo = await drenarFila(enviar);

    expect(resumo).toEqual({ enviados: 0, esperando: 1, parados: 0 });
    const item = lerFila()[0]!;
    expect(item.tentativas).toBe(1);
    expect(item.esgotado).toBe(false);
    expect(item.ultimoErro).toContain('Failed to fetch');
  });

  it('depois de MAX_TENTATIVAS_FILA para de tentar sozinho — mas CONTINUA na tela', async () => {
    guardarVencido();
    const enviar = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    for (let i = 0; i < MAX_TENTATIVAS_FILA; i += 1) await drenarFila(enviar);

    expect(enviar).toHaveBeenCalledTimes(MAX_TENTATIVAS_FILA);
    const item = lerFila()[0]!;
    expect(item.esgotado).toBe(true);
    expect(item.tentativas).toBe(MAX_TENTATIVAS_FILA);

    // Esgotado não é descartado: é o botão "Tentar de novo" que o solta.
    await drenarFila(enviar);
    expect(enviar).toHaveBeenCalledTimes(MAX_TENTATIVAS_FILA);

    reativarEsgotados();
    const enviarOk = vi.fn().mockResolvedValue(ACEITO);
    expect((await drenarFila(enviarOk)).enviados).toBe(1);
    expect(lerFila()).toHaveLength(0);
  });

  it('sessão vencida no dreno: fica guardado e marcado, para subir depois do login', async () => {
    guardarVencido();
    const enviar = vi
      .fn()
      .mockRejectedValue(
        new ErroDeRegistro('Sua sessão expirou. Entre de novo para gravar.', false),
      );

    const resumo = await drenarFila(enviar);

    expect(resumo).toEqual({ enviados: 0, esperando: 0, parados: 1 });
    expect(lerFila()[0]!).toMatchObject({
      esgotado: true,
      ultimoErro: 'Sua sessão expirou. Entre de novo para gravar.',
    });
  });

  it('recusa do servidor no dreno vira motivo visível, e não um sumiço', async () => {
    guardarVencido();
    const enviar = vi.fn().mockResolvedValue({
      registrado: false,
      motivo: 'fora_da_carteira',
      detalhe: null,
    } satisfies ResultadoRegistro);

    await drenarFila(enviar);

    expect(lerFila()[0]!).toMatchObject({
      esgotado: true,
      ultimoErro: 'Este parceiro não está na sua carteira.',
    });
  });

  it('drena vários e só tira da fila o que gravou', async () => {
    const a = guardarVencido('11111111-1111-4111-8111-111111111111');
    const b = guardarVencido('22222222-2222-4222-8222-222222222222');
    const enviar = vi.fn(async (p: RegistroContato) => {
      if (p.clientKey === a.clientKey) return ACEITO;
      throw new TypeError('Failed to fetch');
    });

    const resumo = await drenarFila(enviar);

    expect(resumo).toEqual({ enviados: 1, esperando: 1, parados: 0 });
    expect(lerFila().map((i) => i.clientKey)).toEqual([b.clientKey]);
  });

  it('item guardado por versão anterior da tela (sem prazo) é tratado como vencido', async () => {
    const antigo = [
      {
        clientKey: '33333333-3333-4333-8333-333333333333',
        criadoEm: '2026-09-04T15:00:00.000Z',
        tentativas: 0,
        ultimoErro: null,
        parceiro: 'Agito Produções',
        pedido: pedido('33333333-3333-4333-8333-333333333333'),
      },
    ];
    janela().localStorage.setItem(chaveDe(HELOISA), JSON.stringify(antigo));

    const enviar = vi.fn().mockResolvedValue(ACEITO);
    expect((await drenarFila(enviar)).enviados).toBe(1);
  });

  it('lixo no armazenamento não derruba a tela', () => {
    janela().localStorage.setItem(chaveDe(HELOISA), '{isto não é json');
    expect(lerFila()).toEqual([]);
  });

  it('dois drenos ao mesmo tempo mandam o pedido UMA vez', async () => {
    guardarVencido();
    let emCurso = 0;
    const enviar = vi.fn(async () => {
      emCurso += 1;
      await Promise.resolve();
      return ACEITO;
    });

    // `online`, o relógio e o botão podem disparar quase juntos.
    const [a, b] = await Promise.all([drenarFila(enviar), drenarFila(enviar)]);

    expect(emCurso).toBe(1);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(lerFila()).toHaveLength(0);
  });

  it('anotarFalha não perde o pedido guardado', () => {
    const p = guardarVencido();
    anotarFalha(p.clientKey, 'Não deu para falar com o servidor.', false);
    expect(lerFila()[0]!.pedido).toEqual(p);
  });
});
