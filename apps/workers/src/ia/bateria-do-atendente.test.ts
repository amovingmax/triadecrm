import { describe, expect, it } from 'vitest';

import type { SaidaDoAtendenteV6 } from '@komune/prompts';

import {
  entradaDaJuiza,
  relatorioDaBateria,
  rodarBateria,
  trocasDoCadernoDoAmbiente,
} from './bateria-do-atendente';
import { bancoFalso } from './banco-de-teste';
import { clienteDuble } from './duble';
import type { ContextoDaIa } from './execucao';

import type { LogFields, Logger } from '../lib/log';

/**
 * A bateria de ensaio no worker (23/11/2026), sem rede: o banco de mentira responde a
 * base e o freio, o dublê responde pelo modelo. O que importa provar: ela só lê a base,
 * nunca chama uma porta que mande mensagem, e para no teto.
 */

function loggerDeTeste(): Logger {
  const nada = (_msg: string, _campos?: LogFields): void => {};
  return { debug: nada, info: nada, warn: nada, error: nada };
}

const RESPOSTA: SaidaDoAtendenteV6 = {
  acao: 'responder',
  mensagem:
    'É o terreno de frente para o mar em Tabatinga, perto de Camurupim? Se for, o valor de venda é R$ 520.000.',
  agenda: null,
  motivo: 'Camurupim e Serv Club estão na FICHA 5.',
  anotacoes: [],
  fotosEnsinadas: [],
  confianca: 0.9,
  ofertasPorEmail: null,
};

/** As portas que mandam mensagem ou mexem em conversa: a bateria nunca as chama. */
const PORTAS_DE_SAIDA = [
  'ia_entrada_do_atendente',
  'ia_atendente_responder',
  'ia_atendente_passar',
  'ia_atendente_enviar_link',
  'ia_atendente_registrar_silencio',
  'ia_atendente_anotar',
  'ia_atendente_ofertas_por_email',
];

function montar(empresa: string | null = 'imova') {
  const banco = bancoFalso(
    { ai_runs: [], tasks: [], app_settings: [] },
    {
      rpcs: {
        ia_atendente_base: () => ({
          caderno: [
            {
              id: 55,
              texto: 'FICHA 5. TERRENO FRENTE-MAR EM TABATINGA E CAMURUPIM.',
              origem: 'tela',
            },
          ],
          imoveis: [{ codigo: 'TE0004_IMOVA' }],
          versao: { imoveis: 1 },
        }),
        alvo_suprimido: () => false,
      },
    },
  );
  const duble = clienteDuble({ forcar: { atendente: RESPOSTA } });
  const contexto: ContextoDaIa = {
    cliente: banco.cliente,
    modelo: { conversar: (pedido) => duble.conversar(pedido) },
    logger: loggerDeTeste(),
    empresa,
  };
  return { banco, contexto, duble };
}

