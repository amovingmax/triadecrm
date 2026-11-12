import { describe, expect, it, vi } from 'vitest';

import {
  assuntoDoAcumulo,
  avisarDoAcumulo,
  corpoDoAcumulo,
  linkDaConversa,
  primeiraLinha,
  quemEscreveu,
  type Acumulo,
  type ConversaDoAcumulo,
} from './aviso-por-email';
import { createLogger } from '../lib/log';

/**
 * Desde 11/11/2026 o e-mail só sai quando passam de 30 as mensagens novas sem
 * resposta do time (a conta e a decisão são do banco: migração 20261111100000,
 * pgTAP 144). O que estes testes protegem:
 *
 *  1. **Só manda quando o banco diz que passou do limite.** Nada de e-mail por
 *     mensagem que chega.
 *  2. **O telefone inteiro não sai do CRM.** E-mail é caixa de entrada de gente,
 *     fora da RLS e sem `pii_access_log` (RF-BAS-14): vai o fim do número.
 *  3. **O link abre a conversa certa**, com ficha ou sem.
 *  4. **Nada aqui derruba o laço do worker**: sem chave, com recusa do Resend ou
 *     com a rede caindo, a função devolve `false` (e o worker não registra o
 *     aviso, para tentar de novo).
 */

const logger = createLogger({ worker: 'wa', level: 'error' });

const COM_FICHA: ConversaDoAcumulo = {
  conversationId: 'b0000000-0000-4000-8000-000000000001',
  organizationId: 'c0000000-0000-4000-8000-000000000001',
  nome: 'Buffet Sabor Potiguar',
  finalDoNumero: '4321',
  mensagens: 4,
  ultima: 'Oi! Queria entender como funciona a parceria de vocês',
};

const SEM_FICHA: ConversaDoAcumulo = {
  conversationId: 'b0000000-0000-4000-8000-000000000002',
  organizationId: null,
  nome: null,
  finalDoNumero: '4567',
  mensagens: 1,
  ultima: null,
};

const ACUMULO: Acumulo = {
  mandar: true,
  limite: 30,
  mensagens: 31,
  conversas: 12,
  ate: '2026-11-11T14:00:00.000000-03:00',
  lista: [COM_FICHA, SEM_FICHA],
};

const CONFIG = {
  ativo: true,
  para: ['komune@komune.app.br'],
  de: 'Komune CRM <onboarding@resend.dev>',
  urlDoCrm: 'https://crm.exemplo',
};

describe('o que o e-mail diz', () => {
  it('o assunto conta as mensagens sem resposta', () => {
    expect(assuntoDoAcumulo(ACUMULO)).toBe('WhatsApp: 31 mensagens novas sem resposta');
  });

  it('diz quantas são, em quantas conversas, e quando sai o próximo', () => {
    const corpo = corpoDoAcumulo(ACUMULO, CONFIG.urlDoCrm);
    expect(corpo).toContain('Chegaram 31 mensagens no WhatsApp');
    expect(corpo).toContain('em 12 conversas');
    expect(corpo).toContain('passam de 30');
    expect(corpo).toContain('mais 31 sem resposta');
    expect(corpo).toContain('E mais 10 conversas na tela Conversas.');
    expect(corpo).toContain('Abrir as Conversas: https://crm.exemplo/conversas');
  });

  it('mostra o nome, ou só o fim do número de quem não tem nome', () => {
    expect(quemEscreveu(COM_FICHA)).toBe('Buffet Sabor Potiguar');
    expect(quemEscreveu(SEM_FICHA)).toBe('Número terminado em 4567');
    expect(quemEscreveu({ nome: null, finalDoNumero: null })).toBe('Número sem identificação');
    const corpo = corpoDoAcumulo(ACUMULO, CONFIG.urlDoCrm);
    expect(corpo).toContain('• Buffet Sabor Potiguar: 4 mensagens');
    expect(corpo).toContain('• Número terminado em 4567: 1 mensagem');
  });

  it('mensagem sem texto (áudio, imagem) não vira aspas vazias', () => {
    expect(primeiraLinha(null)).toBe('(sem texto: áudio, imagem ou documento)');
    expect(primeiraLinha('uma\n  linha    só')).toBe('uma linha só');
  });

  it('o link abre a ficha, ou a conversa do cliente sem ficha', () => {
    expect(linkDaConversa(COM_FICHA, CONFIG.urlDoCrm)).toBe(
      `https://crm.exemplo/conversas?org=${COM_FICHA.organizationId}`,
    );
    expect(linkDaConversa(SEM_FICHA, CONFIG.urlDoCrm)).toBe(
      `https://crm.exemplo/conversas?cliente=${SEM_FICHA.conversationId}`,
    );
  });

  it('sem conversa fora da lista, não promete "e mais"', () => {
    const corpo = corpoDoAcumulo({ ...ACUMULO, conversas: 2 }, CONFIG.urlDoCrm);
    expect(corpo).not.toContain('E mais');
  });
});

