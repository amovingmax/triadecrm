import { describe, expect, it } from 'vitest';

import { fichaDaConversaV1 } from '../src/prompts/ficha-da-conversa/v1';
import { pulsoDoDiaV1 } from '../src/prompts/pulso-do-dia/v1';
import { prepararChamada } from '../src/nucleo/chamada';
import { verificarSemPii, verificarSemPiiNaConversa } from '../src/nucleo/auditoria-pii';
import { Pseudonimizador } from '../src/nucleo/pseudonimizacao';
import type { PromptVersionado } from '../src/nucleo/versionamento';

/**
 * A ESCALA DA ENTRADA, E O QUE ELA CUSTA DOS DOIS LADOS.
 *
 * ===========================================================================
 * A DECISÃO QUE ESTE ARQUIVO GUARDA (GATE 1, 17/09/2026)
 * ===========================================================================
 * Os quatro prompts antigos leem UMA coisa por chamada. A auditoria de PII foi calibrada
 * nessa escala: janela sem fronteira nenhuma, qualquer corrida de 10 a 13 dígitos que
 * comece por DDD válido. Lá, falso positivo é barato.
 *
 * `ficha-da-conversa` e `pulso-do-dia` leem a **conversa inteira**, e conversa de
 * fornecedor é data, horário, preço e quantidade. Medido no corpus de fornecedor deste
 * repositório (40 mensagens reais, nenhuma com telefone), no caminho real — depois de a
 * regra pseudonimizar —, com a varredura de mensagem: **5 de 40 mensagens barradas
 * sozinhas, 35 de 36 janelas de 5 mensagens e 31 de 31 janelas de 10**. Conversa nenhuma
 * viraria ficha: o guardrail decidia o produto em vez de proteger o dado.
 *
 * A decisão foi `escala: 'conversa'` — a varredura com a fronteira de letra, que atravessa
 * pontuação, espaço, hífen, barra e emoji, mas não atravessa palavra.
 *
 * **Este arquivo mede os dois lados, em número:**
 *
 * 1. o que se ganhou: os exemplos dos dois prompts passam, e cinco mensagens comuns de
 *    fornecedor juntas passam;
 * 2. **o que se perdeu**, em lista literal — telefone com palavra entre os grupos de
 *    dígitos. Se essa lista crescer, alguém afrouxou mais do que foi decidido, e o diff
 *    mostra. Se encolher, alguém consertou, e o diff mostra também.
 *
 * O que NÃO mudou: a regra (`pseudonimizacao.ts`, que conhece a numeração da Anatel)
 * continua mascarando telefone em qualquer escala, e os quatro prompts antigos continuam
 * sendo auditados pela varredura estrita — `escala` omitida é `'mensagem'`.
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
  it('os dois prompts declaram que leem conversa — sem isso, nada disto vale', () => {
    expect(fichaDaConversaV1.escala).toBe('conversa');
    expect(pulsoDoDiaV1.escala).toBe('conversa');
  });

  it('nenhum exemplo dos dois prompts é barrado', () => {
    const exemplos = [fichaDaConversaV1, pulsoDoDiaV1].flatMap((prompt) =>
      prompt.exemplos.map((exemplo) => ({
        prompt: prompt as unknown as PromptQualquer,
        nome: `${prompt.id}: ${exemplo.nome}`,
        entrada: exemplo.entrada,
      })),
    );
    expect(exemplos.length).toBe(5);
    expect(exemplos.filter((e) => barrou(e.prompt, e.entrada)).map((e) => e.nome)).toEqual([]);
  });

  it('cinco mensagens comuns de fornecedor, juntas, passam', () => {
    // Nenhuma tem telefone. Todas são a conversa que a Komune tem todo dia — e as duas do
    // meio eram, sozinhas, barradas pela varredura de mensagem.
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

    expect(barrou(fichaDaConversaV1 as unknown as PromptQualquer, entrada)).toBe(false);
  });

  it('e o telefone que o parceiro escrever continua derrubando a chamada', () => {
    const comTelefone = {
      leadId: 'lead-1',
      agora: '2026-09-17 18:00',
      etapa: null,
      etapasValidas: [],
      responsavel: null,
      temperaturaAtual: null,
      ultimaIntencao: null,
      fichaAnterior: null,
      compromissosAbertos: [],
      mensagens: [
        // Repartido entre duas mensagens: campo a campo não há telefone; é a junção que pega.
        { messageId: 'm1', de: 'parceiro' as const, quando: '10:00', texto: 'meu whats é 84 99988' },
        { messageId: 'm2', de: 'parceiro' as const, quando: '10:01', texto: '0011, pode chamar' },
      ],
      camposVazios: [],
    };
    expect(barrou(fichaDaConversaV1 as unknown as PromptQualquer, comTelefone)).toBe(true);
  });
});

describe('o preço da fronteira de letra, em lista literal', () => {
  const regraMascara = (texto: string): boolean =>
    new Pseudonimizador(CONTATO).proteger(texto) !== texto;

  /**
   * Telefones de verdade, escritos como gente escreve — e como quem quer escapar escreve.
   * Aqui se mede a AUDITORIA sozinha, sobre o texto cru: ela é a segunda camada, e o que
   * importa dela é o que ela pegaria **se a regra tivesse falhado** sobre aquele texto.
   */
  const TELEFONES = [
    ['limpo', '84 99988-0011'],
    ['sem pontuação nenhuma', '84999880011'],
    ['com +55', '+55 84 99988 0011'],
    ['espalhado dígito a dígito', '8 4 9 9 9 8 8 0 0 1 1'],
    ['com caractere invisível entre os dígitos', '8\u200b4\u200b9\u200b9\u200b9\u200b8\u200b8\u200b0\u200b0\u200b1\u200b1'],
    ['com rótulo com letra antes', 'ddd 84 numero 988776655'],
    ['com dígito por extenso', '84 nove 8877 6655'],
    ['com palavra entre os grupos', 'é 84 depois 9 9988 depois 0011'],
  ] as const;

  it('a varredura de mensagem pega todos eles', () => {
    const escaparam = TELEFONES.filter(([, t]) => verificarSemPii(t).length === 0);
    expect(escaparam.map(([nome]) => nome)).toEqual([]);
  });

  it('a da conversa pega todos menos um, e o um está escrito aqui', () => {
    const escaparam = TELEFONES.filter(([, t]) => verificarSemPiiNaConversa(t).length === 0);
    // Este é o preço da decisão do GATE 1, por inteiro. Se esta lista crescer, o que
    // cresceu não foi decidido.
    expect(escaparam.map(([nome]) => nome)).toEqual(['com palavra entre os grupos']);
  });

  /**
   * E por que o preço é pequeno: dos oito, a REGRA — que conhece a numeração da Anatel e
   * roda em qualquer escala — mascara sete antes de a auditoria olhar. O único que ela
   * deixa passar é justamente o mesmo, e é por isso que ele é o preço: para ele chegar ao
   * modelo, as duas camadas têm de falhar, e as duas falham só nesse caso.
   */
  it('a regra, que não mudou, mascara sete dos oito sozinha', () => {
    const escaparamDaRegra = TELEFONES.filter(([, t]) => !regraMascara(t));
    expect(escaparamDaRegra.map(([nome]) => nome)).toEqual(['com palavra entre os grupos']);
  });
});
