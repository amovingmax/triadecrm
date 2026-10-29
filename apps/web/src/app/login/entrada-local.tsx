import { buttonVariants } from '@/components/ui/button';
import { USUARIOS_DE_TESTE, type QuemTesta } from '@/lib/auth/entrada-local';
import { cn } from '@/lib/utils';

/**
 * Os botões que tomam o lugar do Google no CRM do computador (ver
 * `lib/auth/entrada-local.ts`). São links, e não `fetch`: quem entra é a rota
 * `/auth/dev`, que grava o cookie e manda para onde a pessoa ia.
 */
export function EntradaLocal({ next }: { next: string }) {
  const papeis = Object.keys(USUARIOS_DE_TESTE) as QuemTesta[];
  return (
    <div className="space-y-3">
      {papeis.map((quem, i) => (
        <a
          key={quem}
          href={`/auth/dev?quem=${quem}&next=${encodeURIComponent(next)}`}
          className={cn(
            buttonVariants({ variant: i === 0 ? 'default' : 'outline', size: 'lg' }),
            'h-12 w-full justify-center text-base',
            i === 0 && 'sombra-base',
          )}
        >
          {USUARIOS_DE_TESTE[quem].rotulo}
        </a>
      ))}
    </div>
  );
}
