'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * ONDE A CONVERSA ABRE, E QUANDO ELA ACOMPANHA O FIM (20/10/2026).
 *
 * No fim, onde está a mensagem de agora: a coluna é cronológica ascendente, e
 * abrir no topo faria rolar cinco meses de histórico toda vez que alguém
 * escrevesse ("sempre que abrir, ir para a parte de baixo").
 *
 * É uma peça só para as DUAS telas de conversa — a do parceiro (`conversa.tsx`)
 * e a do cliente ou número fora da base (`fora-da-base.tsx`). A regra morava só
 * na primeira, e a conversa de cliente continuava abrindo no começo depois de a
 * correção ir ao ar.
 *
 * QUEM ESTÁ LENDO O HISTÓRICO NÃO É PUXADO PARA O FIM. Com o eco do banco,
 * chega mensagem enquanto a pessoa lê — e rolar a tela debaixo de quem está
 * lendo é a forma mais rápida de fazer alguém desistir de ler. A régua é onde
 * ela ESTAVA antes de a mensagem chegar: perto do fim, acompanha; lendo o
 * começo de agosto, fica onde está. Trocar de conversa sempre abre no fim,
 * porque aí a pessoa pediu outra coisa.
 *
 * SÓ CONTA A ROLAGEM QUE A PESSOA FEZ. O navegador também rola sozinho: quando
 * uma foto termina de carregar e cresce, ele ajusta a posição para segurar o
 * que estava na tela (scroll anchoring), e esse `scroll` era lido como se
 * alguém tivesse subido para ler — a conversa abria com a foto cortada e não
 * descia mais. Por isso a régua só se move logo depois de um gesto: roda,
 * toque, tecla ou a barra.
 *
 * O FIM ANDA DEPOIS QUE A CONVERSA ABRE. Fotos (`loading="lazy"`), áudios e a
 * leitura da IA chegam depois e empurram o fim para baixo; o aviso de quem
 * atende e o relógio da janela chegam depois e encolhem a coluna. Encolher não
 * dispara `scroll`, então a caixa é observada junto com o conteúdo.
 *
 * Uso: `rolagem` vai na caixa que rola (com `onScroll={aoRolar}`) e `conteudo`
 * num invólucro de tudo o que ela tem dentro.
 */
export function useRolagemNoFim(conversaId: string, quantas: number) {
  const rolagem = useRef<HTMLDivElement>(null);
  const conteudo = useRef<HTMLDivElement>(null);
  const coladoNoFim = useRef(true);
  // Começa sem gesto nenhum: com 0, o primeiro segundo e meio depois de abrir a
  // página (`performance.now()` conta dali) passava por gesto da pessoa.
  const gestoEm = useRef(Number.NEGATIVE_INFINITY);

  const aoRolar = useCallback(() => {
    const caixa = rolagem.current;
    if (!caixa) return;
    if (performance.now() - gestoEm.current > JANELA_DO_GESTO_MS) return;
    coladoNoFim.current = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < FOLGA_DO_FIM;
  }, []);

  useEffect(() => {
    const caixa = rolagem.current;
    if (!caixa) return;
    const marcar = () => {
      gestoEm.current = performance.now();
    };
    // As teclas que rolam chegam ao `body`, não à caixa: a coluna não recebe foco.
    // Quem digita na resposta não está rolando a conversa.
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo?.closest('input, textarea, [contenteditable="true"]')) return;
      if (TECLAS_QUE_ROLAM.has(e.key)) marcar();
    };
    for (const tipo of GESTOS) caixa.addEventListener(tipo, marcar, { passive: true });
    document.addEventListener('keydown', tecla);
    return () => {
      for (const tipo of GESTOS) caixa.removeEventListener(tipo, marcar);
      document.removeEventListener('keydown', tecla);
    };
  }, []);

  const conversaAnterior = useRef<string | null>(null);
  useEffect(() => {
    const caixa = rolagem.current;
    if (!caixa) return;
    const trocouDeConversa = conversaAnterior.current !== conversaId;
    conversaAnterior.current = conversaId;
    if (trocouDeConversa) coladoNoFim.current = true;

    if (quantas > 0 && (trocouDeConversa || coladoNoFim.current)) {
      caixa.scrollTop = caixa.scrollHeight;
    }
  }, [conversaId, quantas]);

  useEffect(() => {
    const caixa = rolagem.current;
    const dentro = conteudo.current;
    if (!caixa || !dentro || typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(() => {
      if (coladoNoFim.current) caixa.scrollTop = caixa.scrollHeight;
    });
    observador.observe(dentro);
    observador.observe(caixa);
    return () => observador.disconnect();
  }, []);

  // Quem foi ATÉ uma mensagem (a citação, a lupa, a busca da lista) não pode ser
  // puxado de volta para o fim pela próxima foto que terminar de carregar
  // (27/10/2026). O gesto da pessoa recola, como sempre.
  const soltar = useCallback(() => {
    coladoNoFim.current = false;
  }, []);

  return { rolagem, conteudo, aoRolar, soltar };
}

/** Quantos pixels do fim ainda contam como "está no fim". */
const FOLGA_DO_FIM = 120;
/** Quanto tempo depois de um gesto a rolagem ainda é da pessoa (cobre a inércia do toque). */
const JANELA_DO_GESTO_MS = 1500;
const GESTOS = ['wheel', 'touchstart', 'touchmove', 'touchend', 'pointerdown'] as const;
const TECLAS_QUE_ROLAM = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
]);
