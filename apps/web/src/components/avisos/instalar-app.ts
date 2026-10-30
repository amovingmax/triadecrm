'use client';

import { useSyncExternalStore } from 'react';

/**
 * Instalar o Tríade no computador (30/10/2026).
 *
 * É o que troca o "Chrome" do aviso pelo nome e pelo ícone do Tríade: desde o
 * Chrome 152, no Mac, o CRM instalado como app aparece como um app à parte na
 * Central de Notificações. O Mac pede a permissão de novo para ele; a que foi dada
 * ao site no Chrome não vale para o app.
 *
 * Só no computador. No celular o caminho é outro (o app em `apps/app`), e guardar o
 * evento lá tiraria a sugestão de instalar do próprio navegador.
 */

/** O evento do Chrome. Não está no tipo padrão do navegador, por ser só do Chromium. */
type PedidoDeInstalar = Event & { prompt: () => Promise<unknown> };

let pedido: PedidoDeInstalar | null = null;
const ouvintes = new Set<() => void>();

function avisarOuvintes(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

// No carregamento do módulo, e não num efeito: o Chrome pode disparar o evento antes
// de a tela hidratar, e ele não se repete.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (evento) => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    evento.preventDefault();
    pedido = evento as PedidoDeInstalar;
    avisarOuvintes();
  });
  window.addEventListener('appinstalled', () => {
    pedido = null;
    avisarOuvintes();
  });
}

function inscrever(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** O navegador oferece a instalação agora? Some depois de instalado. */
export function useDaParaInstalar(): boolean {
  return useSyncExternalStore(
    inscrever,
    () => pedido !== null,
    () => false,
  );
}

/** Abre a pergunta do navegador. Precisa nascer de um clique, e só vale uma vez. */
export async function instalarApp(): Promise<void> {
  const atual = pedido;
  if (!atual) return;
  pedido = null;
  avisarOuvintes();
  await atual.prompt();
}