describe('avisarDoAcumulo', () => {
  function corpoDaChamada(buscar: ReturnType<typeof vi.fn>): Record<string, unknown> {
    return JSON.parse(String((buscar.mock.calls[0]?.[1] as RequestInit).body));
  }

  it('passou do limite: manda um e-mail só, para a lista do time', async () => {
    const buscar = vi.fn(async () => new Response('{}', { status: 200 }));
    const mandou = await avisarDoAcumulo(
      ACUMULO,
      CONFIG,
      'rk_teste',
      logger,
      buscar as unknown as typeof fetch,
    );
    expect(mandou).toBe(true);
    expect(buscar).toHaveBeenCalledTimes(1);
    const corpo = corpoDaChamada(buscar);
    expect(corpo.to).toEqual(['komune@komune.app.br']);
    expect(corpo.subject).toBe('WhatsApp: 31 mensagens novas sem resposta');
    expect(String(corpo.text)).toContain('Buffet Sabor Potiguar');
  });

  it('não passou do limite: não manda nada', async () => {
    const buscar = vi.fn(async () => new Response('{}', { status: 200 }));
    const mandou = await avisarDoAcumulo(
      { ...ACUMULO, mandar: false, mensagens: 30 },
      CONFIG,
      'rk_teste',
      logger,
      buscar as unknown as typeof fetch,
    );
    expect(mandou).toBe(false);
    expect(buscar).not.toHaveBeenCalled();
  });

  it('sem chave, sem destinatário ou desligado: não manda e não quebra', async () => {
    const buscar = vi.fn(async () => new Response('{}', { status: 200 }));
    const chamar = (config: typeof CONFIG, chave: string | undefined) =>
      avisarDoAcumulo(ACUMULO, config, chave, logger, buscar as unknown as typeof fetch);

    // `undefined` explícito: é o worker sem RESEND_API_KEY no ambiente.
    expect(await chamar(CONFIG, undefined)).toBe(false);
    expect(await chamar({ ...CONFIG, ativo: false }, 'rk_teste')).toBe(false);
    expect(await chamar({ ...CONFIG, para: [] }, 'rk_teste')).toBe(false);
    expect(buscar).not.toHaveBeenCalled();
  });

  it('recusa do Resend e rede caindo devolvem false, sem lançar', async () => {
    const recusa = vi.fn(async () => new Response('sem domínio verificado', { status: 403 }));
    expect(
      await avisarDoAcumulo(ACUMULO, CONFIG, 'rk_teste', logger, recusa as unknown as typeof fetch),
    ).toBe(false);

    const caiu = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    expect(
      await avisarDoAcumulo(ACUMULO, CONFIG, 'rk_teste', logger, caiu as unknown as typeof fetch),
    ).toBe(false);
  });
});
