'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { DiaDaLinha } from './tipos';
import { BotaoRedondo } from './wpp';

/**
 * O MIOLO DA CONVERSA NO JEITO DO WHATSAPP (03/11/2026), igual para as duas telas
 * de conversa (parceiro e cliente): o papel de parede com os desenhos de festa, a
 * pílula da janela de 24 h grudada no alto, as mensagens encostadas embaixo e o
 * botão redondo que desce até a mais recente.
 *
 * A pílula do dia também gruda no alto (`linha-do-tempo.tsx`), logo ABAIXO da
 * pílula da janela (04/11/2026): as duas grudavam no mesmo lugar e o "Hoje" ficava
 * escondido atrás da janela. A altura da janela muda (no celular estreito ela
 * quebra em duas linhas), então é medida, e vai para `--topo-do-dia`.
 */
export function AreaDoFio({
  rolagem,
  conteudo,
  aoRolar,
  longe,
  irAoFim,
  topo,
  children,
}: {
  rolagem: React.RefObject<HTMLDivElement | null>;
  conteudo: React.RefObject<HTMLDivElement | null>;
  aoRolar: () => void;
  /** Subiu o bastante para o botão de descer aparecer (`useRolagemNoFim`). */
  longe: boolean;
  irAoFim: () => void;
  /** A pílula grudada no alto: a janela de 24 h. */
  topo?: React.ReactNode;
  children: React.ReactNode;
}) {
  const toqueEm = useRef<{ x: number; y: number } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const pilula = useRef<HTMLDivElement>(null);
  const temTopo = Boolean(topo);
  useEffect(() => {
    const fora = area.current;
    const alto = pilula.current;
    if (!fora || !alto || typeof ResizeObserver === 'undefined') return;
    // 10 px da margem de cima da pílula e 6 px entre ela e a do dia.
    const medir = () => fora.style.setProperty('--topo-do-dia', `${alto.offsetHeight + 16}px`);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(alto);
    return () => {
      observador.disconnect();
      fora.style.removeProperty('--topo-do-dia');
    };
  }, [temTopo]);
  return (
    <div ref={area} className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={rolagem}
        onScroll={aoRolar}
        // TOCAR NA CONVERSA FECHA O TECLADO, como no WhatsApp (04/11/2026). No
        // navegador do celular o teclado só fecha pelo botão dele: um toque
        // parado (não um arrasto) no papel de parede ou num balão tira o foco da
        // caixa de escrever. Botões, links e players continuam fazendo o deles.
        onPointerDown={(e) => {
          toqueEm.current = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const de = toqueEm.current;
          toqueEm.current = null;
          if (!de || Math.hypot(e.clientX - de.x, e.clientY - de.y) > 10) return;
          if ((e.target as Element).closest('button, a, input, textarea, audio, video, [role]'))
            return;
          const ativo = document.activeElement;
          if (ativo instanceof HTMLTextAreaElement && ativo.id === 'resposta') ativo.blur();
        }}
        className="papel-de-parede min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
      >
        <div ref={conteudo} className="flex min-h-full flex-col">
          {topo ? (
            <div
              ref={pilula}
              className="pointer-events-none sticky top-2.5 z-20 mt-2.5 flex justify-center px-4"
            >
              <div className="pointer-events-auto">{topo}</div>
            </div>
          ) : null}
          {/* `mt-auto`: com pouca mensagem, elas encostam embaixo, perto da caixa
              de escrever, como no WhatsApp; o vazio fica em cima. */}
          <div className="mt-auto flex flex-col px-3 pt-1.5 pb-4 md:px-[6%] xl:px-[8%]">
            {children}
          </div>
        </div>
      </div>
      {longe ? (
        <button
          type="button"
          onClick={irAoFim}
          aria-label="Ir para a mensagem mais recente"
          className="absolute right-5 bottom-4 z-20 flex size-11 items-center justify-center rounded-full bg-wpp-painel text-wpp-suave shadow-wpp-pop outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronDown className="size-5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * O aviso "N mensagens não lidas" (03/11/2026): quantas o contato mandou desde a
 * última leitura, contadas NA ABERTURA. Abrir zera o "por ler" logo depois
 * (`leitura-do-fio.ts`), e o aviso fica onde estava até a conversa fechar, como no
 * WhatsApp. Ele entra antes da mais antiga delas.
 */
export function useAvisoDeNaoLidas(
  dias: readonly DiaDaLinha[],
  naoLidas: number,
): { quantas: number; antesDe: string } | null {
  const [naAbertura] = useState(naoLidas);
  return useMemo(() => {
    if (naAbertura <= 0) return null;
    const recebidas = dias.flatMap((d) =>
      d.eventos.filter((e) => e.mensagem?.entrada === true).map((e) => e.id),
    );
    if (recebidas.length === 0) return null;
    const quantas = Math.min(naAbertura, recebidas.length);
    return { quantas, antesDe: recebidas[recebidas.length - quantas]! };
  }, [dias, naAbertura]);
}

/**
 * A coluna da ficha ao lado da conversa, no computador ("Dados do contato" do
 * WhatsApp). Abre ao tocar no nome ou no ícone do painel, e fica aberta de uma
 * conversa para a outra.
 */
export function FichaAoLado({
  aoFechar,
  children,
  className,
}: {
  aoFechar: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <aside
      aria-label="Dados do contato"
      className={cn(
        'hidden w-[min(23rem,42%)] shrink-0 flex-col border-l border-wpp-linha bg-wpp-painel md:flex conversa-estreita:hidden',
        className,
      )}
    >
      <div className="flex h-16 shrink-0 items-center gap-1 border-b border-wpp-linha px-2.5">
        <BotaoRedondo onClick={aoFechar} aria-label="Fechar os dados do contato">
          <X aria-hidden="true" />
        </BotaoRedondo>
        <h2 className="text-[15px] font-semibold">Dados do contato</h2>
      </div>
      <div className="@container flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-5 pb-6">
        {children}
      </div>
    </aside>
  );
}

/** O título miúdo das seções da ficha e da folha do celular. */
export const ROTULO_DA_SECAO =
  'text-[11px] font-semibold tracking-[0.07em] text-wpp-suave uppercase';
