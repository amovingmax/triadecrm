import { describe, expect, it } from 'vitest';

import { CENARIOS_DO_ATENDENTE_V4, type SaidaDoAtendenteV3 } from '@komune/prompts';

import { bancoFalso } from './banco-de-teste';
import type { PedidoAoModelo, RespostaDoModelo } from './cliente';
import { eEnsaio, ensaiarAtendente, relatorioDoEnsaio } from './ensaio-do-atendente';
import type { ContextoDaIa } from './execucao';

import type { LogFields, Logger } from '../lib/log';

/**
 * O ensaio da IA que atende, sem rede: um "modelo" que devolve a resposta boa de cada
 * cenário (todos certos) ou uma resposta errada (o relatório mostra o erro). O que se
 * prova é o caminho — a versão vigente, a base do ensaio, o conferidor, `ai_runs` —, não o modelo.
 */

const nada = (_msg: string, _campos?: LogFields): void => {};
const logger: Logger = { debug: nada, info: nada, warn: nada, error: nada };

function modeloQueResponde(responder: (pedido: PedidoAoModelo) => SaidaDoAtendenteV3) {
  const pedidos: PedidoAoModelo[] = [];
  return {
    pedidos,
    conversar: async (pedido: PedidoAoModelo): Promise<RespostaDoModelo> => {
      pedidos.push(pedido);
      return await Promise.resolve({
        json: responder(pedido),
        modelo: pedido.modelo,
        uso: { entrada: 1000, saida: 100, escritaDeCache: 0, leituraDeCache: 0 },
        paradaPor: 'end_turn',
      });
    },
  };
}

/** O cenário da conversa pedida: o da última mensagem do cliente. */
function respostaBoaDo(pedido: PedidoAoModelo): SaidaDoAtendenteV3 {
  const cenario = CENARIOS_DO_ATENDENTE_V4.find((c) => {
    const ultima = c.entrada.mensagens[c.entrada.mensagens.length - 1];
    return ultima !== undefined && pedido.mensagem.includes(ultima.texto);
  });
  if (cenario === undefined) throw new Error('conversa que não é de cenário nenhum');
  return cenario.respostaBoa;
}

function contexto(modelo: ContextoDaIa['modelo']) {
  const banco = bancoFalso({ ai_runs: [], app_settings: [] });
  return {
    banco,
    contexto: { cliente: banco.cliente, modelo, logger, empresa: 'imova' } satisfies ContextoDaIa,
  };
}

describe('workers ai --ensaio=atendente-imova', () => {
  it('só o ensaio que existe', () => {
    expect(eEnsaio('atendente-imova')).toBe(true);
    expect(eEnsaio('atendente')).toBe(false);
    expect(eEnsaio(true)).toBe(false);
  });

  it('manda todos os cenários à v4, com a base do ensaio, e confere cada resposta', async () => {
    const modelo = modeloQueResponde(respostaBoaDo);
    const { banco, contexto: ctx } = contexto(modelo);
    const r = await ensaiarAtendente(ctx);

    expect(r.promptVersion).toBe('atendente-imova@v4');
    expect(r.modelo).toBe('claude-haiku-5-5');
    expect(r.cenarios).toHaveLength(CENARIOS_DO_ATENDENTE_V4.length);
    expect(r.acertos).toBe(CENARIOS_DO_ATENDENTE_V4.length);
    expect(modelo.pedidos).toHaveLength(CENARIOS_DO_ATENDENTE_V4.length);
    expect(modelo.pedidos[0]?.sistema).toContain('TE0004 · terreno');
    // Toda chamada fica em ai_runs, como a IA que atende.
    expect(banco.tabelas.ai_runs).toHaveLength(CENARIOS_DO_ATENDENTE_V4.length);
    expect((banco.tabelas.ai_runs?.[0] as { prompt_version?: string }).prompt_version).toBe(
      'atendente-imova@v4',
    );
    expect(r.custoUsd).toBeGreaterThan(0);
    expect(relatorioDoEnsaio(r)).toMatch(
      /^Ensaio de atendente-imova@v4 no claude-haiku-5-5: 12 de 12 cenários certos/,
    );
  });

  it('a resposta errada aparece no relatório, com o porquê', async () => {
    const modelo = modeloQueResponde(() => ({
      acao: 'enviar_link_da_agenda',
      mensagem: 'Combinado, ficou marcada! Agende em https://calendly.com/imova',
      agenda: { tipo: 'visita', imovelCodigo: 'IM0003' },
      motivo: 'x',
      anotacoes: [],
      fotosEnsinadas: [],
      confianca: 0.5,
    }));
    const r = await ensaiarAtendente(contexto(modelo).contexto, {
      cenarios: CENARIOS_DO_ATENDENTE_V4.slice(0, 2),
    });
    expect(r.acertos).toBe(0);
    const texto = relatorioDoEnsaio(r);
    expect(texto).toContain('✗ visita com código');
    expect(texto).toContain('→ a mensagem tem link ou endereço de site');
    expect(texto).toContain('→ deu o horário por marcado');
    expect(texto).toContain('→ ação enviar_link_da_agenda; esperava responder');
  });

  it('a chamada que falha conta como erro do cenário e o ensaio segue', async () => {
    const modelo = {
      conversar: async (): Promise<RespostaDoModelo> => {
        throw new Error('rede caiu');
      },
    };
    const r = await ensaiarAtendente(contexto(modelo).contexto, {
      cenarios: CENARIOS_DO_ATENDENTE_V4.slice(0, 3),
    });
    expect(r.cenarios).toHaveLength(3);
    expect(r.cenarios[0]?.falhas[0]).toMatch(/a chamada falhou \(Error: rede caiu\)/);
  });
});
