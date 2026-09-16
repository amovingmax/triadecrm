import { describe, expect, it } from 'vitest';

import { fichaDaConversaV1 } from '../src/prompts/ficha-da-conversa/v1';
import { pulsoDoDiaV1 } from '../src/prompts/pulso-do-dia/v1';
import { prepararChamada } from '../src/nucleo/chamada';
import type { PromptVersionado } from '../src/nucleo/versionamento';

/**
 * O PREÇO DO GUARDRAIL DE PII QUANDO A ENTRADA É UMA CONVERSA INTEIRA.
 *
 * ===========================================================================
 * O QUE ESTE ARQUIVO MEDE, E POR QUE ELE EXISTE
 * ===========================================================================
 * Os quatro prompts antigos leem UMA coisa por chamada: uma transcrição, uma anotação,
 * uma mensagem. A auditoria de PII foi calibrada nessa escala, e lá o falso positivo é
 * barato — a chamada não sai, uma mensagem fica sem classificar.
 *
 * `ficha-da-conversa` mudou a escala: ela lê a conversa toda. A auditoria corre sobre a
 * **junção** dos trechos de fora (`nucleo/chamada.ts`), colados sem fronteira nenhuma, e
 * a janela dela aceita qualquer corrida de 10 a 13 dígitos que comece por DDD válido.
 * Data, horário, preço e quantidade — o assunto de toda conversa de fornecedor — viram
 * dígito; colados, viram telefone.
 *
 * Medido no corpus de fornecedor deste repositório (40 mensagens reais, nenhuma com
 * telefone), no caminho real — depois de a regra pseudonimizar: **5 de 40 mensagens são
 * barradas sozinhas, 35 de 36 janelas de 5 mensagens e 31 de 31 janelas de 10**. Na
 * prática, com o guardrail de hoje, conversa nenhuma vira ficha.
 *
 * Este arquivo não conserta isso — consertar é decisão de GATE, não de commit. Ele **fixa
 * o número**, para que a decisão apareça no diff no dia em que for tomada:
 *
 * - se alguém afrouxar a auditoria sem decidir, o primeiro teste fica verde sozinho e o
 *   segundo fica vermelho, e é para isso que os dois estão aqui;
 * - se a decisão for tomada, os dois mudam juntos, num commit que diz o que mudou.
 *
 * Ver `docs/ia/GATE-1-crm-inteligente.md`, seção "A decisão que falta".
 */

type PromptQualquer = PromptVersionado<Record<string, unknown>, unknown>;
const CONTATO = { leadId: 'lead-1', nome: null, empresa: null };

function barrou(prompt: PromptQualquer, entrada: unknown): boolean {
  try {
    prepararChamada(prompt, entrada, CONTATO);
    return false;
  } catch {
    return true;
  }
}

describe('a conversa inteira contra a auditoria de PII', () => {
  it('dos exemplos dos dois prompts novos, o barrado hoje é exatamente um', () => {
    const exemplos = [fichaDaConversaV1, pulsoDoDiaV1].flatMap((prompt) =>
      prompt.exemplos.map((exemplo) => ({
        prompt: prompt as unknown as PromptQualquer,
        nome: `${prompt.id}: ${exemplo.nome}`,
        entrada: exemplo.entrada,
      })),
    );
    expect(exemplos.length).toBe(5);

    // Lista literal, para a mudança aparecer no diff. O que barra não é telefone: é
    // "09:40" + "parceiro" + "casamento dia 12/12 para 150", colados, dando dez dígitos
    // que começam por 94 — um DDD do Pará.
    expect(exemplos.filter((e) => barrou(e.prompt, e.entrada)).map((e) => e.nome)).toEqual([
      'ficha-da-conversa: pediu proposta com data e volume',
    ]);
  });

  it('cinco mensagens comuns de fornecedor, juntas, não passam', () => {
    // Nenhuma delas tem telefone. Todas são a conversa que a Komune tem todo dia.
    const conversa = [
      'oi, tudo bem? vi a mensagem de vocês',
      'a formatura é 12/12/2026, às 20h',
      'meu buffet atende até 300 pessoas',
      'cobro R$ 3.500 por evento, com 2 garçons',
      'me chama depois das 14h',
    ];
    const entrada = {
      leadId: 'lead-1',
      agora: '2026-09-17 18:00',
      etapa: 'Em conversa',
      etapasValidas: ['Contatado', 'Respondeu', 'Em conversa'],
      responsavel: 'Rafael',
      temperaturaAtual: 'morno',
      ultimaIntencao: 'QUER_SABER_MAIS',
      fichaAnterior: null,
      compromissosAbertos: [],
      mensagens: conversa.map((texto, i) => ({
        messageId: `m${i + 1}`,
        de: 'parceiro' as const,
        quando: '10:00',
        texto,
      })),
      camposVazios: [],
    };

    expect(barrou(fichaDaConversaV1 as unknown as PromptQualquer, entrada)).toBe(true);
  });
});
