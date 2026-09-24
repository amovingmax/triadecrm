/**
 * O seletor de origem do lote: quais fontes entram na lista.
 *
 * A pergunta não é "esta fonte está ligada?" — a fonte do Maps nasce DESLIGADA,
 * porque ninguém raspa de dentro do CRM (`is_enabled = false` é o que faz
 * `public.esteira_abrir_lote` recusar `p_kind = 'coleta'`, e só esse caso). É
 * "esta fonte entra por arquivo que uma pessoa sobe?".
 */
import { describe, expect, it } from 'vitest';

import { ehEntradaPorArquivo } from './tipos';

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
