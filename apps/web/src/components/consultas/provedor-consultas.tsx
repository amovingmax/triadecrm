'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Provedor do TanStack Query para as telas que buscam no cliente.
 *
 * Fica no layout da rota (e não no layout raiz) porque só as telas de lista
 * precisam dele: a casca do app continua sendo servidor puro.
 *
 * `useState` cria o cliente uma vez por montagem no navegador. Um QueryClient em
 * módulo seria compartilhado entre requisições no servidor e vazaria o cache de um
 * usuário para outro.
 */
export function ProvedorConsultas({ children }: { children: React.ReactNode }) {
  const [cliente] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A base muda o dia inteiro (o time está em campo), mas repetir a mesma
            // busca dentro de meio minuto não precisa de ida ao servidor.
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            // Em campo, com 4G instável, uma tentativa a mais resolve a maioria das falhas;
            // mais que isso só faz a pessoa esperar sem saber por quê.
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={cliente}>{children}</QueryClientProvider>;
}
