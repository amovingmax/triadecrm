'use client';

import { useSyncExternalStore } from 'react';

/**
 * A notificação do sistema, pela Notification API do navegador.
 *
 * SEM SERVICE WORKER, E É ESCOLHA. O aviso vale enquanto o CRM estiver aberto em
 * alguma aba — inclusive escondida, em segundo plano. Avisar com o CRM fechado
 * exigiria push: uma assinatura por aparelho e um disparo no instante em que a
 * mensagem é gravada, que é justamente o caminho de entrada do WhatsApp. Com o
 * CRM fechado continua valendo o e-mail de aviso do worker-wa.
 *
 * O PREÇO: o Chrome do Android e o Safari do iPhone só mostram notificação a
 * partir de um service worker. Lá `new Notification` lança erro ou não existe,
 * `mostrarAviso` devolve `false`, e quem chama cai no aviso de dentro do CRM. No
 * celular valem o número na barra e o aviso na tela.
 */

/**
 * `a_pedir` é o estado de fábrica: o navegador só mostra a pergunta dele depois
 * de um clique da pessoa. `sem_suporte` é também o que o servidor renderiza.
 */
export type Permissao = 'sem_suporte' | 'a_pedir' | 'liberada' | 'bloqueada';

function temSuporte(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permissaoAtual(): Permissao {
  if (!temSuporte()) return 'sem_suporte';
  switch (Notification.permission) {
    case 'granted':
      return 'liberada';
    case 'denied':
      return 'bloqueada';
    default:
      return 'a_pedir';
  }
}

const ouvintes = new Set<() => void>();

function avisarOuvintes(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

function inscrever(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  // A permissão também muda por fora, nas configurações do navegador. Nem todo
  // navegador conta quando isso acontece; onde conta, a tela acompanha.
  let estado: PermissionStatus | null = null;
  let saiu = false;
  if (typeof navigator !== 'undefined' && navigator.permissions) {
    navigator.permissions
      .query({ name: 'notifications' })
      .then((resposta) => {
        if (saiu) return;
        estado = resposta;
        resposta.addEventListener('change', ouvinte);
      })
      .catch(() => undefined);
  }
  return () => {
    saiu = true;
    ouvintes.delete(ouvinte);
    estado?.removeEventListener('change', ouvinte);
  };
}

const noServidor = (): Permissao => 'sem_suporte';

export function usePermissao(): Permissao {
  return useSyncExternalStore(inscrever, permissaoAtual, noServidor);
}

/** Precisa nascer de um clique: fora de um gesto, Safari e Firefox recusam em silêncio. */
export async function pedirPermissao(): Promise<Permissao> {
  if (!temSuporte()) return 'sem_suporte';
  try {
    await Notification.requestPermission();
  } catch {
    // Navegador antigo, só com a forma de callback: fica como estava.
  }
  avisarOuvintes();
  return permissaoAtual();
}

/**
 * Mostra a notificação. Devolve `false` quando não mostrou — sem permissão, sem
 * suporte, ou num navegador que exige service worker — para quem chama avisar de
 * outro jeito.
 */
export function mostrarAviso({
  titulo,
  corpo,
  marca,
  aoClicar,
}: {
  titulo: string;
  corpo: string;
  /** Avisos com a mesma marca se substituem: duas abas abertas não empilham dois. */
  marca: string;
  aoClicar: () => void;
}): boolean {
  if (permissaoAtual() !== 'liberada') return false;
  try {
    const aviso = new Notification(titulo, {
      body: corpo,
      tag: marca,
      icon: '/icons/icon-192.png',
      lang: 'pt-BR',
    });
    aviso.onclick = () => {
      window.focus();
      aoClicar();
      aviso.close();
    };
    return true;
  } catch {
    return false;
  }
}
