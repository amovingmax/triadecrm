import { describe, expect, it } from 'vitest';

import { CATALOGO, VIGENTES, obterPrompt, promptVigente } from '../src/index';

/**
 * `triagem-do-radar` — e a razão de existir uma v2.
 *
 * A v1 já devolvia `categoriaSugerida`, e o CRM jogava fora. Quando a coluna
 * passou a existir (migração 20261001150000), a gravação ficou sendo: casar o
 * nome devolvido contra `public.categories` por `app.chave_catalogo`, **só o
 * que casar exato**. E aí o único exemplo do prompt virou o problema — ele
 * devolvia `'Locais'` e `'Alimentos e Bebidas'`, que são nomes de GRUPO e não
 * de categoria. Exemplo vale mais que instrução: a v1 treinava o modelo a
 * produzir string que nunca casa, e o resultado seria a categoria sempre nula,
 * em silêncio, com a conta paga do mesmo jeito.
 *
 * Este arquivo prende as duas coisas que a v2 promete, em forma que falha se
 * alguém escrever uma v3 desatenta.
 */

/**
 * As categorias reais do catálogo (`supabase/seed.sql`).
 *
 * Elas estão escritas aqui de propósito: o eval não lê o banco, e é esta lista
 * que torna o teste capaz de dizer "o exemplo devolve algo que não existe".
 */
const CATEGORIAS_REAIS = [
  'Buffet adulto/corporativo',
  'Churrasqueiro, espetinho, food truck',
  'Bar, drinks, chopp',
  'Doces, bolos, confeitaria',
  'Buffet infantil / casa de festas infantil',
  'Som, iluminação e DJ com estrutura',
  'Tendas, estruturas, palcos',
  'Mobiliário, louças, utensílios',
  'Audiovisual/LED, geradores, banheiros químicos',
  'Fotografia e vídeo',
  'DJs, bandas e músicos',
  'Decoração e flores',
  'Celebrante, beleza, convites, transfer, segurança, staff',
  'Locais: salões, chácaras, hotéis, restaurantes, praia',
  'Recreadores e animadores',
  'Locação de brinquedos e infláveis',
  'Cerimonialistas / assessorias',
  'Empresas de formatura',
  'Produtoras corporativas/shows e organizadores recorrentes',
] as const;

/** A mesma normalização de `app.chave_catalogo`: sem acento, sem caixa, sem pontuação. */
function chaveCatalogo(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const REAIS = new Set(CATEGORIAS_REAIS.map(chaveCatalogo));

describe('triagem-do-radar@v2', () => {
  const v2 = obterPrompt('triagem-do-radar', 2);

  it('é a versão vigente: a v1 ensinava a resposta errada', () => {
    expect(VIGENTES['triagem-do-radar']).toBe(2);
    expect(promptVigente('triagem-do-radar')).toBe(v2);
  });

  it('a v1 continua no catálogo, para voltar trocando um número', () => {
    expect(CATALOGO['triagem-do-radar'][1].versao).toBe(1);
  });

  it('toda categoria sugerida nos exemplos EXISTE no catálogo, letra por letra', () => {
    const sugeridas = v2.exemplos
      .flatMap((e) => e.saida.vereditos)
      .map((v) => v.categoriaSugerida)
      .filter((c): c is string => c !== null);

    expect(sugeridas.length).toBeGreaterThan(0);
    for (const c of sugeridas) {
      // É esta asserção que teria pegado a v1: 'Locais' e 'Alimentos e Bebidas'
      // são nomes de GRUPO, e a gravação descarta o que não casa exato.
      expect(REAIS.has(chaveCatalogo(c)), `“${c}” não é categoria do catálogo`).toBe(true);
    }
  });

  it('a v1 tinha o defeito — e é por isso que ela não é mais a vigente', () => {
    const daV1 = obterPrompt('triagem-do-radar', 1)
      .exemplos.flatMap((e) => e.saida.vereditos)
      .map((v) => v.categoriaSugerida)
      .filter((c): c is string => c !== null);

    expect(daV1.some((c) => !REAIS.has(chaveCatalogo(c)))).toBe(true);
  });

  it('as categorias da entrada de exemplo também são as de verdade', () => {
    for (const exemplo of v2.exemplos) {
      for (const c of exemplo.entrada.categorias) {
        expect(REAIS.has(chaveCatalogo(c)), `“${c}” não é categoria do catálogo`).toBe(true);
      }
    }
  });

  it('o rótulo da fonte chega ao modelo, e a mensagem o mostra', () => {
    const exemplo = v2.exemplos[0]!;
    const mensagem = v2.montarMensagem(exemplo.entrada);
    // A v1 mandava `categoriaDaFonte: null` FIXO do banco. Para a pergunta de
    // categoria, o rótulo é metade da resposta.
    expect(mensagem).toContain('Loja de Presentes');
    expect(mensagem).toContain('PICMIMOS');
  });

  it('o sistema manda copiar a categoria inteira, e diz que o rótulo é pista', () => {
    expect(v2.sistema).toContain('LETRA POR LETRA');
    expect(v2.sistema).toContain('vale o nome');
  });

  it('nenhum contato viaja: o que o modelo lê é nome, rótulo e lugar', () => {
    const campos = Object.keys(
      (v2.exemplos[0]!.entrada.candidatos as Record<string, unknown>[])[0]!,
    );
    expect(campos.sort()).toEqual([
      'bairro',
      'categoriaDaFonte',
      'categoriaDoCrm',
      'cidade',
      'id',
      'nome',
    ]);
  });
});
