/**
 * A faixa do relógio e da bateria acompanha o tema do site, como no Safari.
 *
 * O site já publica a cor dele em `<meta name="theme-color">` e a troca quando a
 * pessoa muda entre claro e escuro (`components/tema/provedor-tema.tsx`). A casca
 * só lê essa meta, pelo script abaixo, e pinta a faixa com ela: o site não sabe
 * que o app existe.
 */

/** Roda na página depois de cada carregamento e avisa a casca a cada troca de cor. */
export const AVISAR_COR_DA_BARRA = `(function () {
  var ultima = null;
  function avisar() {
    var meta = document.querySelector('meta[name="theme-color"]');
    var cor = meta && meta.getAttribute('content');
    if (!cor || cor === ultima || !window.ReactNativeWebView) return;
    ultima = cor;
    window.ReactNativeWebView.postMessage(JSON.stringify({ tipo: 'cor-da-barra', cor: cor }));
  }
  avisar();
  new MutationObserver(avisar).observe(document.head, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['content'],
  });
})();
true;`;

/**
 * A cor que veio da página, já conferida: só `#rgb` ou `#rrggbb`, devolvida como
 * `#rrggbb` minúsculo. Qualquer outra mensagem é ignorada (`null`).
 */
export function corDaMensagem(dados: string): string | null {
  let mensagem: unknown;
  try {
    mensagem = JSON.parse(dados);
  } catch {
    return null;
  }
  if (typeof mensagem !== 'object' || mensagem === null) return null;
  const { tipo, cor } = mensagem as { tipo?: unknown; cor?: unknown };
  if (tipo !== 'cor-da-barra' || typeof cor !== 'string') return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(cor.trim())?.[1]?.toLowerCase();
  if (!hex) return null;
  return hex.length === 3 ? `#${[...hex].map((c) => c + c).join('')}` : `#${hex}`;
}

/**
 * Letras claras ou escuras na faixa: as que contrastam mais com o fundo (WCAG).
 * Recebe `#rrggbb`, como sai de `corDaMensagem`.
 */
export function estiloDaBarra(cor: string): 'light-content' | 'dark-content' {
  const canal = (i: number) => {
    const c = parseInt(cor.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminancia = 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
  // Contraste com o branco (1.05 / (L + 0.05)) maior que com o preto ((L + 0.05) / 0.05).
  return (luminancia + 0.05) ** 2 < 0.0525 ? 'light-content' : 'dark-content';
}
