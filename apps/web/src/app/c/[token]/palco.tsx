import { cn } from '@/lib/utils';

/**
 * A moldura da página de reivindicação — a segunda (e última) superfície de
 * vitrine do produto, e a única sem login.
 *
 * Quem abre isto é o dono do buffet, no celular, depois de uma ligação, muitas
 * vezes com 4G ruim. Duas decisões vêm daí:
 *
 * 1. Peso. Nenhuma imagem, nenhuma fonte extra, nenhuma biblioteca de animação —
 *    o login usa `motion/react` e aqui a entrada é uma animação de CSS que já
 *    existe no sistema (`revelar-linha`), com a rede de segurança de
 *    `prefers-reduced-motion` do globals.css valendo do mesmo jeito.
 * 2. Uma superfície só. O login tem duas colunas porque tem duas ideias (a tese e
 *    a ação). Aqui existe uma pergunta só — "este perfil é seu?" — então existe
 *    uma coluna só, estreita, do topo ao rodapé, nas duas larguras.
 *
 * O acabamento (pílula de eyebrow, título em gradiente, brilho radial, ação em
 * gradiente) é o mesmo do login de propósito: é a mesma promessa sendo feita, e
 * esta é a única outra tela em que a marca se apresenta a quem ainda não é
 * parceiro. Fora destas duas, o gradiente de título continua fora do app.
 *
 * A MARCA AQUI É KOMUNE, não Tríade. Tríade é o CRM, que é ferramenta nossa; o
 * fornecedor está falando com o marketplace. Nenhum símbolo do CRM aparece nesta
 * página, e nada nela revela que existe um CRM por trás.
 */
export function Palco({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-[100dvh] flex-col bg-muted">
      <div aria-hidden="true" className="brilho-radial pointer-events-none absolute inset-0" />

      <div className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-12 sm:px-8 sm:py-16">
        {children}
      </div>

      <footer className="relative mx-auto w-full max-w-2xl px-6 pb-10 sm:px-8">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-grafite-500 dark:text-grafite-450">
          Komune · marketplace de eventos, Natal/RN · dúvidas e pedidos sobre os seus dados:{' '}
          {/* `min-h-11`: é o único link da página e é a saída de LGPD (pedir acesso,
              correção ou exclusão). Em texto corrido ele media 16px de alvo; aqui
              vale a mesma régua de 44px dos botões, mesmo custando altura ao rodapé. */}
          <a
            href="mailto:privacidade@komune.app.br"
            className="inline-flex min-h-11 items-center underline underline-offset-4"
          >
            privacidade@komune.app.br
          </a>
        </p>
      </footer>
    </main>
  );
}

/**
 * Bloco que entra escalonado na ordem de leitura. Só `opacity` e `transform`,
 * pelo utilitário `revelar-linha` do sistema; o atraso vai inline porque é o
 * índice da linha, e some depois do primeiro paint.
 */
export function Entrada({
  indice,
  className,
  children,
}: {
  indice: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('revelar-linha', className)} style={{ animationDelay: `${indice * 70}ms` }}>
      {children}
    </div>
  );
}
