'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { type AppRole } from '@/lib/auth/role';
import { estaAtivo } from '@/lib/navegacao';

/** A tela aberta busca o que é dela primeiro; o adiantamento vem depois, com folga. */
const ESPERA_MS = 1200;

/**
 * A página INTEIRA, como faz o `prefetch` do link (`layout/nav-link.tsx`). Sem isto o
 * `router.prefetch` adianta só o esqueleto da rota, e numa tela dinâmica — todas as do
 * CRM — o toque ainda esperava o servidor: medido no 4G, a Agenda abria aos ~820 ms
 * mesmo "adiantada". O tipo é um enum interno do Next; a conversão parte do tipo do
 * próprio `useRouter` para não depender de caminho interno do pacote.
 */
const PAGINA_INTEIRA = { kind: 'full' } as unknown as NonNullable<
  Parameters<ReturnType<typeof useRouter>['prefetch']>[1]
>;

/**
 * OS DADOS JÁ ESTÃO AQUI QUANDO O DEDO CHEGA (21/10/2026). O menu adianta a página e
 * o código de cada tela (`layout/nav-link.tsx`), mas a tela ainda buscava os dados
 * DEPOIS do toque — uma a três idas ao banco em série, ~35 ms cada no Wi-Fi e
 * ~150 ms ou mais no 4G. Aqui, com o aparelho ocioso, as telas do menu que ainda não
 * têm nada no cache buscam o que mostram ao abrir (`adiantadores.ts`), e a página e o
 * código de todas elas, inclusive as da folha "Mais", ficam guardados.
 * O toque desenha a tela com eles na hora, e a tela renova por cima como já fazia
 * (`provedor-consultas.tsx`): nada aparece velho por mais que essa renovação.
 *
 * Roda depois de cada troca de tela, mas só busca o que FALTA no cache: o que a
 * pessoa já viu, ou o que já foi adiantado, não é pedido de novo. O cache solta o que
 * ninguém olhou em 5 minutos (`gcTime`), então o adiantado também envelhece no máximo
 * isso antes de ser descartado. Com "economia de dados" ligada no aparelho, ou rede 2G,
 * não adianta nada.
 */
export function AdiantarDados({ papel, telas }: { papel: AppRole; telas: readonly string[] }) {
  const cliente = useQueryClient();
  const router = useRouter();
  const caminho = usePathname();
  const lista = telas.join('|');

  useEffect(() => {
    if (economizandoDados()) return;
    let cancelado = false;
    let ocioso: number | undefined;
    const rodar = async () => {
      const { ADIANTADORES } = await import('./adiantadores');
      for (const tela of lista.split('|')) {
        if (cancelado) return;
        if (estaAtivo(caminho, tela)) continue;
        // A página e o código também: os itens da folha "Mais" só ficam visíveis (e
        // só seriam adiantados pelo `nav-link.tsx`) quando a folha abre, e no 4G o
        // toque chegava antes. O que já está guardado o Next não pede de novo.
        router.prefetch(tela, PAGINA_INTEIRA);
        // Uma falha aqui não é da pessoa: a tela busca de novo ao abrir e mostra o erro ela mesma.
        await ADIANTADORES[tela]?.(cliente, papel).catch(() => undefined);
      }
    };
    const espera = window.setTimeout(() => {
      // O Safari do iPhone não tem `requestIdleCallback`; lá a espera basta.
      if (typeof window.requestIdleCallback === 'function') {
        ocioso = window.requestIdleCallback(() => void rodar(), { timeout: 2000 });
      } else {
        void rodar();
      }
    }, ESPERA_MS);
    return () => {
      cancelado = true;
      window.clearTimeout(espera);
      if (ocioso !== undefined) window.cancelIdleCallback(ocioso);
    };
  }, [cliente, router, caminho, papel, lista]);

  return null;
}

function economizandoDados(): boolean {
  const conexao = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection;
  return conexao?.saveData === true || /(^|-)2g$/.test(conexao?.effectiveType ?? '');
}
