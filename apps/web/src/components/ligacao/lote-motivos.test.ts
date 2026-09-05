import { describe, expect, it } from 'vitest';

import {
  motivoDaExclusao,
  MOTIVOS_FORA_DO_CASO_DA_PREVIA,
  MOTIVOS_INVISIVEIS_A_PREVIA,
  type LeituraDaPrevia,
} from './consultas';
import { MENSAGENS_DE_EXCLUSAO, type MotivoDeExclusao } from './tipos';

/**
 * A prévia repete no cliente as regras de `app.call_candidates`, e repetição de regra
 * só é honesta enquanto alguém compara as duas. Estes testes comparam:
 *
 *  * a ORDEM dos motivos é a da gravidade, a mesma do `case` da migração
 *    20260904001500 — quem pediu para não ser procurado é nomeado antes de tudo;
 *  * o que a prévia NÃO consegue avaliar está declarado, e não esquecido: é o defeito
 *    §3.12a do laudo (a `suppression_list` é guardada por hash, fora do alcance da
 *    tela, e por isso o número da prévia é um teto e não uma promessa).
 */

function leitura(parcial: Partial<LeituraDaPrevia> = {}): LeituraDaPrevia {
  return {
    naoContatar: false,
    temTelefone: true,
    negocioAberto: true,
    bloqueadoParaSempre: false,
    emEspera: false,
    reservadaEmOutroLote: false,
    ...parcial,
  };
}

describe('motivoDaExclusao', () => {
  it('quem não tem nada contra entra', () => {
    expect(motivoDaExclusao(leitura())).toBeNull();
  });

  it('nomeia cada motivo que a prévia consegue ver', () => {
    expect(motivoDaExclusao(leitura({ naoContatar: true }))).toBe('nao_contatar');
    expect(motivoDaExclusao(leitura({ temTelefone: false }))).toBe('sem_telefone');
    expect(motivoDaExclusao(leitura({ negocioAberto: false }))).toBe('sem_negocio_aberto');
    expect(motivoDaExclusao(leitura({ emEspera: true }))).toBe('em_janela_de_recontato');
    expect(motivoDaExclusao(leitura({ bloqueadoParaSempre: true }))).toBe('em_janela_de_recontato');
    expect(motivoDaExclusao(leitura({ reservadaEmOutroLote: true }))).toBe(
      'reservado_em_outro_lote',
    );
  });

  it('a ordem é a da GRAVIDADE: "não contatar" ganha de tudo o que vem depois', () => {
    // O opt-out fecha o negócio (`app.consent_apply`), então os dois motivos valem ao
    // mesmo tempo — e o que a tela mostra tem de ser o que responde por LGPD.
    const tudoErrado = leitura({
      naoContatar: true,
      temTelefone: false,
      negocioAberto: false,
      emEspera: true,
      reservadaEmOutroLote: true,
    });
    expect(motivoDaExclusao(tudoErrado)).toBe('nao_contatar');
  });

  it('sem telefone vem antes de sem negócio aberto, e a espera antes da reserva', () => {
    expect(motivoDaExclusao(leitura({ temTelefone: false, negocioAberto: false }))).toBe(
      'sem_telefone',
    );
    expect(motivoDaExclusao(leitura({ emEspera: true, reservadaEmOutroLote: true }))).toBe(
      'em_janela_de_recontato',
    );
  });
});

describe('o que a prévia não enxerga está declarado (laudo §3.12a)', () => {
  /** Todos os motivos que existem: as chaves do mapa de mensagens são exaustivas. */
  const TODOS = Object.keys(MENSAGENS_DE_EXCLUSAO) as MotivoDeExclusao[];

  /** Tudo que o `case` da prévia consegue produzir, varrendo as seis leituras. */
  const PRODUZIDOS = new Set(
    (
      [
        leitura({ naoContatar: true }),
        leitura({ temTelefone: false }),
        leitura({ negocioAberto: false }),
        leitura({ emEspera: true }),
        leitura({ bloqueadoParaSempre: true }),
        leitura({ reservadaEmOutroLote: true }),
      ] as LeituraDaPrevia[]
    )
      .map(motivoDaExclusao)
      .filter((m): m is MotivoDeExclusao => m !== null),
  );

  it('cada motivo do catálogo está em exatamente um dos três lugares', () => {
    for (const motivo of TODOS) {
      const onde = [
        PRODUZIDOS.has(motivo),
        MOTIVOS_INVISIVEIS_A_PREVIA.includes(motivo),
        MOTIVOS_FORA_DO_CASO_DA_PREVIA.includes(motivo),
      ].filter(Boolean).length;

      // Zero = motivo novo que ninguém ensinou a prévia a tratar, e a tela passaria a
      // prometer um número que o banco não entrega, em silêncio. Dois = a declaração
      // contradiz o código.
      expect(onde, `motivo "${motivo}"`).toBe(1);
    }
  });

  it('a supressão continua sendo o ponto cego conhecido — é por isso que a tela diz "no máximo"', () => {
    expect(MOTIVOS_INVISIVEIS_A_PREVIA).toContain('suprimido');
    expect(PRODUZIDOS.has('suprimido')).toBe(false);
  });
});

describe('os rótulos de exclusão não trazem número escrito à mão (laudo §3.10)', () => {
  /**
   * Cada rótulo é impresso COLADO a um número calculado — "4 sem telefone" na prévia e
   * no recibo da montagem. `sem_telefone` trazia, além disso, um parêntese digitado à
   * mão: "(34 dos 100 da base)". Quem lê um número medido ao lado de um número
   * inventado acredita nos dois, e este ficaria em "34 de 100" para sempre — a base
   * cresce pelo Radar e pela importação. No dia da varredura ele já estava errado.
   *
   * A única sequência de dígitos que um rótulo pode carregar é o id de um requisito
   * (RF-FUN-13), que não é quantidade e não envelhece.
   */
  it('nenhum rótulo tem dígito que não seja id de requisito', () => {
    for (const [motivo, frase] of Object.entries(MENSAGENS_DE_EXCLUSAO)) {
      const semRequisito = frase.replace(/\bRF-[A-Z]{3}-\d{2}\b/g, '');
      expect(semRequisito, `rótulo de "${motivo}": ${frase}`).not.toMatch(/\d/);
    }
  });
});
