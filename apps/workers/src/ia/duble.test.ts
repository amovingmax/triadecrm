import { describe, expect, it } from 'vitest';

import { esquemaDeSaida, promptVigente } from '@komune/prompts';

import { EsquemaDesconhecidoError, clienteDuble, fluxoDoEsquema } from './duble';
import { reconstruirCaminho } from './banco';

describe('fluxoDoEsquema', () => {
  it('reconhece os quatro prompts vigentes pelo esquema, não pelo texto', () => {
    expect(fluxoDoEsquema(esquemaDeSaida(promptVigente('transcricao-audio')))).toBe('transcricao');
    expect(fluxoDoEsquema(esquemaDeSaida(promptVigente('resumo-ligacao')))).toBe('resumo');
    expect(fluxoDoEsquema(esquemaDeSaida(promptVigente('followup-ligacao')))).toBe('followup');
    expect(fluxoDoEsquema(esquemaDeSaida(promptVigente('classificar-intencao')))).toBe(
      'classificacao',
    );
  });

  it('esquema que ninguém ensinou falha barulhento', () => {
    // Um prompt novo tem de aparecer aqui. Devolver algo plausível seria testar
    // o dublê em vez do worker.
    expect(() => fluxoDoEsquema({ properties: { qualquerCoisa: {} } })).toThrow(
      EsquemaDesconhecidoError,
    );
  });
});

describe('clienteDuble', () => {
  const pedido = {
    modelo: 'claude-haiku-4-5',
    sistema: 'bloco estável de sistema, o mesmo em toda chamada deste fluxo',
    mensagem: 'lead: lead-abc123\nconfiança do reconhecimento: 0.90\n\nTRANSCRIÇÃO BRUTA:\noi tudo bem',
    maxTokens: 1200,
    esquema: esquemaDeSaida(promptVigente('transcricao-audio')),
  };

  it('escreve o cache na primeira chamada e lê nas seguintes', async () => {
    const duble = clienteDuble();
    const primeira = await duble.conversar(pedido);
    const segunda = await duble.conversar(pedido);

    expect(primeira.uso.escritaDeCache).toBeGreaterThan(0);
    expect(primeira.uso.leituraDeCache).toBe(0);
    expect(segunda.uso.escritaDeCache).toBe(0);
    expect(segunda.uso.leituraDeCache).toBe(primeira.uso.escritaDeCache);
  });

  it('a saída sai da entrada, e é isso que faz o marcador ser rastreável', async () => {
    const duble = clienteDuble();
    const resposta = await duble.conversar({
      ...pedido,
      mensagem: `${pedido.mensagem}\nfalei com [[NOME_1]] no [ruído] da festa`,
    });
    const json = resposta.json as { textoLimpo: string; trechosInaudiveis: number };
    expect(json.textoLimpo).toContain('[[NOME_1]]');
    expect(json.textoLimpo).toContain('[inaudível]');
    expect(json.trechosInaudiveis).toBe(1);
  });
});

describe('reconstruirCaminho', () => {
  const arvore = [
    {
      id: 'abertura',
      texto: 'Bom dia! Falo com quem cuida dos eventos?',
      saidas: [
        { rotulo: 'Sou eu, pode falar', destino: 'gancho' },
        { rotulo: 'Sou eu, pode falar', destino: 'gancho' },
        { rotulo: 'Não é comigo', destino: 'pedir_decisor' },
      ],
    },
    { id: 'gancho', texto: 'Quantos eventos vocês fazem por mês?', saidas: [{ rotulo: 'Respondeu', destino: 'fim' }] },
    { id: 'fim', texto: 'Obrigada!', saidas: [] },
  ];

  it('deduz a resposta escolhida pelo destino do próximo nó', () => {
    expect(reconstruirCaminho(arvore, ['abertura', 'gancho', 'fim'])).toEqual([
      { id: 'abertura', texto: 'Bom dia! Falo com quem cuida dos eventos?', respostaEscolhida: 'Sou eu, pode falar' },
      { id: 'gancho', texto: 'Quantos eventos vocês fazem por mês?', respostaEscolhida: 'Respondeu' },
      { id: 'fim', texto: 'Obrigada!', respostaEscolhida: null },
    ]);
  });

  it('nó que não está mais na árvore some do caminho, e o resto continua de pé', () => {
    // Roteiro republicado sem um nó: o resumo de uma ligação antiga não pode
    // quebrar por causa disso.
    const caminho = reconstruirCaminho(arvore, ['abertura', 'no_que_sumiu', 'fim']);
    expect(caminho.map((n) => n.id)).toEqual(['abertura', 'fim']);
  });

  it('árvore vazia devolve caminho vazio — e caminho vazio não vira chamada', () => {
    expect(reconstruirCaminho(null, ['abertura'])).toEqual([]);
  });
});
