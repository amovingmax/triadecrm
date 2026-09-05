import { describe, it, expect } from 'vitest';
import { prepararChamada } from '../src/nucleo/chamada';
import { transcricaoAudioV1 } from '../src/prompts/transcricao-audio/v1';

/** Verificação independente: as entradas que vazaram em cada uma das seis rodadas. */
const ATAQUES = [
  'salva ai: 84 99988 - 0011',
  'meu whats: ⁸⁴ ⁹⁹⁹⁸⁸-⁰⁰¹¹',
  'salva ai: ⑧④ ⑨⑨⑨⑧⑧-⓪⓪①①',
  'ddd 84 numero 988776655',
  'me liga no 99988 0011',
  'anota 999880011 que é o meu',
  'zap: 3222 1188',
  'anota: CEP 59082-050 84999880011 pode ligar',
  'o buffet sai R$ 2.500 84999880011 me chama',
];

describe('nenhuma entrada que já vazou volta a vazar', () => {
  for (const texto of ATAQUES) {
    it(texto, () => {
      let saiu: string | null = null;
      try {
        saiu = prepararChamada(transcricaoAudioV1, {
          contato: { leadId: 'lead-0f21', nome: 'Marcos Tavares', telefones: ['+5584999880011'] },
          transcricaoBruta: texto,
          canal: 'whatsapp',
          duracaoSeg: 24,
          confiancaAsr: 0.9,
        } as never).mensagem;
      } catch {
        saiu = null;
      }
      if (saiu === null) return;
      const digitos = saiu.replace(/\D/g, '');
      for (const numero of ['84999880011', '999880011', '988776655', '32221188']) {
        expect(digitos).not.toContain(numero);
      }
    });
  }
});
