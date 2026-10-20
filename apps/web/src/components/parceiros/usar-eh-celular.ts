'use client';

import { useSyncExternalStore } from 'react';

/**
 * `true` abaixo do breakpoint `md` do Tailwind (768px).
 *
 * Existe para as decisões que o CSS não resolve sozinho: a folha de cadastro entra
 * por baixo no celular e pela lateral no desktop, e isso é uma prop do componente,
 * não uma classe. Conversas também decide por ela se abre a primeira conversa
 * sozinha (no PC sim, no celular não).
 *
 * `useSyncExternalStore` desde 20/10/2026 (era `useState(false)` mais um efeito).
 * Na hidratação nada muda: o servidor não sabe a largura da tela, então o primeiro
 * passe é `false` dos dois lados e o HTML confere. A diferença está em toda tela
 * aberta DEPOIS, pela navegação do app: ela já nasce com a resposta certa. Com o
 * cache de consultas sobrevivendo à troca de tela, a primeira renderização já vem
 * com dados, e o `false` provisório fazia o celular montar a versão do PC — em
 * Conversas, abrindo por um instante uma conversa invisível e buscando o histórico
 * dela.
 */
const CONSULTA = '(max-width: 767px)';

let lista: MediaQueryList | null = null;
function consulta(): MediaQueryList {
  lista ??= window.matchMedia(CONSULTA);
  return lista;
}

function inscrever(avisar: () => void): () => void {
  const mq = consulta();
  mq.addEventListener('change', avisar);
  return () => mq.removeEventListener('change', avisar);
}

const noNavegador = () => consulta().matches;
const noServidor = () => false;

export function useEhCelular(): boolean {
  return useSyncExternalStore(inscrever, noNavegador, noServidor);
}
