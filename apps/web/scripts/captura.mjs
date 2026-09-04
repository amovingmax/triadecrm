/**
 * Peças compartilhadas pelos scripts de captura de tela (`foto.mjs` e `fotografar-tudo.mjs`).
 *
 * Três responsabilidades:
 *   1. abrir uma página do CRM no tema pedido, com ou sem sessão;
 *   2. esperar a tela ESTAR PRONTA de verdade (rede parada + 1200 ms da entrada em
 *      Motion, e, quando pedido, um seletor com dado real — nunca um timeout cego);
 *   3. medir a página: contraste WCAG, altura dos alvos de toque e rolagem horizontal.
 *
 * Nada aqui toca no app: é só instrumentação de fora para dentro.
 */

/** Tempo extra depois da rede parar: a entrada do CRM usa Motion (opacity 0 → 1). */
export const ESPERA_ENTRADA_MS = 1200;

/**
 * Abre um contexto no tema pedido.
 *
 * O tema do CRM é classe no <html>, escrita pelo next-themes a partir do localStorage
 * `komune-crm-tema` (ver components/tema/provedor-tema.tsx). Só `colorScheme` do
 * Playwright não bastaria: ele mexe em `prefers-color-scheme`, que o produto trata como
 * "Do aparelho", e não como a escolha feita no CRM. Então gravamos os dois.
 */
export async function abrirContexto(navegador, { largura, altura, tema, storageState = null }) {
  const contexto = await navegador.newContext({
    viewport: { width: largura, height: altura },
    deviceScaleFactor: 2,
    colorScheme: tema,
    locale: 'pt-BR',
    timezoneId: 'America/Fortaleza',
    ...(storageState ? { storageState } : {}),
  });

  await contexto.addInitScript((valor) => {
    try {
      window.localStorage.setItem('komune-crm-tema', valor);
    } catch {
      // localStorage bloqueado: o next-themes cai no defaultTheme (escuro).
    }
  }, tema);

  return contexto;
}

/**
 * Some com o indicador de desenvolvimento do Next.js (o bolinha "N" no canto).
 * Não é interface do produto: é ferramenta do `next dev`, e no celular ele fica em cima
 * do item "Meu dia" da barra inferior. Esconder só ele mantém a foto fiel ao CRM.
 * Vive em shadow DOM, então nenhuma medida deste script o enxergava de qualquer forma.
 */
const ESCONDER_FERRAMENTAS_DEV =
  'nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }';

/** Navega e espera a tela ficar pronta. Devolve o status HTTP e a URL final. */
export async function irEEsperar(pagina, url, { seletorDeDado = null, esperaMs = ESPERA_ENTRADA_MS } = {}) {
  const resposta = await pagina.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  await pagina.addStyleTag({ content: ESCONDER_FERRAMENTAS_DEV }).catch(() => {});

  if (seletorDeDado) {
    await pagina.locator(seletorDeDado).first().waitFor({ state: 'visible', timeout: 30_000 });
  }

  // A entrada em Motion (opacity 0 → 1) roda depois da rede parar; sem esta espera a foto sai vazia.
  await pagina.waitForTimeout(esperaMs);

  // Rede de segurança: se ainda houver texto com opacidade 0, espera mais um pouco.
  const aindaTransparente = await pagina.evaluate(() => {
    const alvos = [...document.querySelectorAll('h1, h2, main p, main a, [data-temperatura]')];
    return alvos.some((el) => Number(getComputedStyle(el).opacity) === 0);
  });
  if (aindaTransparente) await pagina.waitForTimeout(600);

  return { status: resposta ? resposta.status() : null, url: pagina.url() };
}

/* ==========================================================================
   MEDIDAS — tudo abaixo roda DENTRO da página (page.evaluate).
   ========================================================================== */

/**
 * Função executada no navegador. Devolve contraste WCAG, alvos de toque e
 * rolagem horizontal. Fica como string-função para o Playwright serializar.
 */
