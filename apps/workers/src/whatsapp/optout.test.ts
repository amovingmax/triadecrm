/**
 * A regra de opt-out é um guardrail, e guardrail se mede pelos dois lados:
 * o que ele PRECISA pegar e o que ele NÃO PODE pegar.
 *
 * O segundo bloco é o que importa mais. Um opt-out perdido é uma mensagem a
 * mais para quem disse não; um falso positivo é um fornecedor suprimido para
 * sempre — e a supressão grava `consent_events`, que é append-only.
 */
import { describe, expect, it } from 'vitest';

import { normalizar, pediuParaSair, TAMANHO_DA_REGRA } from './optout';

describe('normalização', () => {
  it('tira acento, caixa, pontuação e emoji', () => {
    expect(normalizar('NÃO QUERO RECEBER!!! 😡')).toBe('nao quero receber');
    expect(normalizar('  Pare,  por favor. ')).toBe('pare por favor');
    expect(normalizar('Não.')).toBe('nao');
  });

  it('não inventa conteúdo em texto vazio', () => {
    expect(normalizar('')).toBe('');
    expect(normalizar('   ')).toBe('');
    expect(normalizar('👍')).toBe('');
  });
});

describe('as quatro palavras do CLAUDE.md, sozinhas', () => {
  // "Opt-out por regra (palavras como 'sair', 'parar', 'não quero', 'remover')"
  it.each([
    ['sair', 'palavra'],
    ['SAIR', 'palavra'],
    ['Sair.', 'palavra'],
    ['parar', 'palavra'],
    ['PARAR!!', 'palavra'],
    ['remover', 'palavra'],
    ['não quero', 'palavra'],
    ['Não quero.', 'palavra'],
  ])('"%s" é opt-out pela regra da %s sozinha', (texto, regra) => {
    const v = pediuParaSair(texto);
    expect(v.pediu).toBe(true);
    expect(v.regra).toBe(regra);
  });
});

describe('o "opt-out em 1 palavra" do R08 §5.7', () => {
  it.each([
    'pare',
    'para',
    'chega',
    'stop',
    'cancelar',
    'descadastrar',
    'bloquear',
    'remova',
    'sai',
  ])('"%s" sozinho encerra', (texto) => {
    expect(pediuParaSair(texto).pediu).toBe(true);
  });
});

describe('as frases inequívocas, no meio de qualquer texto', () => {
  it.each([
    'Oi, obrigado pelo contato mas não quero receber mais mensagens, valeu',
    'por favor me tira da lista',
    'para de mandar mensagem pra mim',
    'Bom dia. Pode parar, não tenho interesse nenhum.',
    'remove meu numero por gentileza',
    'se continuar eu vou bloquear',
    'não me perturbe mais',
    'apaga meu numero da sua base',
    'quero sair dessa lista de vocês',
  ])('"%s"', (texto) => {
    const v = pediuParaSair(texto);
    expect(v.pediu).toBe(true);
    expect(v.regra).toBe('frase');
    expect(v.evidencia).not.toBeNull();
  });
});

describe('O QUE NÃO PODE DISPARAR — os falsos positivos que custam um fornecedor', () => {
  it.each([
    // A preposição "para": o motivo de a regra 1 exigir a mensagem inteira.
    ['consigo para quinta às 9h30', 'preposição num SIM'],
    ['manda para mim depois', 'preposição'],
    ['pode ser para o dia 20', 'preposição'],
    ['vou ver isso para semana que vem', 'preposição'],
    ['tem algo para fotógrafo?', 'preposição'],
    // "sair" solto: pergunta de interesse, não pedido de saída.
    ['vocês vão sair com o app quando?', 'verbo sair sem pedido'],
    ['vou sair pra um evento agora, te falo depois', 'verbo sair sem pedido'],
    // Sem interesse não é supressão (R08 §1, itens 8 e 9).
    ['não tenho interesse', 'SEM_INTERESSE_FIRME, vira perda com motivo'],
    ['obrigado, mas não', 'SEM_INTERESSE_SUAVE'],
    ['não', 'resposta a uma pergunta'],
    ['agora não é o momento', 'adiamento'],
    ['não é pra mim agora', 'adiamento'],
    // Palavras da lista dentro de outra ideia.
    ['queria cancelar a reunião de quinta, pode ser sexta?', 'reagendar, não sair'],
    ['o buffet remove a taxa de serviço?', 'pergunta comercial'],
    ['não quero atrapalhar, me chama depois', 'educação, não opt-out'],
    ['parabéns pelo trabalho de vocês', 'a palavra "para" dentro de outra'],
  ])('"%s" NÃO é opt-out (%s)', (texto) => {
    expect(pediuParaSair(texto).pediu).toBe(false);
  });
});

describe('bordas', () => {
  it('texto ausente não é opt-out', () => {
    expect(pediuParaSair(null).pediu).toBe(false);
    expect(pediuParaSair(undefined).pediu).toBe(false);
    expect(pediuParaSair('').pediu).toBe(false);
  });

  it('áudio sem legenda não é opt-out: o que está dentro do áudio é da transcrição', () => {
    expect(pediuParaSair(null).regra).toBeNull();
  });

  it('a evidência devolvida é o trecho que disparou, para ir ao consent_events', () => {
    expect(pediuParaSair('por favor me tira da lista').evidencia).toBe('me tira da lista');
    expect(pediuParaSair('SAIR').evidencia).toBe('sair');
  });

  it('a regra conhece um número conhecido de formas', () => {
    // Trava de inventário: mexer na lista sem pensar quebra aqui.
    expect(TAMANHO_DA_REGRA.palavras).toBe(24);
    expect(TAMANHO_DA_REGRA.frases).toBe(65);
  });
});
