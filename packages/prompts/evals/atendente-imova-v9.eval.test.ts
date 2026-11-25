import { describe, expect, it } from 'vitest';

import { VIGENTES, obterPrompt, promptVigente } from '../src/catalogo';
import { varrerMontagem } from '../src/nucleo/auditoria-pii';
import { esquemaDeSaida, prepararChamada } from '../src/nucleo/chamada';
import { BASE_DO_ENSAIO_V5 } from '../src/prompts/atendente-imova/cenarios-v5';
import { atendenteImovaV8 as v8 } from '../src/prompts/atendente-imova/v8';
import {
  BLOCO_DA_VISITA,
  atendenteImovaV9 as v9,
  sistemaComBaseV9,
} from '../src/prompts/atendente-imova/v9';

/**
 * `atendente-imova@v9` (24/11/2026): A V8 COM O PEDIDO DE VISITA.
 *
 * Pedido do dono: "A visita presencial não deve ser apresentada como link ou como algo
 * certo. Deve ser enviado uma solicitação se dá certo e deve aparecer um aviso para
 * todos os admins." Prova-se aqui que a v9 é a v8 com o campo `visita`, a linha da saída
 * e um bloco a mais; que o bloco proíbe dar a visita por marcada; e que a montagem passa
 * na auditoria. O pedido se prova no worker (`atendente.test.ts`) e no banco (pgTAP 204).
 */

const CONTATO = {
  leadId: 'lead-25',
  nome: 'Sílvia Rocha',
  empresa: null,
  telefones: ['+5584988776655'],
};

describe('atendente-imova@v9', () => {
  it('deu lugar à v10 (25/11/2026, o aviso de decisão) e continua no catálogo; a v8 também', () => {
    expect(VIGENTES['atendente-imova']).toBe(10);
    expect(promptVigente('atendente-imova')).not.toBe(v9);
    expect(obterPrompt('atendente-imova', 9)).toBe(v9);
    expect(obterPrompt('atendente-imova', 8)).toBe(v8);
    expect(v8.sistema).not.toMatch(/O PEDIDO DE VISITA/);
  });

  it('é a v8 com a linha da saída e o bloco do pedido, e nada mais', () => {
    expect(v9.versao).toBe(9);
    expect(v9.sistema.endsWith(`\n\n${BLOCO_DA_VISITA}`)).toBe(true);
    const semOBloco = v9.sistema.slice(0, v9.sistema.length - BLOCO_DA_VISITA.length - 2);
    expect(semOBloco.replace(/\n- `visita`:[^\n]*/, '')).toBe(v8.sistema);
    expect(v9.entrada).toBe(v8.entrada);
    expect(v9.ferramentas).toEqual(v8.ferramentas);
    expect(v9.montarMensagem).toBe(v8.montarMensagem);
    expect([v9.modelo, v9.proposito, v9.escala, v9.maxTokens]).toEqual([
      v8.modelo,
      v8.proposito,
      v8.escala,
      v8.maxTokens,
    ]);
    expect(v9.tokensDeSistema).toBeGreaterThan(v8.tokensDeSistema);
  });

  it('o bloco diz quando preencher e proíbe dar a visita por marcada', () => {
    expect(BLOCO_DA_VISITA).toMatch(/^O PEDIDO DE VISITA \(acao = passar_para_corretor\):/);
    expect(BLOCO_DA_VISITA).toMatch(/nunca diga que a visita está marcada, confirmada ou agendada/);
    expect(BLOCO_DA_VISITA).toMatch(/AAAA-MM-DD/);
    expect(BLOCO_DA_VISITA).not.toMatch(/link/i);
    expect(v9.sistema).toMatch(/- `visita`: \{ imovelCodigo, data, periodo, comoDisse \} ou null/);
  });

  it('a saída aceita o pedido ou null, e recusa data mal escrita ou período desconhecido', () => {
    const base = v9.exemplos[0]?.saida;
    if (base === undefined) throw new Error('a v9 tem exemplos');
    const pedido = {
      imovelCodigo: 'TE0004_IMOVA',
      data: '2026-11-26',
      periodo: 'manha',
      comoDisse: 'quinta de manhã',
    };
    expect(v9.saida.safeParse({ ...base, visita: null }).success).toBe(true);
    expect(v9.saida.safeParse({ ...base, visita: pedido }).success).toBe(true);
    expect(
      v9.saida.safeParse({ ...base, visita: { ...pedido, data: null, periodo: null } }).success,
    ).toBe(true);
    expect(v9.saida.safeParse({ ...base, visita: { ...pedido, data: '26/11' } }).success).toBe(
      false,
    );
    expect(
      v9.saida.safeParse({ ...base, visita: { ...pedido, periodo: 'madrugada' } }).success,
    ).toBe(false);
    const { visita: _sem, ...semOCampo } = { ...base, visita: null };
    expect(v9.saida.safeParse(semOCampo).success).toBe(false);
    expect(JSON.stringify(esquemaDeSaida(v9))).toContain('comoDisse');
    expect(JSON.stringify(esquemaDeSaida(v8))).not.toContain('comoDisse');
  });

  it('os exemplos validam, e o da visita passa com a frase do caderno, sem dar por marcada', () => {
    for (const e of v9.exemplos) expect(v9.saida.safeParse(e.saida).success, e.nome).toBe(true);
    const comVisita = v9.exemplos.filter((e) => e.saida.visita !== null);
    expect(comVisita).toHaveLength(1);
    const exemplo = comVisita[0];
    if (exemplo === undefined) throw new Error('falta o exemplo da visita');
    expect(exemplo.saida.acao).toBe('passar_para_corretor');
    expect(exemplo.saida.mensagem).toMatch(
      /Vou consultar um horário em que entre na minha agenda e te retorno pra combinarmos\./,
    );
    expect(exemplo.saida.mensagem).not.toMatch(/marcad|confirmad|agendad|link/i);
  });

  it('a montagem com a base passa na auditoria', () => {
    expect(varrerMontagem(sistemaComBaseV9(BASE_DO_ENSAIO_V5))).toEqual([]);
    for (const e of v9.exemplos) {
      const chamada = prepararChamada(
        { ...v9, sistema: sistemaComBaseV9(BASE_DO_ENSAIO_V5) },
        e.entrada,
        CONTATO,
      );
      expect(chamada.sistema).toContain('O PEDIDO DE VISITA');
    }
  });
});
