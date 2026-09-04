import { cn } from '@/lib/utils';

/**
 * Marca do CRM. O produto se chama **Tríade**; Komune é a empresa dona dele.
 * O desenho são três pontos ligados — os três lados que o CRM conecta
 * (fornecedor, produtor e a Komune) e o próprio nome.
 */
export function Logo({
  className,
  somenteIcone = false,
}: {
  className?: string;
  somenteIcone?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold', className)}>
      <MarcaTriade className="size-7 shrink-0" />
      {!somenteIcone && (
        <span className="leading-none">
          Tríade <span className="font-normal text-muted-foreground">CRM</span>
        </span>
      )}
    </span>
  );
}

/** Ícone da marca, mesmo desenho dos ícones da PWA. */
export function MarcaTriade({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" className={className}>
      <rect width="512" height="512" rx="112" className="fill-primary" />
      <g
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M256 154 366 350 146 350Z" />
      </g>
      <g fill="var(--primary-foreground)">
        <circle cx="256" cy="154" r="46" />
        <circle cx="366" cy="350" r="46" />
        <circle cx="146" cy="350" r="46" />
      </g>
    </svg>
  );
}
