import { describe, expect, it, vi } from 'vitest';

import {
  assuntoDoAviso,
  avisarPorEmail,
  corpoDoAviso,
  finalDoNumero,
  primeiraLinha,
  quemEscreveu,
  type EntradaParaAviso,
} from './aviso-por-email';
import { createLogger } from '../lib/log';

/**
 * O aviso existe porque o número não toca em celular nenhum (Cloud API, 14/09/2026).
 * O que estes testes protegem:
 *
 *  1. **O telefone inteiro não sai do CRM.** E-mail é caixa de entrada de gente, fora
 *     da RLS e sem `pii_access_log` (RF-BAS-14): vai o fim do número, nunca ele todo.
 *  2. **Um e-mail por lote**, com link que abre a conversa certa — inclusive a aba de
 *     quem ainda não é ficha.
 *  3. **Nada aqui derruba a fila de entrada**: sem chave, com recusa do Resend ou com
 *     a rede caindo, a função devolve `false` e a mensagem do parceiro segue gravada.
 */

const logger = createLogger({ worker: 'wa', level: 'error' });

const COM_FICHA: EntradaParaAviso = {
  ficha: 'Buffet Sabor Potiguar',
  organizationId: 'c0000000-0000-4000-8000-000000000001',
  telefone: '+5584988884321',
  texto: 'Oi! Queria entender como funciona a parceria de vocês',
  opcao: '1',
};

const SEM_FICHA: EntradaParaAviso = {
  ficha: null,
  organizationId: null,
  telefone: '+5584981234567',
  texto: null,
  opcao: null,
};

const CONFIG = {
  ativo: true,
  para: ['komune@komune.app.br'],
  de: 'Komune CRM <onboarding@resend.dev>',
  urlDoCrm: 'https://crm.exemplo',
};

describe('o que o e-mail diz', () => {
  it('mostra só o fim do número de quem não é ficha', () => {
    expect(finalDoNumero('+5584981234567')).toBe('terminado em 4567');
    expect(quemEscreveu(SEM_FICHA)).toBe('Número terminado em 4567');
    expect(quemEscreveu(COM_FICHA)).toBe('Buffet Sabor Potiguar');
    expect(corpoDoAviso([SEM_FICHA], CONFIG.urlDoCrm)).not.toContain('5584981234567');
  });

  it('mensagem sem texto (áudio, imagem) não vira aspas vazias', () => {
    expect(primeiraLinha(null)).toBe('(sem texto: áudio, imagem ou documento)');
    expect(primeiraLinha('uma\n  linha    só')).toBe('uma linha só');
  });

  it('o assunto diz quem escreveu quando é uma; conta quando são várias', () => {
    expect(assuntoDoAviso([COM_FICHA])).toContain('Buffet Sabor Potiguar');
    expect(assuntoDoAviso([COM_FICHA, SEM_FICHA])).toBe('WhatsApp: 2 mensagens novas');
  });

  it('o link abre a ficha, e a aba de fora da base quando não há ficha', () => {
    const corpo = corpoDoAviso([COM_FICHA, SEM_FICHA], CONFIG.urlDoCrm);
    expect(corpo).toContain(`https://crm.exemplo/conversas?org=${COM_FICHA.organizationId}`);
    expect(corpo).toContain('https://crm.exemplo/conversas?aba=fora');
    expect(corpo).toContain('Escolheu no menu: 1');
  });
});

describe('avisarPorEmail', () => {
  function corpoDaChamada(buscar: ReturnType<typeof vi.fn>): Record<string, unknown> {
    return JSON.parse(String((buscar.mock.calls[0]?.[1] as RequestInit).body));
  }

  it('manda um e-mail só, com todas as mensagens do lote', async () => {
    const buscar = vi.fn(async () => new Response('{}', { status: 200 }));
    const mandou = await avisarPorEmail(
      [COM_FICHA, SEM_FICHA],
      CONFIG,
      'rk_teste',
      logger,
      buscar as unknown as typeof fetch,
    );
    expect(mandou).toBe(true);
    expect(buscar).toHaveBeenCalledTimes(1);
    const corpo = corpoDaChamada(buscar);
    expect(corpo.to).toEqual(['komune@komune.app.br']);
    expect(String(corpo.text)).toContain('Buffet Sabor Potiguar');
  });

  it('sem chave, sem destinatário, desligado ou sem mensagem: não manda e não quebra', async () => {
    const buscar = vi.fn(async () => new Response('{}', { status: 200 }));
    const chamar = (config: typeof CONFIG, chave: string | undefined, lote = [COM_FICHA]) =>
      avisarPorEmail(lote, config, chave, logger, buscar as unknown as typeof fetch);

    // `undefined` explícito: é o worker sem RESEND_API_KEY no ambiente.
    expect(await chamar(CONFIG, undefined)).toBe(false);
    expect(await chamar({ ...CONFIG, ativo: false }, 'rk_teste')).toBe(false);
    expect(await chamar({ ...CONFIG, para: [] }, 'rk_teste')).toBe(false);
    expect(await chamar(CONFIG, 'rk_teste', [])).toBe(false);
    expect(buscar).not.toHaveBeenCalled();
  });

  it('recusa do Resend e rede caindo devolvem false, sem lançar', async () => {
    const recusa = vi.fn(async () => new Response('sem domínio verificado', { status: 403 }));
    expect(
      await avisarPorEmail(
        [COM_FICHA],
        CONFIG,
        'rk_teste',
        logger,
        recusa as unknown as typeof fetch,
      ),
    ).toBe(false);

    const caiu = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    expect(
      await avisarPorEmail(
        [COM_FICHA],
        CONFIG,
        'rk_teste',
        logger,
        caiu as unknown as typeof fetch,
      ),
    ).toBe(false);
  });
});
