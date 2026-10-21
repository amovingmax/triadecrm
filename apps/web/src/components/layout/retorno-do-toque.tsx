'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import { levaAOutraTela } from './retorno-do-toque-regra';

/** O atributo que `globals.css` esmaece: "este link está levando você". */
const MARCA = 'data-indo';
const CONTROLE = 'button, [role="button"], input, select, textarea, label, summary';
/** Rede de segurança: um link que não navegou não fica apagado para sempre. */
const PRAZO_MS = 5000;

/**
 * O TOQUE NUM LINK RESPONDE NA HORA, em qualquer tela (21/10/2026).
 *
 * Até aqui, quem respondia ao toque na ficha e no lote era o esqueleto
 * (`loading.tsx`). Só que, depois de mostrar um esqueleto, o React segura o
 * conteúdo pronto por 300 ms para a tela não piscar — medido no celular pelo Wi-Fi:
 * a ficha chegava do servidor em ~30 ms e aparecia aos ~350 ms. Os dois esqueletos
 * saíram, e a resposta ao toque passou a ser o próprio link tocado: ele esmaece onde
 * está o dedo, até a tela nova entrar. Uma peça só, aqui na casca, em vez de uma em
 * cada um dos quatorze lugares que levam à ficha.
 *
 * O esmaecer espera 60 ms para começar (`globals.css`): a tela adiantada abre antes
 * disso, e nela não há o que mostrar. Os itens do menu têm a pílula deles
 * (`nav-link.tsx`) e ficam de fora.
 */
export function RetornoDoToque() {
  // `useSearchParams` pede uma fronteira de Suspense própria; sem ela, o Next
  // desistiria de pré-desenhar a casca no servidor.
  return (
    <Suspense fallback={null}>
      <MarcarOLinkTocado />
    </Suspense>
  );
}

function MarcarOLinkTocado() {
  const caminho = usePathname();
  const busca = useSearchParams().toString();

  // A tela nova entrou: nenhum link continua "levando".
  useEffect(() => {
    soltar();
  }, [caminho, busca]);

  useEffect(() => {
    let prazo: number | undefined;
    function aoTocar(evento: MouseEvent) {
      const tocado = evento.target instanceof Element ? evento.target : null;
      const link = tocado?.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement)) return;
      const controle = tocado?.closest(CONTROLE);
      const leva = levaAOutraTela(
        {
          botao: evento.button,
          comTecla: evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey,
          href: link.href,
          alvo: link.target,
          baixar: link.hasAttribute('download'),
          dentroDeControle: controle != null && link.contains(controle),
          noMenu: link.closest('nav[aria-label="Navegação principal"]') !== null,
        },
        { origem: location.origin, caminho: location.pathname, busca: location.search },
      );
      if (!leva) return;
      soltar();
      link.setAttribute(MARCA, '');
      window.clearTimeout(prazo);
      prazo = window.setTimeout(soltar, PRAZO_MS);
    }
    document.addEventListener('click', aoTocar);
    return () => {
      document.removeEventListener('click', aoTocar);
      window.clearTimeout(prazo);
    };
  }, []);

  return null;
}

function soltar() {
  for (const el of document.querySelectorAll(`[${MARCA}]`)) el.removeAttribute(MARCA);
}
