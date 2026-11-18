import Link from 'next/link';
import { ChevronRight, ImageIcon } from 'lucide-react';

import { supabaseUrl } from '@/lib/env';
import { cn } from '@/lib/utils';

import type { Tom } from './formatos';

/**
 * As peças comuns do Painel do dia: o cartão, o cabeçalho do bloco, o selo, a
 * foto do imóvel e o avatar. Tudo nos tokens do tema (petróleo e laranja na
 * Imova), para o claro e o escuro saírem certos sem cor escrita à mão.
 */

export function Bloco({
  titulo,
  contagem,
  acao,
  children,
  className,
  rotulo,
}: {
  titulo: React.ReactNode;
  contagem?: number | null;
  acao?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** O id do título, para o `aria-labelledby` da seção. */
  rotulo: string;
}) {
  return (
    <section
      aria-labelledby={rotulo}
      className={cn(
        'sombra-base overflow-hidden rounded-xl border border-border/60 bg-card',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 sm:px-5">
        <h2 id={rotulo} className="flex items-center gap-2 font-heading text-[17px] font-semibold">
          {titulo}
          {contagem !== undefined && contagem !== null ? <Contador n={contagem} /> : null}
        </h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

export function Contador({ n }: { n: number }) {
  return (
    <span className="numerico inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-semibold text-muted-foreground">
      {n}
    </span>
  );
}

export function LinkDoBloco({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="toque inline-flex min-h-11 items-center gap-0.5 text-sm font-semibold text-primary hover:underline sm:min-h-8"
    >
      {children}
      <ChevronRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

const COR_DO_SELO: Record<Tom, string> = {
  ok: 'bg-cliente-fundo text-cliente-texto',
  aviso: 'bg-morno-fundo text-morno-texto',
  perigo: 'bg-quente-fundo text-quente-texto',
  ia: 'bg-primary/12 text-primary',
  marca: 'bg-menta-fundo text-menta-texto',
  neutro: 'bg-muted text-muted-foreground',
};

export function Selo({ tom, children }: { tom: Tom; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-5.5 shrink-0 items-center rounded-full px-2 text-xs font-semibold whitespace-nowrap',
        COR_DO_SELO[tom],
      )}
    >
      {children}
    </span>
  );
}

/** A URL pública da foto do anúncio (balde `anuncios`, o mesmo do Canal Pro). */
export function urlDaFotoDoAnuncio(caminho: string): string {
  return `${supabaseUrl()}/storage/v1/object/public/anuncios/${caminho}`;
}

export function FotoDoImovel({
  caminho,
  className,
  apagada = false,
}: {
  caminho: string | null;
  className?: string;
  apagada?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('relative block shrink-0 overflow-hidden rounded-lg bg-muted', className)}
    >
      {caminho ? (
        // eslint-disable-next-line @next/next/no-img-element -- foto do balde público, sem otimizador do Next
        <img
          src={urlDaFotoDoAnuncio(caminho)}
          alt=""
          loading="lazy"
          className={cn(
            'absolute inset-0 size-full object-cover',
            apagada && 'opacity-55 grayscale',
          )}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground/70">
          <ImageIcon className="size-5" />
        </span>
      )}
    </span>
  );
}

const CORES_DO_AVATAR = [
  'bg-primary/12 text-primary',
  'bg-menta-fundo text-menta-texto',
  'bg-frio-fundo text-frio-texto',
  'bg-cliente-fundo text-cliente-texto',
  'bg-morno-fundo text-morno-texto',
];

export function Avatar({ nome, iniciais }: { nome: string; iniciais: string }) {
  let soma = 0;
  for (const letra of nome) soma = (soma + letra.charCodeAt(0)) % 997;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full text-[12.5px] font-semibold',
        CORES_DO_AVATAR[soma % CORES_DO_AVATAR.length],
      )}
    >
      {iniciais}
    </span>
  );
}
