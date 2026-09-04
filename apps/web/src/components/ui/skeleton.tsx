import { cn } from '@/lib/utils';

/**
 * Forma parada, sem pulsação: o esqueleto já cumpre a função porque tem o mesmo
 * desenho da lista final. O plano de design só admite laço infinito na barra térmica
 * de quem passou do prazo, e vinte formas pulsando ao mesmo tempo no celular é
 * exatamente o enfeite que ele cortou.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('rounded-md bg-muted', className)} {...props} />;
}

export { Skeleton };
