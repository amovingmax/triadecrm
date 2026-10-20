'use client';

import { useLayoutEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Provedor do TanStack Query, UM SÓ para a área autenticada (`app/(app)/layout.tsx`).
 *
 * Até 20/10/2026 cada seção montava o seu no próprio `layout`, e a troca de página
 * ainda remontava tudo (`TransicaoPagina` tinha `key` no caminho). Nenhum clique
 * aproveitava nada: lista → ficha → lista buscava a lista de novo do zero, com
 * esqueleto, e o `staleTime` abaixo nunca chegava a valer. No celular, com 4G, era
 * a maior parte da espera entre um toque e a tela.
 *
 * Agora o cache sobrevive à navegação, e a tela que volta aparece na hora com o que
 * já tinha. Para não trocar velocidade por dado velho, a regra antiga continua
 * valendo do jeito que a pessoa via: TODA navegação busca de novo o que a tela nova
 * mostra (`MarcarVelhoAoNavegar`). Dentro da mesma tela, abrir e fechar uma folha
 * continua aproveitando a busca de menos de meio minuto.
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

  return (
    <QueryClientProvider client={cliente}>
      <MarcarVelhoAoNavegar cliente={cliente} />
      {children}
    </QueryClientProvider>
  );
}

/**
 * A cada troca de caminho, o cache inteiro vira "vencido", sem buscar nada naquela
 * hora (`refetchType: 'none'`): quem montar na tela nova busca por cima do que já
 * está desenhado, e o que ninguém está olhando não custa nada.
 *
 * `useLayoutEffect`, e não `useEffect`, por causa da ORDEM: os efeitos de layout de
 * um commit rodam todos antes dos efeitos passivos, e é num efeito passivo que cada
 * `useQuery` da tela nova se inscreve e decide se busca. Marcar depois deixaria
 * passar o dado de até 30 s atrás, que é o que esta regra existe para impedir.
 */
function MarcarVelhoAoNavegar({ cliente }: { cliente: QueryClient }) {
  const caminho = usePathname();
  useLayoutEffect(() => {
    void cliente.invalidateQueries({ refetchType: 'none' });
  }, [cliente, caminho]);
  return null;
}
