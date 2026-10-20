import { Skeleton } from '@/components/ui/skeleton';

/**
 * O que aparece entre o toque e a página, nas páginas cujo SERVIDOR demora: a ficha
 * do parceiro (`parceiros/[id]/loading.tsx`) e o lote de ligação
 * (`ligar/[id]/loading.tsx`). Até 20/10/2026 não havia nenhum, e o toque deixava a
 * tela velha parada até o servidor terminar a página nova inteira.
 *
 * SÓ NESSAS DUAS, e foi medido. Um `loading.tsx` na área inteira deu retorno na hora
 * em todas as telas, mas ATRASOU o conteúdo das que o servidor entrega rápido (o
 * Meu dia, Conversas): depois de mostrar um esqueleto, o React segura a troca por
 * pelo menos 300 ms, para não piscar. Nas telas rápidas o retorno ao toque vem do
 * próprio item do menu (`nav-link.tsx`, `useLinkStatus`), que não segura nada.
 *
 * As formas são paradas, como todo esqueleto do CRM (`ui/skeleton.tsx`): o título
 * de 32px e linhas de lista, ou o desenho da ficha. A própria tela assume em
 * seguida, com o esqueleto dela ou já com o que o cache tinha.
 */
export function CarregandoTela() {
  const larguras = ['w-56', 'w-40', 'w-64', 'w-48', 'w-36', 'w-52', 'w-44', 'w-60'];
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Carregando.</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <ul>
        {larguras.map((largura, i) => (
          <li key={i} className="flex min-h-16 items-center gap-3 border-b border-hairline py-2.5">
            <div className="flex-1 space-y-1.5">
              <Skeleton className={`h-4 max-w-full ${largura}`} />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-4 w-10" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A ficha do parceiro é a página mais pesada do servidor (a ficha, os painéis e os
 * catálogos numa ida só), e é aberta de oito lugares do CRM. A espera tem a forma
 * dela: a volta para a lista, o cartão do cabeçalho e os painéis.
 */
export function CarregandoFicha() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex w-full flex-col gap-5">
      <span className="sr-only">Carregando a ficha.</span>
      <Skeleton className="h-11 w-28 md:h-7" />
      <div className="sombra-base flex flex-col gap-5 rounded-xl bg-card p-5 md:gap-6 md:p-7">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-2 w-full" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
