import { describe, expect, it } from 'vitest';

import {
  compromissoVencido,
  faixaDoScore,
  leituraVaziaDemais,
  ordenarSinais,
  rotuloDaIntencao,
  rotuloDoAlerta,
  rotuloDoSinal,
  type SinalDaLeitura,
} from './leitura-da-ia-formatos';

/**
 * O que estes testes protegem, e por que cada um existe:
 *
 * 1. **A ordem da evidência é o argumento.** Quem abre "Por quê" quer saber o que
 *    pesa contra antes do que pesa a favor — é o que muda o dia de quem lê.
 * 2. **Vocabulário de banco não vaza para a tela.** `sumiu_apos_preco` em caixa
 *    baixa com sublinhado é o tipo de coisa que faz uma ferramenta parecer não
 *    terminada; e sinal novo do prompt tem de sair legível mesmo sem rótulo.
 * 3. **Conversa curta não ganha dossiê.** Mostrar "score 12, dados insuficientes"
 *    gasta a mesma altura de uma leitura de verdade para dizer que não há leitura.
 * 4. **Vencido é só o que tem prazo e passou.** Compromisso sem prazo não pode
 *    aparecer cobrado — a IA não chuta data (`app.ia_prazo`), e a tela não inventa
 *    o que ela não chutou.
 */

const sinal = (
  tipo: string,
  polaridade: 'positivo' | 'negativo',
  forca: 'forte' | 'fraco',
): SinalDaLeitura => ({ tipo, polaridade, forca, messageId: 'm1', trecho: '' });

describe('a ordem em que a evidência aparece', () => {
  it('põe o que pesa contra antes do que pesa a favor, e o forte antes do fraco', () => {
    const ordenados = ordenarSinais([
      sinal('pediu_proposta', 'positivo', 'forte'),
      sinal('respostas_curtas', 'negativo', 'fraco'),
      sinal('urgencia', 'positivo', 'fraco'),
      sinal('objecao_preco', 'negativo', 'forte'),
    ]);

    expect(ordenados.map((s) => s.tipo)).toEqual([
      'objecao_preco',
      'respostas_curtas',
      'pediu_proposta',
      'urgencia',
    ]);
  });

  it('não altera a lista que recebeu', () => {
    const original = [sinal('urgencia', 'positivo', 'fraco'), sinal('vou_pensar', 'negativo', 'forte')];
    ordenarSinais(original);
    expect(original.map((s) => s.tipo)).toEqual(['urgencia', 'vou_pensar']);
  });
});

describe('o vocabulário do banco não chega à tela', () => {
  it('traduz os sinais que o prompt conhece', () => {
    expect(rotuloDoSinal('sumiu_apos_preco')).toBe('sumiu depois do preço');
    expect(rotuloDoSinal('informou_volume')).toBe('informou quantas pessoas');
  });

  it('e um sinal que ninguém rotulou ainda sai legível, não sai cru', () => {
    // `packages/prompts` pode ganhar um sinal amanhã; a tela não pode ficar com
    // sublinhado no meio da frase por causa disso.
    expect(rotuloDoSinal('pediu_visita_tecnica')).toBe('pediu visita tecnica');
  });

  it('traduz as três intenções que o CRM Inteligente acrescentou', () => {
    expect(rotuloDaIntencao('PEDIU_PROPOSTA')).toBe('pediu proposta');
    expect(rotuloDaIntencao('PRONTO_PARA_FECHAR')).toBe('pronto para fechar');
  });

  it('e as 25 do R08 continuam com a frase que já era delas', () => {
    expect(rotuloDaIntencao('QUER_SABER_MAIS')).toBe('quer entender melhor');
    expect(rotuloDaIntencao('OPT_OUT')).toBe('pediu para não receber mais');
  });

  it('intenção desconhecida não vira texto em caixa alta na tela', () => {
    expect(rotuloDaIntencao('INVENTADA_PELO_MODELO')).toBeNull();
    expect(rotuloDaIntencao(null)).toBeNull();
  });

  it('os alertas também têm frase', () => {
    expect(rotuloDoAlerta('risco_perda')).toBe('risco de perder');
    expect(rotuloDoAlerta('coisa_nova')).toBe('coisa nova');
  });
});

describe('a faixa do score', () => {
  it('segue a rubrica do prompt, e as bordas são as dele', () => {
    expect(faixaDoScore(85)).toBe('quer_fechar');
    expect(faixaDoScore(80)).toBe('quer_fechar');
    expect(faixaDoScore(79)).toBe('engajado');
    expect(faixaDoScore(60)).toBe('engajado');
    expect(faixaDoScore(59)).toBe('interesse');
    expect(faixaDoScore(40)).toBe('interesse');
    expect(faixaDoScore(39)).toBe('vago');
    expect(faixaDoScore(20)).toBe('vago');
    expect(faixaDoScore(19)).toBe('sem_interesse');
    expect(faixaDoScore(0)).toBe('sem_interesse');
  });

  it('sem score, sem faixa — e a tela não inventa uma', () => {
    expect(faixaDoScore(null)).toBeNull();
  });
});

describe('quando a leitura não vale a tela', () => {
  it('conversa curta, sem sinal nenhum, não vira dossiê', () => {
    expect(
      leituraVaziaDemais({ dadosInsuficientes: true, resumo: 'Oi.', sinais: [] }),
    ).toBe(true);
  });

  it('mas dado insuficiente COM sinal continua valendo: o sinal é o que se confere', () => {
    expect(
      leituraVaziaDemais({
        dadosInsuficientes: true,
        resumo: 'Perguntou o preço e sumiu.',
        sinais: [sinal('sumiu_apos_preco', 'negativo', 'forte')],
      }),
    ).toBe(false);
  });
});

describe('o compromisso vencido', () => {
  const agora = new Date('2026-09-18T12:00:00-03:00');

  it('é o que tem prazo passado e continua aberto', () => {
    expect(compromissoVencido('2026-09-17T10:00:00-03:00', 'aberto', agora)).toBe(true);
  });

  it('não é o que ainda tem prazo', () => {
    expect(compromissoVencido('2026-09-19T10:00:00-03:00', 'aberto', agora)).toBe(false);
  });

  it('não é o que já foi cumprido, mesmo com prazo passado', () => {
    expect(compromissoVencido('2026-09-17T10:00:00-03:00', 'cumprido', agora)).toBe(false);
  });

  it('e não é o que não tem prazo: a IA não chuta data, e a tela não cobra o que ela não disse', () => {
    expect(compromissoVencido(null, 'aberto', agora)).toBe(false);
  });

  it('prazo que não é data não vira cobrança', () => {
    expect(compromissoVencido('sexta que vem', 'aberto', agora)).toBe(false);
  });
});
