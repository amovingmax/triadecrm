import { describe, expect, it } from 'vitest';

import { varrerMontagem } from '@komune/prompts';

import {
  CONTATO_TIRADO,
  NUMERO_TIRADO,
  blindarBase,
  blindarTexto,
  mapearTextos,
  notasCortadas,
  semNumerosLongos,
} from './blindagem';

/**
 * A blindagem da IA que atende (27/11/2026): o que a conferência de dado pessoal acusaria
 * sai do texto, o resto fica como está, e identificador nunca muda.
 */
describe('blindarTexto: a mesma régua da montagem', () => {
  it('tira o "1.338,99, 2.021" de 19/11 e deixa o resto', () => {
    const r = blindarTexto('Os lotes têm 1.338,99, 2.021 m² e ficam ao lado do parque.');
    expect(r.texto).toContain(NUMERO_TIRADO);
    expect(r.texto).toContain('m² e ficam ao lado do parque.');
    expect(varrerMontagem(r.texto)).toEqual([]);
    expect(r.tipos).toContain('TELEFONE');
  });

  it('não mexe em valor, data e medida com letra no meio', () => {
    const texto = 'O valor é R$ 520.000 (equipe, 23/11). Medidas: 12 m por 68 m.';
    expect(blindarTexto(texto)).toEqual({ texto, tipos: [] });
  });
});

describe('semNumerosLongos: o corte forte', () => {
  it('tira número comprido, e-mail e @', () => {
    const r = semNumerosLongos('Ligue 84 98820-9001, mande para contato@imova.com.br ou @imova.', 10);
    expect(r).toBe(`Ligue ${NUMERO_TIRADO}, mande para ${CONTATO_TIRADO} ou ${CONTATO_TIRADO}.`);
  });

  it('com 4 algarismos, pega o telefone repartido; abaixo disso, nada', () => {
    expect(semNumerosLongos('é 84 99988', 4)).toBe(`é ${NUMERO_TIRADO}`);
    expect(semNumerosLongos('quero 3 quartos', 4)).toBe('quero 3 quartos');
  });
});

describe('mapearTextos e blindarBase', () => {
  it('não muda identificador: uuid, id, codigo e endereço', () => {
    const base = {
      caderno: [{ id: 54, texto: 'tem 1.338,99, 2.021 m²', origem: 'tela' }],
      imoveis: [{ codigo: 'TE0007', anuncio_id: '12345678-1234-4123-8123-123456789012', descricao: 'ok' }],
    };
    const r = blindarBase(base);
    expect(r.base.imoveis[0]).toEqual(base.imoveis[0]);
    expect(r.base.caderno[0]?.id).toBe(54);
    expect(r.base.caderno[0]?.texto).toContain(NUMERO_TIRADO);
    expect(r.cortes).toEqual([{ onde: 'caderno[0].texto', tipos: ['TELEFONE'] }]);
    expect(notasCortadas(base, r.cortes)).toEqual([54]);
  });

  it('a versão e as datas da base ficam como estão (a base de produção de 27/11)', () => {
    const base = {
      versao: { caderno_mudou_em: '2026-11-27 16:36:00.249556-03', caderno_ate: 77 },
      imoveis: [{ codigo: 'TE0004', publicado_em: '2026-11-19T12:00:00Z', quando: '2026-11-27 16:36:00-03' }],
    };
    expect(blindarBase(base)).toEqual({ base, cortes: [] });
  });

  it('sem nada a tirar, a base volta igual', () => {
    const base = { caderno: [{ id: 1, texto: 'A Imova atende de segunda a sexta.' }] };
    expect(blindarBase(base)).toEqual({ base, cortes: [] });
    expect(mapearTextos({ uuid: '12345678-1234-4123-8123-123456789012' }, () => 'x')).toEqual({
      uuid: '12345678-1234-4123-8123-123456789012',
    });
  });
});

describe('a tarefa da nota cortada', () => {
  it('uma por nota por dia, para o admin, dizendo o que corrigir', async () => {
    const { bancoFalso } = await import('./banco-de-teste');
    const { avisarNotasCortadas } = await import('./blindagem');
    const banco = bancoFalso({
      tasks: [],
      profiles: [{ id: 'p1', is_active: true, role: 'admin', created_at: '2026-01-01' }],
    });
    const nada = (): void => {};
    const contexto = {
      cliente: banco.cliente,
      logger: { debug: nada, info: nada, warn: nada, error: nada },
      empresa: 'imova',
    } as unknown as Parameters<typeof avisarNotasCortadas>[0];
    await avisarNotasCortadas(contexto, [9054]);
    await avisarNotasCortadas(contexto, [9054]);
    const tarefas = banco.tabelas.tasks as { title: string; assignee_id: string }[];
    expect(tarefas).toHaveLength(1);
    expect(tarefas[0]?.title).toMatch(/\[9054\].*A IA continua respondendo.*corrija a nota/);
    expect(tarefas[0]?.assignee_id).toBe('p1');
  });
});
