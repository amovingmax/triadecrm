'use client';

import Link from 'next/link';
import { House } from 'lucide-react';

import { cn } from '@/lib/utils';
import { dataHoraDoLead } from '@/components/anuncios/leads/leads-rotulos';

import { useOrigemNoPortal } from './origem-no-portal-dados';

/**
 * "Veio do anúncio SA0012_IMOVA · WhatsApp" (05/11/2026), só na Imova: o
 * cliente tocou num anúncio do ZAP Imóveis, do Viva Real ou da OLX e mandou
 * mensagem (no WhatsApp, depois do clique, ou pelo portal); quem só clicou não
 * ganha etiqueta. No Lead Certo a pessoa nunca viu o anúncio da Imova — o
 * portal indicou um parecido —, e a etiqueta diz "Parecido com".
 *
 * SÓ LEITURA, e outro nome de propósito: a `FaixaDoAnuncio` dos balões é o
 * anúncio de clique para o WhatsApp da Meta. Esta etiqueta não toca no WhatsApp:
 * lê `portal_leads_na_lista` e mostra. Sem lead (ou na KOMUNE), não aparece.
 */
export function OrigemNoPortal({
  conversaId,
  organizacaoId,
  naFolha = false,
}: {
  /** A conversa aberta: é por ela que o lead do WhatsApp é achado primeiro. */
  conversaId: string | null;
  /** A ficha, quando há (a conversa de quem ainda não é ficha não tem). */
  organizacaoId: string | null;
  /** Na folha do celular e na coluna do computador, o tamanho dos outros selos dela. */
  naFolha?: boolean;
}) {
  const origem = useOrigemNoPortal({ conversaId, organizacaoId });
  if (!origem) return null;
  const classe = cn(
    'inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border border-hairline leading-none text-foreground',
    naFolha ? 'h-9 px-3 text-sm' : 'h-5 px-2 text-[11px]',
  );
  const conteudo = (
    <>
      <House className={cn('shrink-0', naFolha ? 'size-4' : 'size-3')} aria-hidden="true" />
      <span className="truncate">{origem.frase}</span>
    </>
  );
  const dica = `Lead dos portais, ${dataHoraDoLead(origem.chegouEm)}${
    origem.descartado ? ' (descartado)' : ''
  }`;
  if (origem.anuncioId) {
    return (
      <Link
        href={`/anuncios/${origem.anuncioId}`}
        title={`${dica}. Abrir o anúncio.`}
        className={cn(
          classe,
          'toque outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
        )}
      >
        {conteudo}
      </Link>
    );
  }
  return (
    <span className={classe} title={dica}>
      {conteudo}
    </span>
  );
}