export function medirNaPagina() {
  /* ---------- cor ---------- */

  const provete = document.createElement('span');
  provete.style.cssText = 'position:fixed;left:-9999px;top:-9999px;pointer-events:none';
  document.body.appendChild(provete);

  let canvas2d = null;
  function viaCanvas(texto) {
    if (!canvas2d) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      canvas2d = c.getContext('2d', { willReadFrequently: true });
    }
    try {
      canvas2d.clearRect(0, 0, 1, 1);
      canvas2d.fillStyle = '#000';
      canvas2d.fillStyle = texto;
      canvas2d.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = canvas2d.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    } catch {
      return null;
    }
  }

  /** Qualquer sintaxe de cor (hex, rgb, color(srgb), color-mix, oklab…) → {r,g,b,a} 0–255. */
  function cor(texto) {
    if (!texto || texto === 'transparent' || texto === 'none') return { r: 0, g: 0, b: 0, a: 0 };

    // Deixa o próprio navegador resolver a sintaxe (color-mix, var(), oklab…).
    provete.style.color = '';
    provete.style.color = texto;
    const resolvido = getComputedStyle(provete).color;

    let m = resolvido.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    m = resolvido.match(/^color\(srgb\s+([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 };
    }
    return viaCanvas(resolvido) ?? viaCanvas(texto);
  }

  /** Compõe `frente` (com alfa) sobre `fundo` (opaco). */
  function compor(frente, fundo) {
    const a = frente.a;
    return {
      r: frente.r * a + fundo.r * (1 - a),
      g: frente.g * a + fundo.g * (1 - a),
      b: frente.b * a + fundo.b * (1 - a),
      a: 1,
    };
  }

  function hex({ r, g, b }) {
    const n = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
    return `#${n(r)}${n(g)}${n(b)}`;
  }

  /** Como hex(), mas mostra o alfa quando existe — senão duas paradas de gradiente que só
      diferem na transparência sairiam idênticas no relatório. */
  function hexa(c) {
    return c.a >= 1 ? hex(c) : `${hex(c)} @ ${Math.round(c.a * 100)}%`;
  }

  function luminancia({ r, g, b }) {
    const c = [r, g, b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  /** Razão de contraste WCAG 2.x, arredondada em 2 casas. */
  function contraste(frente, fundo) {
    const opaca = frente.a < 1 ? compor(frente, fundo) : frente;
    const a = luminancia(opaca);
    const b = luminancia(fundo);
    const razao = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return Math.round(razao * 100) / 100;
  }

  /** Cores declaradas num `background-image` já computado (paradas de gradiente). */
  function coresDeGradiente(imagem) {
    if (!imagem || imagem === 'none') return [];
    const achadas = imagem.match(/rgba?\([^)]*\)|color\(srgb[^)]*\)|#[0-9a-fA-F]{3,8}\b/g) ?? [];
    return achadas.map(cor).filter((c) => c.a > 0);
  }

  /**
   * Fundo efetivo atrás de um elemento: empilha os background-color dos ancestrais
   * (compondo o alfa) até chegar num opaco.
   *
   * Quando algum ancestral pinta um GRADIENTE, o valor sólido sozinho mentiria (é o que
   * está por baixo, não o pixel). Então `paradas` traz cada cor do gradiente já composta
   * sobre esse sólido, e quem mede usa a PIOR delas — medida conservadora, sem maquiagem.
   */
  function fundoEfetivo(el) {
    const camadas = [];
    let imagem = null;
    for (let n = el; n; n = n.parentElement) {
      const e = getComputedStyle(n);
      if (!imagem && e.backgroundImage && e.backgroundImage !== 'none') imagem = e.backgroundImage;
      const c = cor(e.backgroundColor);
      if (c.a > 0) camadas.push(c);
      if (c.a >= 1) break;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = camadas.length - 1; i >= 0; i -= 1) base = compor(camadas[i], base);
    const paradas = coresDeGradiente(imagem).map((c) => compor(c, base));
    return { cor: base, gradiente: Boolean(imagem), paradas };
  }

  const raiz = getComputedStyle(document.documentElement);
  const token = (nome) => cor(raiz.getPropertyValue(nome).trim());
  const fundoDaPagina = fundoEfetivo(document.body).cor;

  /* ---------- 1. texto principal e secundário ---------- */

  function amostrarTexto(seletores, rotulo) {
    for (const sel of seletores) {
      for (const el of document.querySelectorAll(sel)) {
        const texto = (el.textContent ?? '').trim();
        if (!texto) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        const e = getComputedStyle(el);
        if (e.visibility === 'hidden' || Number(e.opacity) === 0) continue;

        const frente = cor(e.color);
        const recorte = `${e.backgroundClip} ${e.webkitBackgroundClip ?? ''}`;
        // Título com gradiente recortado no texto (`background-clip: text` e `color: transparent`):
        // quem pinta a letra é o background-image, não o `color`. Medir o `color` daria 1:1 — falso.
        const porGradiente = frente.a === 0 && recorte.includes('text');
        if (frente.a === 0 && !porGradiente) continue; // texto realmente invisível: não serve de amostra

        const fundo = fundoEfetivo(porGradiente ? (el.parentElement ?? el) : el);
        const tintas = porGradiente ? coresDeGradiente(e.backgroundImage) : [frente];
        if (tintas.length === 0) continue;

        const tamanho = parseFloat(e.fontSize);
        const peso = Number(e.fontWeight) || 400;
        // WCAG: "texto grande" = 18,66px em negrito ou 24px.
        const grande = tamanho >= 24 || (tamanho >= 18.66 && peso >= 700);
        const minimo = grande ? 3 : 4.5;

        // Pior caso: cada tinta do texto contra cada fundo possível (sólido + paradas do gradiente).
        const fundos = [fundo.cor, ...fundo.paradas];
        const razoes = [];
        for (const tinta of tintas) for (const f of fundos) razoes.push(contraste(tinta, f));
        const razao = Math.min(...razoes);

        return {
          rotulo,
          seletor: sel,
          amostra: texto.slice(0, 48),
          cor_do_texto: porGradiente ? tintas.map(hexa).join(' → ') : hex(frente),
          texto_pintado_por_gradiente: porGradiente,
          cor_do_fundo: hex(fundo.cor),
          fundo_tem_gradiente: fundo.gradiente,
          fundo_paradas_do_gradiente: fundo.paradas.map(hex),
          tamanho_px: Math.round(tamanho * 100) / 100,
          peso,
          razao,
          razao_melhor_caso: Math.max(...razoes),
          minimo_wcag_aa: minimo,
          passa_aa: razao >= minimo,
          passa_aaa: razao >= (grande ? 4.5 : 7),
        };
      }
    }
    return { rotulo, encontrado: false };
  }

  const textoPrincipal = amostrarTexto(
    ['main h1', 'h1', 'main p:not(.text-muted-foreground)', 'main td', 'main a[href]'],
    'texto principal',
  );
  const textoSecundario = amostrarTexto(
    [
      'main .text-muted-foreground',
      '.text-muted-foreground',
      'main p.text-sm',
      'nav .text-muted-foreground',
    ],
    'texto secundário',
  );

  /* ---------- 2. escala térmica ---------- */

  const TEMPERATURAS = ['frio', 'morno', 'quente', 'cliente', 'cliente_ativo'];
  /** No CSS os tokens usam hífen: --cliente-ativo. */
  const variavel = (t) => `--${t.replace('_', '-')}`;

  // Onde cada cor aparece de verdade nesta tela.
  /** Pior contraste de uma cor contra o fundo sólido E contra cada parada de gradiente. */
  function piorContra(c, fundo) {
    return Math.min(...[fundo.cor, ...fundo.paradas].map((f) => contraste(c, f)));
  }

  const presentes = new Map();
  for (const el of document.querySelectorAll('[data-temperatura]')) {
    const t = el.getAttribute('data-temperatura');
    if (!t || presentes.has(t)) continue;
    const marca = el.querySelector('span') ?? el;
    const c = cor(getComputedStyle(marca).backgroundColor);
    const fundo = fundoEfetivo(el.parentElement ?? el);
    presentes.set(t, {
      cor_pintada: hex(c),
      fundo_medido: hex(fundo.cor),
      razao_medida: piorContra(c, fundo),
      minimo_wcag: 3,
      passa: piorContra(c, fundo) >= 3,
      fundo_tem_gradiente: fundo.gradiente,
    });
  }
  // A escada da tela de login pinta as cinco de uma vez, sem data-temperatura.
  const escada = document.querySelector('[role="img"][aria-label*="Escala térmica"]');
  if (escada) {
    const faixas = [...escada.children].reverse(); // desenhada de cima (quente) para baixo
    faixas.forEach((faixa, i) => {
      const t = TEMPERATURAS[i];
      if (!t || presentes.has(t)) return;
      const c = cor(getComputedStyle(faixa).backgroundColor);
      const fundo = fundoEfetivo(escada.parentElement ?? escada);
      presentes.set(t, {
        cor_pintada: hex(c),
        fundo_medido: hex(fundo.cor),
        razao_medida: piorContra(c, fundo),
        minimo_wcag: 3,
        passa: piorContra(c, fundo) >= 3,
        fundo_tem_gradiente: fundo.gradiente,
      });
    });
  }

  const superficies = {
    background: token('--background'),
    card: token('--card'),
    muted: token('--muted'),
  };

  const escalaTermica = TEMPERATURAS.map((t) => {
    const marca = token(variavel(t));
    const corTexto = token(`${variavel(t)}-texto`);
    const corChip = compor(token(`${variavel(t)}-fundo`), superficies.background);
    const visto = presentes.get(t) ?? null;
    return {
      temperatura: t,
      aparece_nesta_tela: Boolean(visto),
      marca: {
        cor: hex(marca),
        // WCAG 1.4.11: objeto gráfico precisa de 3:1.
        minimo_wcag: 3,
        sobre_background: contraste(marca, superficies.background),
        sobre_card: contraste(marca, superficies.card),
        sobre_muted: contraste(marca, superficies.muted),
        passa_sobre_background: contraste(marca, superficies.background) >= 3,
      },
      texto: {
        cor: hex(corTexto),
        minimo_wcag: 4.5,
        sobre_background: contraste(corTexto, superficies.background),
        sobre_card: contraste(corTexto, superficies.card),
        sobre_muted: contraste(corTexto, superficies.muted),
        sobre_o_proprio_chip: contraste(corTexto, corChip),
        passa_sobre_background: contraste(corTexto, superficies.background) >= 4.5,
        passa_sobre_o_proprio_chip: contraste(corTexto, corChip) >= 4.5,
      },
      chip: { cor_composta: hex(corChip) },
      medido_no_dom: visto,
    };
  });

  /* ---------- 3. alvos de toque ---------- */

  const CATEGORIAS = [
    ['botão', 'button, [role="button"], summary'],
    ['item de menu', '[role="menuitem"], [role="menuitemradio"], [role="option"], [role="tab"]'],
    ['link de navegação', 'nav a[href], [role="navigation"] a[href]'],
    ['linha clicável', 'tbody tr, li > a[href], [role="row"]'],
    ['campo', 'input:not([type="hidden"]), select, textarea'],
    ['link', 'a[href]'],
  ];

  const vistos = new Set();
  const alvos = [];
  for (const [categoria, seletor] of CATEGORIAS) {
    for (const el of document.querySelectorAll(seletor)) {
      if (vistos.has(el)) continue;
      const e = getComputedStyle(el);
      if (e.visibility === 'hidden' || e.display === 'none' || Number(e.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) continue;
      vistos.add(el);
      const rotulo =
        (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40) || `<${el.tagName.toLowerCase()}>`;
      alvos.push({
        categoria,
        rotulo,
        tag: el.tagName.toLowerCase(),
        altura_px: Math.round(r.height * 10) / 10,
        largura_px: Math.round(r.width * 10) / 10,
      });
    }
  }

  const alturas = alvos.map((a) => a.altura_px).sort((x, y) => x - y);
  const mediana = alturas.length
    ? alturas.length % 2
      ? alturas[(alturas.length - 1) / 2]
      : Math.round(((alturas[alturas.length / 2 - 1] + alturas[alturas.length / 2]) / 2) * 10) / 10
    : null;

  const porCategoria = {};
  for (const a of alvos) {
    const c = (porCategoria[a.categoria] ??= { total: 0, menor_px: Infinity, maior_px: 0 });
    c.total += 1;
    c.menor_px = Math.min(c.menor_px, a.altura_px);
    c.maior_px = Math.max(c.maior_px, a.altura_px);
  }
  for (const c of Object.values(porCategoria)) if (c.menor_px === Infinity) c.menor_px = null;

  const abaixo = (limite) =>
    alvos
      .filter((a) => a.altura_px < limite)
      .sort((a, b) => a.altura_px - b.altura_px)
      .slice(0, 14);

  /* ---------- 4. rolagem horizontal ---------- */

  const doc = document.documentElement;
  const larguraVisivel = window.innerWidth;
  const estouram = [];
  for (const el of document.querySelectorAll('body *')) {
    if (estouram.length >= 8) break;
    const e = getComputedStyle(el);
    if (e.visibility === 'hidden' || e.display === 'none' || e.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.right <= larguraVisivel + 1 && r.left >= -1) continue;
    estouram.push({
      tag: el.tagName.toLowerCase(),
      classe: (el.getAttribute('class') ?? '').slice(0, 70),
      esquerda_px: Math.round(r.left),
      direita_px: Math.round(r.right),
    });
  }

  const resultado = {
    viewport: { largura: larguraVisivel, altura: window.innerHeight },
    tema_no_html: doc.classList.contains('dark') ? 'dark' : 'light',
    fundo_da_pagina: hex(fundoDaPagina),
    contraste: {
      texto_principal: textoPrincipal,
      texto_secundario: textoSecundario,
      tokens: {
        foreground_sobre_background: contraste(token('--foreground'), superficies.background),
        muted_foreground_sobre_background: contraste(
          token('--muted-foreground'),
          superficies.background,
        ),
        muted_foreground_sobre_card: contraste(token('--muted-foreground'), superficies.card),
        card_foreground_sobre_card: contraste(token('--card-foreground'), superficies.card),
        border_sobre_background: contraste(token('--border'), superficies.background),
      },
      escala_termica: escalaTermica,
    },
    alvos_de_toque: {
      total: alvos.length,
      menor_px: alturas[0] ?? null,
      mediana_px: mediana,
      maior_px: alturas[alturas.length - 1] ?? null,
      por_categoria: porCategoria,
      abaixo_de_44px: abaixo(44),
      abaixo_de_24px: abaixo(24),
    },
    rolagem_horizontal: {
      body_rola: document.body.scrollWidth > document.body.clientWidth,
      html_rola: doc.scrollWidth > doc.clientWidth,
      body_scrollWidth: document.body.scrollWidth,
      body_clientWidth: document.body.clientWidth,
      html_scrollWidth: doc.scrollWidth,
      html_clientWidth: doc.clientWidth,
      elementos_que_estouram: estouram,
    },
  };

  provete.remove();
  return resultado;
}
