import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { VIGENTES, promptVigente } from '../src/catalogo';
import { esquemaDeSaida, prepararChamada } from '../src/nucleo/chamada';
import { MODELOS } from '../src/nucleo/versionamento';
import {
  CAMPOS_DO_PERFIL,
  OBJECOES_DA_IMOVA,
  leituraDoClienteV1 as prompt,
} from '../src/prompts/leitura-do-cliente/v1';
import { encurtarTexto, leituraDoClienteV2 } from '../src/prompts/leitura-do-cliente/v2';

/**
 * A LEITURA DO CLIENTE DA IMOVA (03/11/2026), SEM REDE.
 *
 * O que estes casos protegem é o que a qualidade do texto não mostra: o modelo
 * escolhido pelo usuário, o vocabulário que é da Imova e não da KOMUNE, a prova de
 * cada afirmação, e o telefone que o cliente escreve na conversa não chegando ao
 * modelo. A qualidade da leitura em si só se mede com conversas reais e a chave da
 * Imova (pendente).
 */

const CONTATO = { leadId: 'lead-1', nome: null, empresa: null };
const SEED_DA_IMOVA = fileURLToPath(
  new URL('../../../supabase/empresas/imova/seed.sql', import.meta.url),
);

describe('leitura-do-cliente@v1', () => {
  it('roda no Haiku 5.5, lê a conversa inteira e conta como resumo do negócio', () => {
    expect(prompt.modelo).toBe(MODELOS.haiku55);
    expect(prompt.modelo).toBe('claude-haiku-5-5');
    expect(prompt.escala).toBe('conversa');
    expect(prompt.proposito).toBe('summarize_deal');
  });

  it('o texto é da Imova: nenhuma palavra da KOMUNE, de evento ou de fornecedor', () => {
    expect(prompt.sistema).toMatch(/Imova Imobiliária/);
    expect(prompt.sistema).not.toMatch(/komune|evento|fornecedor|cardápio|buffet|helo[ií]sa/i);
  });

  it('as objeções são exatamente as sete do catálogo da Imova (seed, bloco 12c)', () => {
    const seed = readFileSync(SEED_DA_IMOVA, 'utf8');
    const bloco = seed.slice(seed.indexOf('insert into public.objecoes'));
    const slugs = [...bloco.slice(0, bloco.indexOf('on conflict')).matchAll(/\('([a-z_]+)',/g)].map(
      (m) => m[1],
    );
    expect(slugs).toEqual([...OBJECOES_DA_IMOVA]);
  });

  it('o perfil tem nome fechado: é a chave que a ficha mostra e a IA da Fase 2 lê', () => {
    expect(CAMPOS_DO_PERFIL).toContain('bairros');
    expect(CAMPOS_DO_PERFIL).toContain('forma_pagamento');
    expect(new Set(CAMPOS_DO_PERFIL).size).toBe(CAMPOS_DO_PERFIL.length);
  });

  it('em todo exemplo, cada prova cita uma mensagem que está na entrada', () => {
    for (const exemplo of prompt.exemplos) {
      const ids = new Set(exemplo.entrada.mensagens.map((m) => m.messageId));
      const citados = [
        ...exemplo.saida.sinais.map((s) => s.messageId),
        ...exemplo.saida.dadosExtraidos.map((d) => d.messageId),
        ...exemplo.saida.compromissosNovos.map((c) => c.messageId),
      ];
      for (const id of citados) expect(ids, `${exemplo.nome}: ${id}`).toContain(id);
    }
  });

  it('a etapa sugerida, quando existe, é uma das etapas válidas', () => {
    for (const exemplo of prompt.exemplos) {
      const sugerida = exemplo.saida.etapaSugerida;
      if (sugerida !== null) expect(exemplo.entrada.etapasValidas).toContain(sugerida);
    }
  });

  it('os exemplos passam inteiros pela montagem e pela auditoria de PII', () => {
    for (const exemplo of prompt.exemplos) {
      expect(() => prepararChamada(prompt, exemplo.entrada, CONTATO), exemplo.nome).not.toThrow();
    }
  });

  it('o telefone que o cliente escreve na conversa não chega ao modelo', () => {
    const base = prompt.exemplos[0]!.entrada;
    const entrada = {
      ...base,
      mensagens: [
        ...base.mensagens,
        {
          messageId: 'm4',
          de: 'cliente' as const,
          quando: '09:40',
          texto: 'Se preferir me liga no 84 99988-7766, é da minha esposa.',
        },
      ],
    };
    const chamada = prepararChamada(prompt, entrada, CONTATO);
    expect(chamada.mensagem).not.toMatch(/99988[-\s]?7766/);
    expect(chamada.mensagem).toContain('é da minha esposa');
  });

  it('conversa longa não vira telefone na junção da etiqueta, do dia e da hora', () => {
    // Achado no ensaio local de 03/11/2026: `[m11] 21/10 11:20` são dez dígitos
    // começando por um DDD, e toda conversa com mais de dez mensagens era barrada.
    const base = prompt.exemplos[0]!.entrada;
    const mensagens = Array.from({ length: 30 }, (_, i) => ({
      messageId: `m${i + 1}`,
      de: (i % 2 === 0 ? 'cliente' : 'equipe') as 'cliente' | 'equipe',
      quando: `${String(11 + (i % 18)).padStart(2, '0')}/10 ${String(8 + (i % 10)).padStart(2, '0')}:${String(10 + i).padStart(2, '0')}`,
      texto: i % 3 === 0 ? 'Tem 3 quartos e 2 vagas, até 600 mil' : 'Pode ser sábado às 10h',
    }));
    expect(() => prepararChamada(prompt, { ...base, mensagens }, CONTATO)).not.toThrow();
  });

  it('o comportamento medido pelo CRM chega ao modelo, sem recálculo', () => {
    const chamada = prepararChamada(prompt, prompt.exemplos[1]!.entrada, CONTATO);
    expect(chamada.mensagem).toContain('quem falou por último: cliente');
    expect(chamada.mensagem).toContain('minutos que ele costuma levar para responder: 900');
    expect(chamada.mensagem).toContain('atitude: esfriando');
  });

  it('o teto de saída deixa lugar para o raciocínio do Haiku 5.5', () => {
    expect(prompt.maxTokens).toBeGreaterThanOrEqual(4000);
  });
});

describe('leitura-do-cliente@v2 (04/11/2026)', () => {
  // Os tamanhos de verdade das quatro leituras que a v1 recusou na primeira hora em
  // produção: resumo 462, motivo 207 a 235, próxima ação 213 e 214.
  const longa = (n: number) =>
    Array.from({ length: n }, (_, i) => (i % 7 === 6 ? ' ' : 'a')).join('').slice(0, n);
  const recusadaPelaV1 = {
    ...prompt.exemplos[0]!.saida,
    resumo: longa(462),
    motivo: longa(235),
    proximaAcao: { descricao: longa(214), prazo: null },
  };

  it('é a v1 com outro número: mesmo modelo, entrada, mensagem e exemplos', () => {
    expect(leituraDoClienteV2.versao).toBe(2);
    expect(leituraDoClienteV2.modelo).toBe(prompt.modelo);
    expect(leituraDoClienteV2.proposito).toBe(prompt.proposito);
    expect(leituraDoClienteV2.entrada).toBe(prompt.entrada);
    expect(leituraDoClienteV2.montarMensagem).toBe(prompt.montarMensagem);
    expect(leituraDoClienteV2.exemplos).toBe(prompt.exemplos);
  });

  it('o prompt diz o tamanho de cada texto, e o schema que o modelo recebe também', () => {
    expect(leituraDoClienteV2.sistema).toMatch(/motivo até 200/);
    expect(leituraDoClienteV2.sistema).toMatch(/proximaAcao\.descricao até 160/);
    const esquema = JSON.stringify(esquemaDeSaida(leituraDoClienteV2));
    expect(esquema).toContain('até 400 caracteres');
    expect(esquema).toContain('até 160 caracteres');
  });

  it('a leitura que a v1 recusou por tamanho agora passa, encurtada até o teto do banco', () => {
    expect(() => prompt.saida.parse(recusadaPelaV1)).toThrow();
    const lida = leituraDoClienteV2.saida.parse(recusadaPelaV1);
    expect(lida.resumo).toHaveLength(462);
    expect(lida.motivo).toHaveLength(235);
    expect(lida.proximaAcao.descricao.length).toBeLessThanOrEqual(200);
    expect(lida.proximaAcao.descricao.endsWith('…')).toBe(true);
  });

  it('encurta na palavra, e o que já cabe passa igual', () => {
    expect(encurtarTexto(20)('Mandar as fotos do apartamento hoje')).toBe('Mandar as fotos do…');
    expect(encurtarTexto(20)('Mandar as fotos')).toBe('Mandar as fotos');
    expect(encurtarTexto(20)(null)).toBeNull();
  });

  it('lista comprida fica com os primeiros itens; enum errado continua sendo erro', () => {
    const muitos = { ...recusadaPelaV1, alertas: Array(9).fill('pediu_visita') };
    expect(leituraDoClienteV2.saida.parse(muitos).alertas).toHaveLength(6);
    expect(() =>
      leituraDoClienteV2.saida.parse({ ...recusadaPelaV1, intencao: 'QUER_EVENTO' }),
    ).toThrow();
  });

  it('prazo que não cabe vira null, em vez de data cortada', () => {
    const lida = leituraDoClienteV2.saida.parse({
      ...recusadaPelaV1,
      proximaAcao: { descricao: 'Ligar', prazo: 'sábado de manhã, depois que ele falar com a esposa' },
    });
    expect(lida.proximaAcao.prazo).toBeNull();
  });

  it('é a vigente', () => {
    expect(VIGENTES['leitura-do-cliente']).toBe(2);
    expect(promptVigente('leitura-do-cliente')).toBe(leituraDoClienteV2);
  });
});
