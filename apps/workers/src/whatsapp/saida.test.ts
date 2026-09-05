/**
 * O envio, medido em duas alturas.
 *
 *   1. A FORMA. Dentro da janela de 24 h, texto livre; fora dela, template
 *      APROVADO PELA META e mais nada — é a regra do R04 §2.1, e é a única
 *      decisão que o worker toma sobre o envio.
 *
 *   2. O QUE SE FAZ COM O ERRO. Transitório volta para a fila com backoff;
 *      definitivo é encerrado sem backoff, porque insistir quatro vezes num
 *      "fora da janela de 24 h" são quatro registros de empresa insistindo na
 *      conta que a Meta usa para o quality rating do número (R04 §4).
 *
 * A porteira NÃO é medida aqui, e não podia ser: supressão, janela, teto e
 * reconferência na entrega são do Postgres (`app.wa_proximos`, migração
 * 20260905000200) e estão travadas em pgTAP. O que chega a este arquivo já
 * passou por tudo isso.
 */
import { describe, expect, it, vi } from 'vitest';

import { contagensDaSaidaZeradas, drenarSaida, formaDoEnvio } from './saida';
import { CONFIG_DE_ENVIO_PADRAO, esperaEntreEnvios } from './ponte';
import { createLogger } from '../lib/log';

import type { ClienteDaGraph, ResultadoDoEnvio } from './graph';
import type { ClienteDoBanco, ItemDeSaida } from './ponte';
import type { ContextoDaSaida } from './saida';

const logger = createLogger({
  worker: 'teste',
  level: 'error',
  stdout: () => {},
  stderr: () => {},
});

function item(parcial: Partial<ItemDeSaida> = {}): ItemDeSaida {
  return {
    msg_id: 7,
    message_id: '11111111-1111-4111-8111-111111111111',
    conversation_id: '22222222-2222-4222-8222-222222222222',
    business_number: '+5584999880011',
    para: '+5584988776655',
    tipo: 'text',
    corpo: 'Oi, Marcos, aqui é a Heloísa',
    template_params: [],
    audio_asset_id: null,
    janela_aberta: true,
    modelo: null,
    ...parcial,
  };
}

const MODELO = {
  codigo: 'GEN-FUP-LIG-V1',
  nome_meta: 'gen_fup_lig_v1',
  idioma: 'pt_BR',
  categoria: 'utility',
};

// ---------------------------------------------------------------------------
// 1. A forma do envio
// ---------------------------------------------------------------------------

describe('a forma do envio', () => {
  it('dentro da janela de 24 h, texto livre', () => {
    const f = formaDoEnvio(item());
    expect(f.ok).toBe(true);
    expect(f.ok === true && f.envio).toMatchObject({
      tipo: 'texto',
      corpo: 'Oi, Marcos, aqui é a Heloísa',
    });
  });

  it('fora da janela, template aprovado com nome e idioma da Meta', () => {
    const f = formaDoEnvio(
      item({ janela_aberta: false, modelo: MODELO, template_params: ['Marcos'] }),
    );
    expect(f.ok === true && f.envio).toMatchObject({
      tipo: 'template',
      nome: 'gen_fup_lig_v1',
      idioma: 'pt_BR',
      parametros: ['Marcos'],
    });
  });

  it('FORA DA JANELA E SEM MODELO APROVADO: não sai nada, e a linha diz por quê', () => {
    const f = formaDoEnvio(item({ janela_aberta: false, modelo: null }));
    expect(f.ok).toBe(false);
    expect(f.ok === false && f.codigo).toBe('sem_modelo_aprovado');
    expect(f.ok === false && f.motivo).toContain('janela de 24 h');
  });

  it('áudio ainda não sai: a biblioteca da Heloísa não tem arquivo gravado', () => {
    const f = formaDoEnvio(item({ tipo: 'audio' }));
    expect(f.ok === false && f.codigo).toBe('audio_sem_arquivo');
  });

  it('mensagem sem corpo dentro da janela não vira mensagem vazia', () => {
    const f = formaDoEnvio(item({ corpo: null }));
    expect(f.ok === false && f.codigo).toBe('mensagem_sem_corpo');
  });
});

