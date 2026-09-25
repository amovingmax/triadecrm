/**
 * A leitura periódica da saúde do número, contra o dublê da Graph.
 *
 * Sem rede e sem token de verdade: o dublê é o mesmo de `conectar.test.ts`, e
 * o banco é o `bancoFalso` do worker de IA — nenhum destes testes toca a conta
 * real da Meta.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bancoFalso } from '../ia/banco-de-teste';
import { subirDubleDaGraph, type DubleDaGraph } from './duble-da-graph-de-teste';
import { criarSaudePeriodica, lerSaudeDoNumero, type ContextoDaSaude } from './saude';
import { createLogger } from '../lib/log';

import type { ClienteDoBanco } from './ponte';

const logger = createLogger({
  worker: 'teste',
  level: 'error',
  stdout: () => {},
  stderr: () => {},
});

let duble: DubleDaGraph;

beforeAll(async () => {
  duble = await subirDubleDaGraph(54_331);
}, 20_000);

afterAll(() => {
  duble?.parar();
});

beforeEach(async () => {
  await duble.zerar();
});

describe('a leitura periódica da saúde do número', () => {
  it('lê a nota na Graph e a grava pela RPC, sem decidir nada', async () => {
    await duble.cenario({
      numeros: {
        '1234567890': {
          display_phone_number: '5584999990000',
          quality_rating: 'YELLOW',
          status: 'CONNECTED',
          name_status: 'APPROVED',
        },
      },
    });
    const banco = bancoFalso({}, { rpcs: { wa_saude_registrar: () => 1 } });
    await lerSaudeDoNumero({
      cliente: banco.cliente as unknown as ClienteDoBanco,
      graph: duble.cliente({ phoneNumberId: '1234567890' }),
      phoneNumberId: '1234567890',
      logger,
    });

    const c = banco.chamadasDeRpc.at(-1);
    expect(c?.nome).toBe('wa_saude_registrar');
    const item = (c?.argumentos as { p_item: Record<string, unknown> }).p_item;
    // A nota de qualidade NÃO vem por webhook nenhum: quem a sabe é este GET.
    expect(item).toMatchObject({ qualidade: 'YELLOW', origem: 'graph', campo: 'phone_number' });
    expect(item.numero).toBe('5584999990000');
  });

  it('falha de rede vira aviso e NÃO grava: a última linha continua valendo', async () => {
    // Gravar um "não consegui perguntar" como "sem restrição" seria trocar uma
    // informação velha e verdadeira por uma nova e falsa.
    const banco = bancoFalso({}, { rpcs: { wa_saude_registrar: () => 1 } });
    await expect(
      lerSaudeDoNumero({
        cliente: banco.cliente as unknown as ClienteDoBanco,
        graph: duble.cliente({ phoneNumberId: 'numero-que-nao-existe' }),
        phoneNumberId: 'numero-que-nao-existe',
        logger,
      }),
    ).resolves.toBeUndefined();
    expect(banco.chamadasDeRpc).toHaveLength(0);
  });

  it('respeita o intervalo: duas batidas seguidas só disparam uma leitura', async () => {
    let n = 0;
    let agora = 0;
    const p = criarSaudePeriodica({} as unknown as ContextoDaSaude, {
      intervaloMs: 1000,
      agora: () => agora,
      ler: async () => {
        n += 1;
      },
    });
    p.talvezDisparar();
    p.talvezDisparar();
    expect(n).toBe(1);

    // Deixa a leitura em curso terminar antes de andar o relógio.
    await new Promise((r) => setTimeout(r, 0));
    agora = 1001;
    p.talvezDisparar();
    expect(n).toBe(2);

    // `encerrar` é FINAL, como em `criarSincronizacaoPeriodica`: depois dela o
    // worker está parando, e uma leitura nova seria um GET que ninguém espera.
    await p.encerrar(false);
    agora = 999_999;
    p.talvezDisparar();
    expect(n).toBe(2);
  });
});
