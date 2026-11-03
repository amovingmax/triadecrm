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
 *
 * **Para todo mundo (03/11/2026).** "Só aparece na minha conta": o item dependia só
 * do `beforeinstallprompt`, que é do Chrome e do Edge e nem neles é garantido. Ele
 * não vem no Safari nem no Firefox, não vem antes de a pessoa clicar na página e
 * passar uns 30 segundos nela, e some por um tempo depois que ela recusa a pergunta.
 * Agora o item aparece em todo computador, menos dentro do app já instalado: com o
 * evento guardado ele abre a pergunta do navegador, como antes; sem ele, mostra o
 * passo a passo do navegador que a pessoa usa (`passos-para-instalar.tsx`).
 */

/** O evento do Chrome. Não está no tipo padrão do navegador, por ser só do Chromium. */
type PedidoDeInstalar = Event & { prompt: () => Promise<unknown> };

/** De quem é o passo a passo, quando o navegador não oferece a pergunta dele. */
export type Navegador = 'chrome' | 'edge' | 'safari' | 'outro';

/** `pedido`: o navegador oferece a pergunta dele; o resto é o passo a passo daquele navegador. */
export type ComoInstalar = 'pedido' | Navegador;

let pedido: PedidoDeInstalar | null = null;
let instalou = false;
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
    instalou = true;
    avisarOuvintes();
  });
}

function inscrever(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/**
 * O navegador pela identificação dele. A ordem importa: o Edge e o Opera também
 * dizem "Chrome", e o Chrome também diz "Safari". O iPad se apresenta como Mac,
 * e só os toques o denunciam: lá o caminho é o do celular, não o do Dock.
 */
export function navegadorDoComputador(identificacao: string, toques = 0): Navegador | null {
  if (/Macintosh/.test(identificacao) && toques > 1) return null;
  if (/Edg\//.test(identificacao)) return 'edge';
  if (/OPR\/|Firefox\//.test(identificacao)) return 'outro';
  if (/Chrome\//.test(identificacao)) return 'chrome';
  if (/Macintosh/.test(identificacao) && /Safari\//.test(identificacao)) return 'safari';
  return 'outro';
}

/** Já é o app instalado: a janela do Chrome ou do Edge, ou o app do Dock do Safari. */
function ehOAppInstalado(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function lerComoInstalar(): ComoInstalar | null {
  if (instalou || ehOAppInstalado()) return null;
  if (!window.matchMedia('(pointer: fine)').matches) return null;
  if (pedido) return 'pedido';
  return navegadorDoComputador(navigator.userAgent, navigator.maxTouchPoints);
}

/** Como instalar neste computador; `null` no celular, no app já instalado e no servidor. */
export function useComoInstalar(): ComoInstalar | null {
  return useSyncExternalStore(inscrever, lerComoInstalar, () => null);
}

/** Abre a pergunta do navegador. Precisa nascer de um clique, e só vale uma vez. */
export async function instalarApp(): Promise<void> {
  const atual = pedido;
  if (!atual) return;
  pedido = null;
  avisarOuvintes();
  await atual.prompt();
}
