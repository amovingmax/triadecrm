import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

/**
 * O clique no aviso, em `public/sw-avisos.js`. O arquivo roda no navegador, fora do
 * build; aqui ele roda de verdade, com um `self` de mentira. Um clique que não abre
 * nada erra calado: a pessoa clica no aviso e a tela não muda.
 *
 * Também fixa o que ele NÃO pode fazer: escutar requisição ou push.
 */

const CODIGO = readFileSync(join(process.cwd(), 'public/sw-avisos.js'), 'utf8');

type Ouvinte = (evento: unknown) => void;

function carregar(abas: readonly object[]) {
  const ouvintes = new Map<string, Ouvinte>();
  const clients = {
    matchAll: vi.fn().mockResolvedValue(abas),
    openWindow: vi.fn().mockResolvedValue(null),
  };
  const self = {
    clients,
    skipWaiting: vi.fn(),
    addEventListener: (nome: string, ouvinte: Ouvinte) => ouvintes.set(nome, ouvinte),
  };
  runInNewContext(CODIGO, { self });
  return { ouvintes, clients };
}

async function clicar(ouvintes: Map<string, Ouvinte>, data: unknown) {
  const close = vi.fn();
  let espera: Promise<unknown> = Promise.resolve();
  ouvintes.get('notificationclick')?.({
    notification: { close, data },
    waitUntil: (p: Promise<unknown>) => {
      espera = p;
    },
  });
  await espera;
  return { close };
}

const ALVOS = [{ conversaId: 'c-1', organizacaoId: 'org-1' }];

function aba(focus = vi.fn().mockResolvedValue(undefined)) {
  return { focus, postMessage: vi.fn() };
}

describe('o clique no aviso do sistema', () => {
  it('com o CRM aberto: foca a aba e pede a ela para abrir a conversa', async () => {
    const recente = aba();
    const antiga = aba();
    const { ouvintes, clients } = carregar([recente, antiga]);

    const { close } = await clicar(ouvintes, { alvos: ALVOS, destino: '/conversas?org=org-1' });

    expect(close).toHaveBeenCalled();
    expect(recente.focus).toHaveBeenCalled();
    expect(recente.postMessage).toHaveBeenCalledWith({
      tipo: 'triade-aviso-clicado',
      alvos: ALVOS,
    });
    expect(antiga.postMessage).not.toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('conta também a aba aberta antes de ele ser registrado', async () => {
    const { ouvintes, clients } = carregar([aba()]);
    await clicar(ouvintes, { alvos: ALVOS });
    expect(clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
  });

  it('o navegador recusar o foco não impede de abrir a conversa', async () => {
    const recusou = aba(vi.fn().mockRejectedValue(new Error('sem gesto')));
    const { ouvintes } = carregar([recusou]);
    await clicar(ouvintes, { alvos: ALVOS });
    expect(recusou.postMessage).toHaveBeenCalled();
  });

  it('com o CRM fechado depois do aviso: abre direto no destino', async () => {
    const { ouvintes, clients } = carregar([]);
    await clicar(ouvintes, { alvos: ALVOS, destino: '/conversas?org=org-1' });
    expect(clients.openWindow).toHaveBeenCalledWith('/conversas?org=org-1');
  });

  it('sem dados no aviso: vai para Conversas', async () => {
    const { ouvintes, clients } = carregar([]);
    await clicar(ouvintes, null);
    expect(clients.openWindow).toHaveBeenCalledWith('/conversas');
  });
});

describe('o que o service worker não faz', () => {
  it('só escuta instalação e clique: nada de requisição nem de push', () => {
    const { ouvintes } = carregar([]);
    expect([...ouvintes.keys()].sort()).toEqual(['install', 'notificationclick']);
  });
});
