import { cn } from '@/lib/utils';

/** Marca do CRM: quadrado com "K" (mesmo desenho dos ícones da PWA) + texto. */
export function Logo({
  className,
  somenteIcone = false,
}: {
  className?: string;
  somenteIcone?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold', className)}>
      <MarcaK className="size-7 shrink-0" />
      {!somenteIcone && (
        <span className="leading-none">
          KOMUNE <span className="font-normal text-muted-foreground">CRM</span>
        </span>
      )}
    </span>
  );
}

export function MarcaK({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" className={className}>
      <rect width="512" height="512" rx="112" className="fill-primary" />
      <path
        d="M182 130v252M182 262l170-132M215 262l137 120"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="64"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
