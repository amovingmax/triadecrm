'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';

import { CHAVE_DOS_LEADS_NOVOS, contarLeadsNovos } from './leads/leads-dados';

/**
 * As duas seções da aba Anúncios (05/11/2026): os anúncios que sobem para os
 * portais e os leads que voltam deles. São duas rotas (`/anuncios` e
 * `/anuncios/leads`), então o seletor é de LINKS — o voltar do navegador e o
 * link copiado levam à seção certa —, no desenho do `SeletorDeAba`: pílula
 * sobre o cartão, a ativa em menta. "Leads" leva quantos estão sem resposta.
 */
export function SecoesDosAnuncios({ ativa }: { ativa: 'anuncios' | 'leads' }) {
  const novos = useQuery({
    queryKey: CHAVE_DOS_LEADS_NOVOS,
    queryFn: contarLeadsNovos,
    staleTime: 30_000,
  });
  const itens = [
    { id: 'anuncios' as const, rotulo: 'Anúncios', href: '/anuncios', contagem: null },
    {
      id: 'leads' as const,
      rotulo: 'Leads',
      href: '/anuncios/leads',
      contagem: novos.data ?? null,
    },
  ];
  return (
    <nav
      aria-label="Seções de Anúncios"
      className="flex w-full gap-1 rounded-full bg-card p-1 sombra-base md:w-fit"
    >
      {itens.map((item) => {
        const selecionado = item.id === ativa;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={selecionado ? 'page' : undefined}
            className={cn(
              'toque inline-flex h-11 flex-1 items-center justify-center rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors md:h-8 md:flex-none',
              'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              selecionado
                ? 'bg-menta text-menta-tinta'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {item.rotulo}
            {item.contagem ? (
              <span
                className={cn(
                  'numerico ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]',
                  selecionado ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
                )}
              >
                {item.contagem}
                <span className="sr-only"> sem resposta</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
