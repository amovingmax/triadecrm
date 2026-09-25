/**
 * O seletor de origem do lote: quais fontes entram na lista.
 *
 * A pergunta não é "esta fonte está ligada?" — a fonte do Maps nasce DESLIGADA,
 * porque ninguém raspa de dentro do CRM (`is_enabled = false` é o que faz
 * `public.esteira_abrir_lote` recusar `p_kind = 'coleta'`, e só esse caso). É
 * "esta fonte entra por arquivo que uma pessoa sobe?".
 */
import { describe, expect, it } from 'vitest';

import { ehEntradaPorArquivo, fraseDaPrevia, fraseDeZero } from './tipos';

describe('fonte que entra por arquivo', () => {
  it('reconhece o booleano do jsonb', () => {
    expect(ehEntradaPorArquivo({ entrada_por_arquivo: true })).toBe(true);
  });

  it('reconhece o texto que o PostgREST devolve em `config->>`', () => {
    expect(ehEntradaPorArquivo({ entrada_por_arquivo: 'true' })).toBe(true);
  });

  it('não confunde com o `collector.enabled` nem com a chave ausente', () => {
    expect(ehEntradaPorArquivo({ collector: { kind: 'http', enabled: true } })).toBe(false);
    expect(ehEntradaPorArquivo({ entrada_por_arquivo: false })).toBe(false);
    expect(ehEntradaPorArquivo({})).toBe(false);
  });

  it('aguenta config torta sem estourar', () => {
    expect(ehEntradaPorArquivo(null)).toBe(false);
    expect(ehEntradaPorArquivo('{}')).toBe(false);
    expect(ehEntradaPorArquivo(undefined)).toBe(false);
  });
});

describe('a frase debaixo do botão de gravar', () => {
  it('nomeia cada grupo com o seu número, e "o resto" deixa de existir', () => {
    expect(fraseDaPrevia({ entra: 12, revisao: 19, duplicata: 8, erro: 1 })).toBe(
      '12 viram parceiro agora. As outras 28 não somem: 8 param na fila porque já estão na base, 19 param na fila esperando categoria e 1 não entra.',
    );
  });

  it('sem resto, não inventa resto', () => {
    expect(fraseDaPrevia({ entra: 30 })).toBe('30 viram parceiro agora.');
  });

  it('com zero entrando, diz isso na cara', () => {
    expect(fraseDaPrevia({ revisao: 19, erro: 1 })).toBe(
      'Nenhuma vira parceiro agora. As outras 20 não somem: 19 param na fila esperando categoria e 1 não entra.',
    );
  });
});

describe('o aviso de quando nenhuma virou parceiro', () => {
  /**
   * O caso de 25/09/2026, que é a razão desta função existir: 19 linhas
   * pararam por categoria e 1 deu erro, NENHUMA era duplicata, e a tela
   * afirmou "essas linhas já estavam na base".
   */
  it('com a fila no topo, fala da fila — e não da base', () => {
    expect(fraseDeZero({ revisao: 19, erro: 1 })).toBe(
      'Nenhuma virou parceiro ainda: as 19 pararam na fila esperando categoria.',
    );
  });

  it('com duplicata no topo, aí sim fala da base', () => {
    expect(fraseDeZero({ duplicata: 20 })).toBe('Nada novo entrou — essas 20 já estavam na base.');
  });

  it('reimportar o mesmo arquivo diz que já tinham entrado', () => {
    expect(fraseDeZero({ repetida: 20 })).toBe('Nada novo entrou — essas 20 já tinham entrado antes.');
  });

  it('só erro diz o que corrigir', () => {
    expect(fraseDeZero({ erro: 20 })).toBe('Nenhuma entrou: 20 linhas sem nome ou sem contato.');
  });

  it('contagem vazia não inventa explicação', () => {
    expect(fraseDeZero({})).toBe('Nenhuma linha entrou.');
  });
});
