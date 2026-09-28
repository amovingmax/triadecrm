import { describe, expect, it } from 'vitest';

import { placarDoFeed, resumoDoQueAconteceu, ROTULO_DO_MODELO } from './automaticas-formatos';
import { ehAbaDaEsquerda, urlDoEstado, FILTROS_VAZIOS } from './tipos';

/**
 * A aba "Automáticas" (migração 20261002190000).
 *
 * Rafael, 28/09/2026: "onde e como vemos as mensagens que foram enviadas
 * automáticas? deixe isso organizado". A mensagem automática era distinguível
 * dentro da conversa e invisível fora dela.
 *
 * O que estes testes cercam é o que pode quebrar sem ninguém ver: a aba existir
 * como estado de URL (senão o link de Ajustes cai numa aba desconhecida), e o
 * resumo do que aconteceu depois — que é a razão de a tela não ser um log.
 */

describe('a aba existe como estado da tela', () => {
  it('é uma aba da esquerda, então o link de Ajustes não cai num estado desconhecido', () => {
    expect(ehAbaDaEsquerda('automaticas')).toBe(true);
  });

  it('sobrevive à URL, que é como o link de Ajustes → Atendimento chega aqui', () => {
    expect(urlDoEstado(FILTROS_VAZIOS, null, 'automaticas')).toBe('?aba=automaticas');
  });
});

describe('resumoDoQueAconteceu', () => {
  // "Não saiu" NÃO vem das duas colunas de depois: vem da entrega, que é outra
  // coluna. Uma mensagem que a Meta recusou não "não foi respondida" — ela nunca
  // chegou a existir para o lead, e dizer "ninguém respondeu" mandaria a pessoa
  // procurar o defeito no lugar errado.
  it('a entrega falhada vem antes de tudo: o lead nem viu a mensagem', () => {
    const r = resumoDoQueAconteceu({ entrega: 'failed', respondeuEm: null, genteFalouEm: null });
    expect(r.texto).toBe('Não saiu');
    expect(r.alerta).toBe(true);
  });

  it('respondeu e ninguém falou é o ÚNICO caso em que alguém precisa agir', () => {
    const r = resumoDoQueAconteceu({
      entrega: 'sent',
      respondeuEm: '2026-09-28T12:01:00-03:00',
      genteFalouEm: null,
    });
    expect(r.texto).toBe('Respondeu e ninguém falou ainda');
    expect(r.alerta).toBe(true);
  });

  it('respondeu e alguém assumiu é o fluxo funcionando, e não pede tom de alerta', () => {
    const r = resumoDoQueAconteceu({
      entrega: 'delivered',
      respondeuEm: '2026-09-28T12:01:00-03:00',
      genteFalouEm: '2026-09-28T12:02:00-03:00',
    });
    expect(r.texto).toBe('Respondeu, e alguém assumiu');
    expect(r.alerta).toBe(false);
  });

  it('ninguém respondeu não é alerta: a maior parte das automáticas morre aí, e isso é normal', () => {
    const r = resumoDoQueAconteceu({ entrega: 'sent', respondeuEm: null, genteFalouEm: null });
    expect(r.texto).toBe('Ninguém respondeu');
    expect(r.alerta).toBe(false);
  });

  it('alguém falou sem o lead ter respondido ainda é alguém assumindo o fio', () => {
    // Acontece quando o atendente abre a conversa e continua por conta própria,
    // sem esperar. Não é alerta, e chamar isso de "ninguém respondeu" apagaria o
    // trabalho que a pessoa fez.
    const r = resumoDoQueAconteceu({
      entrega: 'sent',
      respondeuEm: null,
      genteFalouEm: '2026-09-28T12:02:00-03:00',
    });
    expect(r.texto).toBe('Alguém assumiu o fio');
    expect(r.alerta).toBe(false);
  });
});

describe('ROTULO_DO_MODELO', () => {
  it('nomeia a introdução pelo que ela é no fluxo, e não pelo código do modelo', () => {
    // "GEN-SYS-INTRO" não diz nada para quem atende. O Rafael abre esta tela
    // para conferir o fluxo novo — campanha, resposta, introdução —, e o rótulo
    // tem de falar dele.
    expect(ROTULO_DO_MODELO['GEN-SYS-INTRO']).toBe('Introdução automática (2ª mensagem)');
  });

  it('devolve undefined para um modelo que ele não conhece, e a tela cai no nome do banco', () => {
    expect(ROTULO_DO_MODELO['GEN-SYS-QUALQUER-COISA-NOVA']).toBeUndefined();
  });
});

describe('placarDoFeed', () => {
  // Rafael perguntou DUAS coisas: "onde e como vemos as mensagens que foram
  // enviadas automáticas?" — a lista responde — e "como tá esse processo?", que
  // a lista só responde se a pessoa contar pastilha por pastilha. Com o teto de
  // 200 linhas do feed isso não é leitura, é trabalho. O placar responde a
  // segunda pergunta antes da rolagem.
  const linha = (entrega: string | null, respondeuEm: string | null, genteFalouEm: string | null) =>
    ({
      entrega,
      respondeu_em: respondeuEm,
      gente_falou_em: genteFalouEm,
    }) as Parameters<typeof placarDoFeed>[0][number];

  it('conta as quatro coisas que a pessoa quer saber antes de rolar', () => {
    const p = placarDoFeed([
      linha('sent', '2026-09-28T12:01:00-03:00', null), // respondeu, ninguém falou
      linha('sent', '2026-09-28T12:01:00-03:00', '2026-09-28T12:05:00-03:00'), // assumida
      linha('sent', null, null), // ninguém respondeu
      linha('failed', null, null), // não saiu
      linha('sent', null, '2026-09-28T12:05:00-03:00'), // alguém assumiu sozinho
    ]);
    expect(p.sairam).toBe(5);
    expect(p.responderam).toBe(2);
    expect(p.esperando).toBe(1);
    expect(p.naoSairam).toBe(1);
  });

  // O placar NÃO reimplementa a regra: ele conta o que `resumoDoQueAconteceu`
  // decidiu. Se contasse por conta própria, o dia em que a regra mudasse (a
  // entrega falhada vindo antes das duas colunas, por exemplo) o número e a
  // pastilha passariam a dizer coisas diferentes na mesma tela — e aí ninguém
  // acredita em nenhum dos dois.
  it('a mensagem que não saiu não conta como respondida, igual à pastilha', () => {
    const p = placarDoFeed([linha('failed', '2026-09-28T12:01:00-03:00', null)]);
    expect(p.naoSairam).toBe(1);
    expect(p.responderam).toBe(0);
    expect(p.esperando).toBe(0);
  });

  it('feed vazio não inventa número', () => {
    expect(placarDoFeed([])).toEqual({ sairam: 0, responderam: 0, esperando: 0, naoSairam: 0 });
  });
});