describe('a bateria de ensaio no worker', () => {
  it('roda os casos pedidos, confere, pede a nota e não toca em conversa nenhuma', async () => {
    const { banco, contexto, duble } = montar();
    const r = await rodarBateria(contexto, {
      versao: 6,
      repeticoes: 2,
      tetoUsd: 5,
      juiza: true,
      casos: ['I01', 'A01'],
    });

    expect(r.promptVersion).toBe('atendente-imova@v6');
    expect(r.parouEm).toBeNull();
    expect(r.respostas.map((x) => `${x.caso}/${x.rodada}`)).toEqual([
      'I01/1',
      'A01/1',
      'I01/2',
      'A01/2',
    ]);
    // I01 é a resposta certa; A01 (um "bom dia") recebeu a mesma, que oferece imóvel.
    expect(r.respostas[0]?.falhas).toEqual([]);
    expect(r.respostas[1]?.falhas.join(' | ')).toMatch(/oferece imóvel a um cumprimento/);
    expect(r.respostas.every((x) => x.nota !== null)).toBe(true);
    expect(duble.chamadas.filter((f) => f === 'atendente')).toHaveLength(4);
    expect(duble.chamadas.filter((f) => f === 'juiza')).toHaveLength(4);

    const nomes = new Set(banco.chamadasDeRpc.map((c) => c.nome));
    for (const porta of PORTAS_DE_SAIDA) expect(nomes.has(porta), porta).toBe(false);
    // Toda chamada vira linha em ai_runs, sem conversa: é o que o freio do mês conta.
    expect(banco.tabelas.ai_runs).toHaveLength(8);
    expect(banco.tabelas.ai_runs?.every((linha) => linha.conversation_id == null)).toBe(true);
    expect(banco.tabelas.tasks).toEqual([]);

    const relatorio = relatorioDaBateria(r);
    expect(relatorio).toMatch(/2 de 4 respostas certas/);
    expect(relatorio).toMatch(/✓ I01 2\/2/);
    expect(relatorio).toMatch(/✗ A01 0\/2/);
  });

  it('para no teto, antes do caso seguinte, e diz onde parou', async () => {
    const { contexto } = montar();
    const r = await rodarBateria(contexto, {
      versao: 6,
      repeticoes: 3,
      tetoUsd: 0.000001,
      juiza: false,
      casos: ['I01', 'A01'],
    });
    expect(r.respostas).toHaveLength(1);
    expect(r.parouEm).toMatch(/teto de US\$ 0\.00 alcançado antes de A01 \(rodada 1\)/);
  });

  it('as notas trocadas só no ensaio entram no lugar das do banco, e nota que não existe para tudo', async () => {
    const { contexto, duble } = montar();
    const sistemas: string[] = [];
    const r = await rodarBateria(
      {
        ...contexto,
        modelo: {
          conversar: (pedido) => {
            sistemas.push(pedido.sistema);
            return duble.conversar(pedido);
          },
        },
      },
      {
        versao: 6,
        repeticoes: 1,
        tetoUsd: 5,
        juiza: false,
        casos: ['I01'],
        trocasDoCaderno: [{ id: 55, texto: 'FICHA 5. TEXTO NOVO SÓ NO ENSAIO.' }],
      },
    );
    expect(r.baseVersao).toMatchObject({ notasTrocadas: [55] });
    expect(sistemas.at(-1)).toContain('TEXTO NOVO SÓ NO ENSAIO');
    expect(sistemas.at(-1)).not.toContain('FICHA 5. TERRENO FRENTE-MAR EM TABATINGA E CAMURUPIM.');
    await expect(
      rodarBateria(montar().contexto, {
        versao: 6,
        repeticoes: 1,
        tetoUsd: 5,
        juiza: false,
        trocasDoCaderno: [{ id: 999, texto: 'x' }],
      }),
    ).rejects.toThrow(/nota do caderno que não existe: 999/);
  });

  it('as trocas vêm do ambiente em base64; lixo vira nenhuma', () => {
    const b64 = Buffer.from(JSON.stringify([{ id: 75, texto: 'nova' }, { id: 'x' }])).toString(
      'base64',
    );
    expect(trocasDoCadernoDoAmbiente(b64)).toEqual([{ id: 75, texto: 'nova' }]);
    expect(trocasDoCadernoDoAmbiente('não é base64 de json')).toEqual([]);
    expect(trocasDoCadernoDoAmbiente(undefined)).toEqual([]);
  });

  it('só roda na Imova, e a v7 exige o mapa', async () => {
    await expect(
      rodarBateria(montar('komune').contexto, {
        versao: 6,
        repeticoes: 1,
        tetoUsd: 1,
        juiza: false,
      }),
    ).rejects.toThrow(/só existe na Imova/);
    await expect(
      rodarBateria(montar().contexto, { versao: 7, repeticoes: 1, tetoUsd: 1, juiza: false }),
    ).rejects.toThrow(/precisa do mapa/);
  });

  it('a avaliadora lê a conversa do caso com a resposta no fim, e o aviso padrão na passagem sem texto', () => {
    const caso = {
      id: 'X01',
      titulo: 'x',
      grupo: 'limites' as const,
      origem: 'teste',
      critico: false,
      agora: '2026-11-24T10:15',
      agoraPorExtenso: 'terça-feira, 24 de novembro, às 10h15',
      nome: 'Ana Souza',
      falas: [{ de: 'cliente' as const, antes: 1, texto: 'Aceita FGTS?' }],
      espera: { acoes: ['passar_para_corretor' as const] },
    };
    const entrada = entradaDaJuiza(
      caso,
      'passar_para_corretor',
      'Vou verificar isso direitinho e já te retorno por aqui.',
    );
    expect(entrada.dia).toBe('2026-11-24');
    expect(entrada.acoes).toEqual([{ acao: 'passou_para_pessoa', quando: '24/11 10:15' }]);
    expect(entrada.mensagens.map((m) => m.de)).toEqual(['cliente', 'ia']);
  });
});
