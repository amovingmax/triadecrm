'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

import { registrarTeclado } from './registro-do-teclado';

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
 * O TECLADO NO JEITO DO WHATSAPP (04/11/2026). "Quando clicamos no campo de
 * escrever ele fica meio bugado; quero exatamente igual ao WhatsApp": o teclado
 * sobe, a caixa sobe colada nele, o cabeçalho não sai do lugar e a última
 * mensagem continua logo acima da caixa.
 *
 * O que o Safari do iPhone faz (medido no iPhone do usuário, iOS 26, pelo diário
 * de `registro-do-teclado.ts`): sem teclado, a área visível tem 699 px; ao tocar
 * no campo, ela cai para 362 e o Safari ROLA A PÁGINA 337 px para baixo, para
 * mostrar o campo. Ele rola com animação, e os números chegam em ordens
 * diferentes a cada vez (às vezes o empurrão só aparece 400 ms depois). A camada
 * que corria atrás desses números chegava atrasada: um pedaço preto em cima ou
 * embaixo da conversa, e tremor quando o dedo arrastava a página.
 *
 * Então a página NÃO ROLA enquanto a conversa está aberta:
 *   - Se o Safari rolar (para mostrar o campo, ou pelo dedo), ela volta para o
 *     topo na mesma hora. A camada já tem a altura da área visível, então o
 *     campo continua à vista e o Safari não insiste. Se ele insistir (mais de
 *     `DEVOLUCOES` vezes por segundo), a camada desiste de brigar e acompanha o
 *     empurrão (`offsetTop`), que é o jeito antigo e também certo.
 *   - Só o que muda é a ALTURA da camada, e ela muda com a mesma curva do
 *     teclado (`TRANSICAO`): o Safari avisa a altura nova quando o teclado
 *     COMEÇA a subir, e a caixa de escrever sobe junto com ele.
 *   - O dedo não arrasta a página: só rola o que tem para onde rolar (as
 *     mensagens, a caixa comprida, a lista de emojis).
 *   - Atrás da camada, a página fica da cor da caixa de escrever: qualquer fresta
 *     entre a caixa e o teclado é da cor dela, nunca preta.
 *   - A medida é refeita a cada quadro por um segundo depois de cada aviso e de
 *     cada toque no campo (`ACOMPANHAR_MS`), porque o Safari às vezes não manda
 *     o último aviso.
 * No Android a página de Conversas pede que a janela encolha com o teclado
 * (`interactiveWidget: 'resizes-content'`, em `app/(app)/conversas/page.tsx`),
 * como o WhatsApp de lá.
 *
 * `--folga-inferior` é a área segura de baixo (a barrinha do iPhone) com o
 * teclado fechado, e zero com ele aberto — o teclado já ocupa aquele lugar.
 * `--altura-visivel` é a altura da camada: a caixa de escrever cresce até 30%
 * dela (`responder.tsx`), ~5 linhas com o teclado aberto e dez sem ele.
 *
 * Uso: a camada leva `data-area-visivel` enquanto `ativo`.
 */
