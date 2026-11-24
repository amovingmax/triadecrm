import { describe, expect, it } from 'vitest';

import type { ConfiguracaoDaIa, RespostaDaIa } from './dados';
import { filtrarRespostas, partirNota, situacaoDaIa } from './formas';

const CONFIG: ConfiguracaoDaIa = {
  ligada: true,
  modo: 'treino',
  conversaDeTreino: null,
  assinatura: 'Imova',
  modelo: 'claude-haiku-5-5',
  setorCorretores: null,
  avisoCorretor: '',
  ligadaEm: null,
};

const TESTE = { id: 't1', nome: 'Ana', telefone: null, organizacaoId: null, atende: true };

describe('situacaoDaIa', () => {
  it('desligada não responde ninguém', () => {
    const s = situacaoDaIa({ config: { ...CONFIG, ligada: false }, treino: null, testes: [] });
    expect(s.tom).toBe('desligada');
    expect(s.frase).toBe('Não responde ninguém.');
  });

  it('modo clientes é "IA atendendo"', () => {
    const s = situacaoDaIa({ config: { ...CONFIG, modo: 'clientes' }, treino: null, testes: [] });
    expect(s).toMatchObject({ tom: 'atendendo', selo: 'IA atendendo' });
  });

  it('treino com conversa de treino diz de quem, e as de teste', () => {
    const s = situacaoDaIa({
      config: CONFIG,
      treino: { id: 'c1', nome: 'Janio', organizacaoId: null },
      testes: [TESTE],
    });
    expect(s.tom).toBe('treino');
    expect(s.frase).toBe(
      'Aprende só na conversa de Janio. E conversa, sem aprender, com Ana (teste).',
    );
  });

  it('treino sem conversa nenhuma é "Parada"', () => {
    const s = situacaoDaIa({ config: CONFIG, treino: null, testes: [] });
    expect(s).toMatchObject({ tom: 'parada', selo: 'Parada' });
  });

  it('treino só com as de teste continua em treino', () => {
    const s = situacaoDaIa({ config: CONFIG, treino: null, testes: [TESTE] });
    expect(s.tom).toBe('treino');
  });
});

function resposta(parcial: Partial<RespostaDaIa>): RespostaDaIa {
  return {
    id: Math.random().toString(36),
    conversaId: 'c',
    messageId: 'm',
    acao: 'respondeu',
    corpo: 'Oi',
    avaliacao: null,
    correcao: null,
    criadaEm: '2026-11-24T12:00:00Z',
    motivo: null,
    nomeDaConversa: null,
    organizacaoId: null,
    clienteDisse: null,
    ...parcial,
  };
}

describe('filtrarRespostas', () => {
  const lista = [
    resposta({ avaliacao: 'boa' }),
    resposta({ avaliacao: 'corrigir' }),
    resposta({ acao: 'passou_para_pessoa' }),
    resposta({}),
  ];

  it('separa pelo que já veio carregado', () => {
    expect(filtrarRespostas(lista, 'Todas')).toHaveLength(4);
    expect(filtrarRespostas(lista, 'Sem avaliação')).toHaveLength(2);
    expect(filtrarRespostas(lista, 'Boas')).toHaveLength(1);
    expect(filtrarRespostas(lista, 'Corrigidas')).toHaveLength(1);
    expect(filtrarRespostas(lista, 'Passou para corretor')).toHaveLength(1);
  });
});

describe('partirNota', () => {
  it('lê número, título e corpo', () => {
    expect(partirNota('11. E-MAIL PARA OFERTAS: A Imova manda ofertas.')).toEqual({
      numero: '11',
      titulo: 'E-MAIL PARA OFERTAS',
      corpo: 'A Imova manda ofertas.',
    });
  });

  it('não corta o título nos dois-pontos de dentro do parêntese', () => {
    const n = partirNota(
      '9. REGRAS FIRMES (PROVISÓRIA: tirar quando a v7 estiver no ar): Onde o caderno diverge.',
    );
    expect(n.titulo).toBe('REGRAS FIRMES (PROVISÓRIA: tirar quando a v7 estiver no ar)');
    expect(n.corpo).toBe('Onde o caderno diverge.');
  });

  it('entende FICHA e MERCADO', () => {
    expect(partirNota('FICHA 1. TERRENO DE 900 M² EM NATAL: Fica na rua tal.').numero).toBe(
      'FICHA 1',
    );
    expect(partirNota('MERCADO · CASA DE 3 QUARTOS NO POTENGI: Vantagens.')).toMatchObject({
      numero: 'MERCADO',
      titulo: 'CASA DE 3 QUARTOS NO POTENGI',
    });
  });

  it('frase solta fica inteira', () => {
    const texto = 'Quando o cliente perguntar de financiamento, a Imova trabalha com a Caixa.';
    expect(partirNota(texto)).toEqual({ numero: null, titulo: null, corpo: texto });
    expect(partirNota('3 quartos: só no Potengi.')).toEqual({
      numero: null,
      titulo: null,
      corpo: '3 quartos: só no Potengi.',
    });
  });
});
