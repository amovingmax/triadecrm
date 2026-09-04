import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
        secondary: 'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
        // A brasa aqui é preenchimento (objeto gráfico, 3:1); o TEXTO usa
        // `--destructive-texto`, a mesma separação da escala térmica. O preenchimento
        // fica capado em 10% nos dois modos: em 20% no escuro a tinta cai para 4,17:1
        // dentro da folha. O realce de passagem é BORDA, não mais tinta sob o texto.
        destructive:
          'bg-destructive/10 text-destructive-texto focus-visible:ring-destructive/20 dark:bg-destructive/10 dark:focus-visible:ring-destructive/40 [a]:hover:border-destructive',
        outline: 'border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground',
        // Pílula do acabamento do template: borda hairline, cartão a 50% e desfoque
        // leve. É a forma do chip de estado da casca (cabeçalho, estado vazio,
        // dica de tecla). `rounded-full` e `border-hairline` estão aqui de propósito:
        // o tailwind-merge tira o `rounded-4xl` e o `border-transparent` da base, e
        // com isso o resultado não depende da ordem em que o Tailwind emite a
        // classe `pilula` e as utilitárias.
        pilula: 'pilula rounded-full border-hairline text-foreground',
        ghost: 'hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