// ---------------------------------------------------------------------------
// 2. O dreno
// ---------------------------------------------------------------------------

interface Chamada {
  nome: string;
  args: Record<string, unknown>;
}

function bancoFalso(lote: { itens: unknown[]; recusados?: unknown[] }): {
  cliente: ClienteDoBanco;
  chamadas: Chamada[];
} {
  const chamadas: Chamada[] = [];
  const cliente = {
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      if (nome === 'wa_saida_proximos') {
        return Promise.resolve({
          data: { itens: lote.itens, recusados: lote.recusados ?? [] },
          error: null,
        });
      }
      if (nome === 'wa_saida_falha') {
        return Promise.resolve({ data: { acao: 'reagendado', tentativa: 1 }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  } as unknown as ClienteDoBanco;
  return { cliente, chamadas };
}

function graphQueResponde(resultado: ResultadoDoEnvio): ClienteDaGraph {
  return { enviar: vi.fn(async () => resultado) } as unknown as ClienteDaGraph;
}

function contexto(cliente: ClienteDoBanco, graph: ClienteDaGraph): ContextoDaSaida {
  return {
    cliente,
    graph,
    logger,
    config: CONFIG_DE_ENVIO_PADRAO,
    dormir: async () => {},
    sorteio: () => 0.5,
  };
}

describe('o dreno da fila de saída', () => {
  it('sucesso escritura o wamid e tira a mensagem da fila', async () => {
    const { cliente, chamadas } = bancoFalso({ itens: [item()] });
    const c = contagensDaSaidaZeradas();
    await drenarSaida(contexto(cliente, graphQueResponde({ ok: true, wamid: 'wamid.OK' })), 5, c);

    expect(c.enviados).toBe(1);
    const sucesso = chamadas.find((x) => x.nome === 'wa_saida_sucesso');
    expect(sucesso?.args.p_wamid).toBe('wamid.OK');
    expect(sucesso?.args.p_msg_id).toBe(7);
    // Custo não se inventa: ele vem do recibo da Meta.
    expect(sucesso?.args.p_custo).toBeNull();
  });

  it('erro TRANSITÓRIO volta para a fila com backoff', async () => {
    const { cliente, chamadas } = bancoFalso({ itens: [item()] });
    const c = contagensDaSaidaZeradas();
    await drenarSaida(
      contexto(
        cliente,
        graphQueResponde({
          ok: false,
          codigo: '131049',
          mensagem: 'limite de marketing',
          retentar: true,
          httpStatus: 400,
        }),
      ),
      5,
      c,
    );
    expect(c.reagendados).toBe(1);
    expect(chamadas.some((x) => x.nome === 'wa_saida_falha')).toBe(true);
    expect(chamadas.some((x) => x.nome === 'wa_saida_falha_definitiva')).toBe(false);
  });

  it('erro DEFINITIVO encerra sem gastar as quatro tentativas', async () => {
    const { cliente, chamadas } = bancoFalso({ itens: [item()] });
    const c = contagensDaSaidaZeradas();
    await drenarSaida(
      contexto(
        cliente,
        graphQueResponde({
          ok: false,
          codigo: '131026',
          mensagem: 'Receiver is incapable of receiving this message',
          retentar: false,
          httpStatus: 400,
        }),
      ),
      5,
      c,
    );
    expect(c.falhados).toBe(1);
    const def = chamadas.filter((x) => x.nome === 'wa_saida_falha_definitiva');
    expect(def).toHaveLength(1);
    expect(def[0]?.args.p_codigo).toBe('131026');
    expect(chamadas.some((x) => x.nome === 'wa_saida_falha')).toBe(false);
  });

  it('sem forma de envio a mensagem morre com o motivo, sem chamar a Meta', async () => {
    const enviar = vi.fn();
    const { cliente, chamadas } = bancoFalso({ itens: [item({ janela_aberta: false })] });
    const c = contagensDaSaidaZeradas();
    await drenarSaida(contexto(cliente, { enviar } as unknown as ClienteDaGraph), 5, c);

    expect(enviar).not.toHaveBeenCalled();
    const def = chamadas.find((x) => x.nome === 'wa_saida_falha_definitiva');
    expect(def?.args.p_codigo).toBe('sem_modelo_aprovado');
  });

  it('os recusados pelo banco são contados e registrados, não reenviados', async () => {
    const { cliente } = bancoFalso({
      itens: [],
      recusados: [
        { message_id: 'a', motivo: 'contato_suprimido', acao: 'morto' },
        {
          message_id: 'b',
          motivo: 'teto_do_numero',
          acao: 'adiado',
          quando: '2026-09-08T12:00:00Z',
        },
      ],
    });
    const c = contagensDaSaidaZeradas();
    const tratados = await drenarSaida(
      contexto(cliente, graphQueResponde({ ok: true, wamid: 'x' })),
      5,
      c,
    );
    expect(tratados).toBe(0);
    expect(c.mortos).toBe(1);
    expect(c.adiados).toBe(1);
    expect(c.enviados).toBe(0);
  });
});

describe('a cadência humana (R04 §4)', () => {
  it('não espera antes do primeiro envio', async () => {
    const dormir = vi.fn(async () => {});
    const { cliente } = bancoFalso({ itens: [item({ janela_aberta: false, modelo: MODELO })] });
    await drenarSaida(
      { ...contexto(cliente, graphQueResponde({ ok: true, wamid: 'x' })), dormir },
      5,
      contagensDaSaidaZeradas(),
    );
    expect(dormir).not.toHaveBeenCalled();
  });

  it('espera entre mensagens INICIADAS PELA EMPRESA', async () => {
    const dormir = vi.fn(async () => {});
    const { cliente } = bancoFalso({
      itens: [
        item({ janela_aberta: false, modelo: MODELO }),
        item({ msg_id: 8, janela_aberta: false, modelo: MODELO }),
      ],
    });
    await drenarSaida(
      { ...contexto(cliente, graphQueResponde({ ok: true, wamid: 'x' })), dormir },
      5,
      contagensDaSaidaZeradas(),
    );
    expect(dormir).toHaveBeenCalledTimes(1);
  });

  it('NÃO espera para responder quem escreveu: dentro da janela sai na hora', async () => {
    // R08 §0.1: responder em ≤ 5 min multiplica a conversão por 9. Esperar 45 s
    // para responder quem acabou de escrever não imita gente — atrasa gente.
    const dormir = vi.fn(async () => {});
    const { cliente } = bancoFalso({ itens: [item(), item({ msg_id: 8 })] });
    await drenarSaida(
      { ...contexto(cliente, graphQueResponde({ ok: true, wamid: 'x' })), dormir },
      5,
      contagensDaSaidaZeradas(),
    );
    expect(dormir).not.toHaveBeenCalled();
  });

  it('o intervalo cai dentro da faixa configurada', () => {
    expect(esperaEntreEnvios(CONFIG_DE_ENVIO_PADRAO, () => 0)).toBe(45_000);
    expect(esperaEntreEnvios(CONFIG_DE_ENVIO_PADRAO, () => 1)).toBe(180_000);
    expect(esperaEntreEnvios(CONFIG_DE_ENVIO_PADRAO, () => 0.5)).toBe(112_500);
  });

  it('configuração invertida não produz espera negativa', () => {
    const ms = esperaEntreEnvios({ intervaloMinSeg: 200, intervaloMaxSeg: 10 }, () => 0.5);
    expect(ms).toBeGreaterThanOrEqual(0);
  });
});
