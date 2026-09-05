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
  // 7ª rodada — o laudo §3.4. As três frases são as que a varredura mediu vazando
  // INTEIRAS em 05/09/2026, com o telefone do cadastro dentro do contexto.
  { rodada: 7, texto: 'anota ai: oito quatro nove nove nove oito oito zero zero um um' },
  {
    rodada: 7,
    texto: 'meu whats e oito quatro nove nove seis quatro cinco seis zero cinco quatro',
  },
  {
    rodada: 7,
    texto: 'liga pra mim, oito-quatro nove nove seis quatro cinco, seis zero cinco quatro',
  },
  { rodada: 7, texto: 'me liga no nove nove nove oito oito zero zero um um' },
  { rodada: 7, texto: '84 nove nove nove oito oito zero zero um um' },
];

/**
 * A tabela de dez palavras, escrita aqui de novo.
 *
 * Um teste que importasse o normalizador do código sob teste provaria só que ele é igual
 * a si mesmo. Este é o terceiro lugar em que ela aparece — na regra, na auditoria e aqui
 * —, e é de propósito: as três podem errar separado.
 */
const FALADO: Readonly<Record<string, string>> = {
  zero: '0', um: '1', uma: '1', dois: '2', duas: '2', tres: '3', quatro: '4',
  cinco: '5', seis: '6', meia: '6', sete: '7', oito: '8', nove: '9',
};

/** Os dígitos da mensagem contando também os que estão escritos por extenso. */
function digitosLidos(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[a-z]+/g, (palavra) => FALADO[palavra] ?? ' ')
    .replace(/[^0-9]/g, '');
}

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
      // E de novo, contando o que foi DITADO: sem esta linha as cinco entradas da
      // 7ª rodada passariam vazias — elas não têm um algarismo dentro (laudo §3.4).
      const lidos = digitosLidos(mensagem);
      for (const numero of PROIBIDOS) {
        expect(lidos).not.toContain(numero);
      }
    });
  }

  it('pelo menos uma chamada foi montada de verdade', () => {
    // Sem isto, um erro de assinatura faria as onze passarem sem verificar nada,
    // que foi exatamente o que aconteceu na primeira escrita deste arquivo.
    expect(montadas).toBeGreaterThan(0);
  });
});
