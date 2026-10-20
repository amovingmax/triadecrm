'use client';

import { useEffect, useState, type CSSProperties } from 'react';

/**
 * A conversa aberta no celular ocupa a TELA INTEIRA (20/10/2026, protótipo A
 * escolhido pelo usuário): sem o cabeçalho do CRM e sem a barra de baixo, como
 * em qualquer aplicativo de conversa. Com os dois na tela sobravam ~300 px para
 * as mensagens num iPhone de 844, e quase nada com o teclado aberto.
 *
 * A altura vem da ÁREA VISÍVEL (`visualViewport`), e não de `100dvh`: no iPhone
 * o teclado não encolhe o `dvh`, e uma camada fixa da altura da tela deixava a
 * caixa de escrever atrás do teclado. Com a área visível, o cabeçalho da conversa
 * continua no topo e a caixa encosta no teclado — no Safari e no Chrome.
 *
 * Enquanto ela está aberta, a página de trás não rola: um arrasto que passasse
 * da conversa para o documento empurraria a camada inteira para fora do lugar.
 *
 * `--folga-inferior` é a área segura de baixo (a barrinha do iPhone) com o
 * teclado fechado, e zero com ele aberto — o teclado já ocupa aquele lugar.
 */
export function useAreaVisivel(ativo: boolean): CSSProperties | undefined {
  const [area, setArea] = useState<{ topo: number; altura: number; teclado: boolean } | null>(null);

  useEffect(() => {
    if (!ativo) return;
    const html = document.documentElement;
    const antes = html.style.overflow;
    html.style.overflow = 'hidden';

    const vv = window.visualViewport;
    const medir = () => {
      const altura = vv?.height ?? window.innerHeight;
      setArea({
        topo: vv?.offsetTop ?? 0,
        altura,
        teclado: window.innerHeight - altura > 120,
      });
    };
    medir();
    vv?.addEventListener('resize', medir);
    vv?.addEventListener('scroll', medir);
    window.addEventListener('resize', medir);
    return () => {
      html.style.overflow = antes;
      vv?.removeEventListener('resize', medir);
      vv?.removeEventListener('scroll', medir);
      window.removeEventListener('resize', medir);
    };
  }, [ativo]);

  if (!ativo || !area) return undefined;
  return {
    top: area.topo,
    height: area.altura,
    // A caixa de escrever cresce até 30% disto (`responder.tsx`): com o teclado
    // aberto, ~5 linhas num iPhone; sem ele, as dez de sempre.
    ['--altura-visivel' as string]: `${area.altura}px`,
    ['--folga-inferior' as string]: area.teclado ? '0px' : 'env(safe-area-inset-bottom, 0px)',
  };
}
