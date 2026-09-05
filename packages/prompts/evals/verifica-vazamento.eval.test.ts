import { describe, expect, it } from 'vitest';

import { prepararChamada } from '../src/nucleo/chamada';
import { transcricaoAudioV1 } from '../src/prompts/transcricao-audio/v1';

/**
 * Verificação independente das seis rodadas adversariais.
 *
 * Cada entrada aqui vazou em alguma versão da pseudonimização, e cada uma foi
 * encontrada por um conferente cujo trabalho era desconfiar da versão anterior.
 * O arquivo existe para que nenhuma delas volte em silêncio.
 *
 * A primeira escrita deste arquivo PASSAVA VAZIA: chamava `prepararChamada` com
 * dois argumentos onde ela pede três, o `parse` do zod estourava, o `catch` engolia
 * e o teste saía cedo dizendo que estava tudo bem. Foi achado por outro agente, não
 * por mim. Por isso a guarda no fim: se nenhuma chamada chegar a ser montada, o
 * arquivo falha em vez de dar um verde que não significa nada.
 */

const TELEFONE_DO_CADASTRO = '+5584999880011';

/** Os dígitos que não podem aparecer na mensagem, em nenhuma arrumação. */
const PROIBIDOS = ['84999880011', '999880011', '988776655', '32221188'] as const;

const ATAQUES: readonly { rodada: number; texto: string }[] = [
  { rodada: 1, texto: 'anota: CEP 59082-050 84999880011 pode ligar' },
  { rodada: 1, texto: 'o buffet sai R$ 2.500 84999880011 me chama' },
  { rodada: 2, texto: 'salva ai: 84 99988 - 0011' },
  { rodada: 2, texto: 'dois contatos: 84 99988 - 0011 / 84 98887 - 7665' },
  { rodada: 3, texto: 'meu whats: ⁸⁴ ⁹⁹⁹⁸⁸-⁰⁰¹¹' },
  { rodada: 3, texto: 'salva ai: ⑧④ ⑨⑨⑨⑧⑧-⓪⓪①①' },
  { rodada: 4, texto: 'ddd 84 numero 988776655' },
  { rodada: 4, texto: 'meu zap e 84 nove 8877 6655' },
  { rodada: 6, texto: 'me liga no 99988 0011' },
  { rodada: 6, texto: 'anota 999880011 que é o meu' },
  { rodada: 6, texto: 'zap: 3222 1188' },
];

/** Quantas chamadas chegaram a ser montadas — a guarda contra o verde vazio. */
let montadas = 0;

describe('nenhuma entrada que já vazou volta a vazar', () => {
  for (const { rodada, texto } of ATAQUES) {
    it(`rodada ${rodada}: ${texto}`, () => {
      let mensagem: string | null;
      try {
        mensagem = prepararChamada(
          transcricaoAudioV1,
          {
            leadId: 'lead-0f21',
            canal: 'whatsapp',
            duracaoSeg: 24,
            transcricaoBruta: texto,
            confiancaAsr: 0.9,
            contexto: null,
          },
          { leadId: 'lead-0f21', nome: 'Marcos Tavares', telefones: [TELEFONE_DO_CADASTRO] },
        ).mensagem;
        montadas += 1;
      } catch {
        // Recusar é desfecho aceito: a chamada não sai, logo nada vaza.
        mensagem = null;
      }

      if (mensagem === null) return;

      const digitos = mensagem.replace(/\D/gu, '');
      for (const numero of PROIBIDOS) {
        expect(digitos).not.toContain(numero);
      }
    });
  }

  it('pelo menos uma chamada foi montada de verdade', () => {
    // Sem isto, um erro de assinatura faria as onze passarem sem verificar nada,
    // que foi exatamente o que aconteceu na primeira escrita deste arquivo.
    expect(montadas).toBeGreaterThan(0);
  });
});