export function useAreaVisivel(ativo: boolean): void {
  // A maior altura vista é a tela sem teclado: no iPhone e no Android a janela
  // encolhe junto com o teclado, e `innerHeight` não serve de referência.
  const semTeclado = useRef(0);

  useEffect(() => {
    if (!ativo) return;
    const html = document.documentElement;
    const corpo = document.body;
    const antes = {
      html: html.style.overflow,
      corpo: corpo.style.overflow,
      fundoHtml: html.style.backgroundColor,
      fundoCorpo: corpo.style.backgroundColor,
    };
    html.style.overflow = 'hidden';
    corpo.style.overflow = 'hidden';
    html.style.backgroundColor = FUNDO;
    corpo.style.backgroundColor = FUNDO;

    const vv = window.visualViewport;
    let largura = window.innerWidth;
    semTeclado.current = Math.max(window.innerHeight, vv?.height ?? 0);

    // Se o Safari rolar de novo a cada volta, a camada desiste até o próximo
    // toque num campo (ou a saída dele): brigar seria a página pulando.
    let devolucoes: number[] = [];
    let desistiu = false;
    const voltarAoTopo = () => {
      if (desistiu || (window.scrollY === 0 && window.scrollX === 0)) return;
      const agora = performance.now();
      devolucoes = devolucoes.filter((t) => agora - t < 1000);
      if (devolucoes.length >= DEVOLUCOES) {
        desistiu = true;
        registrarTeclado('desistiu');
        return;
      }
      devolucoes.push(agora);
      window.scrollTo(0, 0);
      registrarTeclado('devolveu');
    };

    const aplicar = (motivo: string) => {
      // Virar o celular troca a tela sem teclado.
      if (window.innerWidth !== largura) {
        largura = window.innerWidth;
        semTeclado.current = window.innerHeight;
      }
      semTeclado.current = Math.max(semTeclado.current, window.innerHeight);
      voltarAoTopo();
      aplicarAreaVisivel(semTeclado.current);
      registrarTeclado(motivo);
    };

    let quadro = 0;
    let ate = 0;
    const acompanhar = (motivo: string) => {
      aplicar(motivo);
      ate = performance.now() + ACOMPANHAR_MS;
      if (quadro) return;
      const passo = () => {
        aplicar('quadro');
        quadro = performance.now() < ate ? requestAnimationFrame(passo) : 0;
      };
      quadro = requestAnimationFrame(passo);
    };
    const daAreaVisivel = (e: Event) => acompanhar(`area.${e.type}`);
    const daJanela = (e: Event) => acompanhar(`janela.${e.type}`);
    const doCampo = (e: Event) => {
      devolucoes = [];
      desistiu = false;
      acompanhar(e.type);
    };

    let dedo: { x: number; y: number } | null = null;
    const aoTocar = (e: TouchEvent) => {
      const t = e.touches[0];
      dedo = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
    };
    const aoArrastar = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!dedo || !t || e.touches.length !== 1 || !e.cancelable) return;
      const dx = t.clientX - dedo.x;
      const dy = t.clientY - dedo.y;
      dedo = { x: t.clientX, y: t.clientY };
      if (dx === 0 && dy === 0) return;
      if (!temParaOndeRolar(e.target, dx, dy)) e.preventDefault();
    };

    acompanhar('abriu');
    vv?.addEventListener('resize', daAreaVisivel);
    vv?.addEventListener('scroll', daAreaVisivel);
    window.addEventListener('resize', daJanela);
    window.addEventListener('scroll', daJanela, { passive: true });
    document.addEventListener('focusin', doCampo);
    document.addEventListener('focusout', doCampo);
    document.addEventListener('touchstart', aoTocar, { passive: true });
    document.addEventListener('touchmove', aoArrastar, { passive: false });
    return () => {
      cancelAnimationFrame(quadro);
      html.style.overflow = antes.html;
      corpo.style.overflow = antes.corpo;
      html.style.backgroundColor = antes.fundoHtml;
      corpo.style.backgroundColor = antes.fundoCorpo;
      vv?.removeEventListener('resize', daAreaVisivel);
      vv?.removeEventListener('scroll', daAreaVisivel);
      window.removeEventListener('resize', daJanela);
      window.removeEventListener('scroll', daJanela);
      document.removeEventListener('focusin', doCampo);
      document.removeEventListener('focusout', doCampo);
      document.removeEventListener('touchstart', aoTocar);
      document.removeEventListener('touchmove', aoArrastar);
      for (const camada of document.querySelectorAll<HTMLElement>(SELETOR)) limpar(camada);
    };
  }, [ativo]);

  // A camada pode trocar enquanto a tela cheia continua (de uma conversa de
  // parceiro para uma de cliente): a nova já nasce com a medida certa.
  useLayoutEffect(() => {
    if (ativo) {
      aplicarAreaVisivel(
        Math.max(semTeclado.current, window.innerHeight, window.visualViewport?.height ?? 0),
      );
    }
  });
}

const SELETOR = '[data-area-visivel]';

/** A cor da caixa de escrever, atrás da camada. */
const FUNDO = 'var(--wpp-painel2)';

/** Quanto a altura tem de cair para contar como teclado aberto. */
const TECLADO_PX = 120;

/** Por quanto tempo, depois de cada aviso, a medida é refeita a cada quadro. */
const ACOMPANHAR_MS = 1000;

/** Quantas vezes por segundo a página volta ao topo antes de a camada desistir dela. */
const DEVOLUCOES = 4;

/** A subida e a descida do teclado do iPhone: ~0,28 s, rápida no começo. */
const TRANSICAO = 'height 280ms cubic-bezier(0.2, 0.8, 0.2, 1)';

/**
 * O teclado do celular, de pé, nunca cobre mais que ~60% da tela: uma camada
 * menor que 40% dela é número de passagem, não a área que sobrou.
 */
const MENOR_FRACAO = 0.4;

/**
 * Onde a camada fica e que altura ela tem, a partir da área visível. É conta pura
 * (testada em `area-visivel.test.ts`) porque o teclado do iPhone não se reproduz
 * fora do iPhone.
 */
export function medirAreaVisivel({
  topoVisivel,
  rolagem,
  alturaVisivel,
  semTeclado,
}: {
  /** `visualViewport.offsetTop`: quanto a área visível foi empurrada para cima. */
  topoVisivel: number;
  /** `window.scrollY`: quanto a página rolou. */
  rolagem: number;
  /** `visualViewport.height`. */
  alturaVisivel: number;
  /** A maior altura já vista: a tela sem teclado. */
  semTeclado: number;
}): { topo: number; altura: number; teclado: boolean } {
  // O empurrão nunca passa do quanto a página rolou. Logo depois de a página
  // voltar ao topo, o Safari ainda conta o empurrão velho por um instante, e a
  // camada iria para baixo da tela.
  const topo = Math.max(0, Math.min(topoVisivel, rolagem));
  // A área visível nunca passa do fim da tela. No meio da subida, o iPhone já
  // empurrou a área (`topo`) e ainda conta a altura antiga: o que cabe acima do
  // teclado é o resto da tela. Fora da subida as duas contas dão o mesmo número.
  const cabe = Math.min(alturaVisivel, semTeclado - topo);
  const altura = Math.round(
    Math.max(cabe, Math.min(alturaVisivel, semTeclado * MENOR_FRACAO)),
  );
  return { topo: Math.round(topo), altura, teclado: semTeclado - altura > TECLADO_PX };
}

function aplicarAreaVisivel(semTeclado: number): void {
  const vv = window.visualViewport;
  const { topo, altura, teclado } = medirAreaVisivel({
    topoVisivel: vv?.offsetTop ?? 0,
    rolagem: window.scrollY,
    alturaVisivel: vv?.height ?? window.innerHeight,
    semTeclado,
  });
  const folga = teclado ? '0px' : 'env(safe-area-inset-bottom, 0px)';
  const transicao = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? ''
    : TRANSICAO;
  for (const camada of document.querySelectorAll<HTMLElement>(SELETOR)) {
    // Só escreve o que mudou: isto roda a cada quadro por um segundo.
    if (camada.style.transition !== transicao) camada.style.transition = transicao;
    if (camada.style.top !== `${topo}px`) camada.style.top = `${topo}px`;
    if (camada.style.height !== `${altura}px`) {
      camada.style.height = `${altura}px`;
      camada.style.setProperty('--altura-visivel', `${altura}px`);
    }
    if (camada.style.getPropertyValue('--folga-inferior') !== folga) {
      camada.style.setProperty('--folga-inferior', folga);
    }
  }
}

function limpar(camada: HTMLElement): void {
  camada.style.removeProperty('transition');
  camada.style.removeProperty('top');
  camada.style.removeProperty('height');
  camada.style.removeProperty('--altura-visivel');
  camada.style.removeProperty('--folga-inferior');
}

/**
 * O dedo que arrasta `dx`/`dy` vai rolar alguma coisa? Sobe do alvo até a página
 * procurando uma caixa que role naquele sentido e ainda tenha para onde ir.
 */
function temParaOndeRolar(alvo: EventTarget | null, dx: number, dy: number): boolean {
  const vertical = Math.abs(dy) >= Math.abs(dx);
  for (
    let el = alvo instanceof Element ? alvo : null;
    el && el !== document.body && el !== document.documentElement;
    el = el.parentElement
  ) {
    // No campo de texto o dedo arrasta o cursor, e no controle deslizante (a
    // posição do áudio) arrasta o controle: os dois ficam com o navegador.
    if (el.matches('input, textarea')) return true;
    const estilo = getComputedStyle(el);
    if (vertical) {
      if (!ROLA.has(estilo.overflowY) || el.scrollHeight <= el.clientHeight + 1) continue;
      // Dedo descendo mostra o que está em cima.
      if (dy > 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) {
        return true;
      }
    } else {
      if (!ROLA.has(estilo.overflowX) || el.scrollWidth <= el.clientWidth + 1) continue;
      if (dx > 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) {
        return true;
      }
    }
  }
  return false;
}

const ROLA = new Set(['auto', 'scroll']);
