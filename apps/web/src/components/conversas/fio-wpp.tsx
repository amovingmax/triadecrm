'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { DiaDaLinha } from './tipos';
import { BotaoRedondo } from './wpp';

/**
 * O MIOLO DA CONVERSA NO JEITO DO WHATSAPP (03/11/2026), igual para as duas telas
 * de conversa (parceiro e cliente): o papel de parede com os desenhos de festa, as
 * mensagens encostadas embaixo e o botão redondo que desce até a mais recente.
 *
 * A janela de 24 h saiu daqui (protótipo responsivo, 24/11/2026): era uma pílula
 * grudada no alto do papel de parede e cobria a primeira mensagem e a data. Agora
 * é uma faixa própria acima dele (`AvisoDaJanela`), e o alto é só da pílula do dia.
 *
 * A DATA GRUDADA SÓ APARECE ENQUANTO SE ROLA (24/11/2026), como no WhatsApp: parada,
 * ela cobria a mensagem de cima. Quem diz se a data está grudada é a posição dela
 * (no topo de grude do contêiner, ou acima dele sendo empurrada pela seguinte), e
 * a marca vai direto no elemento (`data-grudada`), sem redesenhar a conversa a cada
 * quadro de rolagem. `data-parado` vai no contêiner 1,2 s depois que a rolagem para;
 * as duas juntas apagam a data (`linha-do-tempo.tsx`). As datas no fluxo, fora do
 * topo, ficam sempre à vista.
 */
const DATA_SOME_EM_MS = 1200;
export function AreaDoFio({
  rolagem,
  conteudo,
  aoRolar,
  longe,
  irAoFim,
  children,
}: {
  rolagem: React.RefObject<HTMLDivElement | null>;
  conteudo: React.RefObject<HTMLDivElement | null>;
  aoRolar: () => void;
  /** Subiu o bastante para o botão de descer aparecer (`useRolagemNoFim`). */
  longe: boolean;
  irAoFim: () => void;
  children: React.ReactNode;
}) {
  const toqueEm = useRef<{ x: number; y: number } | null>(null);
  const relogioDaData = useRef<number | undefined>(undefined);

  const marcarDatas = useCallback(() => {
    const caixa = rolagem.current;
    if (!caixa) return;
    const topo = caixa.getBoundingClientRect().top;
    for (const dia of caixa.querySelectorAll<HTMLElement>('[data-dia]')) {
      const grude = Number.parseFloat(getComputedStyle(dia).top) || 0;
      const r = dia.getBoundingClientRect();
      dia.toggleAttribute('data-grudada', r.top - (topo + grude) <= 1 && r.bottom > topo);
    }
  }, [rolagem]);

  // Parada desde a abertura; a cada mudança de altura (mensagem nova, imagem que
  // carregou) as marcas são refeitas.
  useEffect(() => {
    const caixa = rolagem.current;
    if (!caixa) return;
    caixa.setAttribute('data-parado', '');
    marcarDatas();
    const dentro = conteudo.current;
    if (!dentro || typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(marcarDatas);
    observador.observe(dentro);
    return () => observador.disconnect();
  }, [rolagem, conteudo, marcarDatas]);
  useEffect(() => () => window.clearTimeout(relogioDaData.current), []);

  const aoRolarNoFio = () => {
    aoRolar();
    const caixa = rolagem.current;
    if (!caixa) return;
    caixa.removeAttribute('data-parado');
    marcarDatas();
    window.clearTimeout(relogioDaData.current);
    relogioDaData.current = window.setTimeout(
      () => caixa.setAttribute('data-parado', ''),
      DATA_SOME_EM_MS,
    );
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={rolagem}
        onScroll={aoRolarNoFio}
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
        className="papel-de-parede group/fio min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
      >
        <div ref={conteudo} className="flex min-h-full flex-col">
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
 * conversa para a outra. Só a partir de 1280 px (protótipo responsivo,
 * 24/11/2026): abaixo disso a conversa ficava espremida entre a lista e a ficha,
 * e quem abre a ficha recebe a folha (`conversa.tsx`).
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
        'hidden w-[min(23rem,42%)] shrink-0 flex-col border-l border-wpp-linha bg-wpp-painel xl:flex conversa-estreita:hidden',
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

/**
 * A faixa "O cliente ligou… e ninguém atendeu" (`FaixaDaLigacao`, do módulo de
 * ligação) no tamanho e na margem da faixa da janela de 24 h logo abaixo dela
 * (24/11/2026). Quando o aviso é de ligação perdida (o texto em vermelho), o
 * fundo também fica vermelho-claro, como no protótipo.
 */
export const CLASSE_DA_FAIXA_DA_LIGACAO =
  'border-b border-wpp-linha px-4 py-2 text-[13px] leading-snug md:px-5 conversa-estreita:px-4 [&.text-destructive-texto]:bg-quente-fundo [&.text-destructive-texto]:text-quente-texto';

/** O título miúdo das seções da ficha e da folha do celular. */
export const ROTULO_DA_SECAO =
  'text-[11px] font-semibold tracking-[0.07em] text-wpp-suave uppercase';

/**
 * A GRADE DAS AÇÕES, igual na coluna "Dados do contato" e na folha do celular
 * (17/11/2026). Quantas colunas cabem é a largura de quem a contém que diz, e não
 * a da janela: duas colunas a partir de 9rem cada (a coluna do computador tem de
 * 300 a 340 px; a folha, 343 px em 375), uma só quando nem isso cabe.
 *
 * Era `grid-cols-1` no computador e `grid-cols-2` na folha, e o "Assumir conversa"
 * com `col-span-2` criava na coluna uma segunda trilha implícita, do tamanho do
 * conteúdo: "Enviar link da agenda" ficava com 100 px e invadia o "Transferir", e
 * em 1280 o "Transferir" perdia o nome. Quem ocupa a linha inteira usa
 * `col-span-full`, que não cria trilha. `dense`: o aviso de uma ação, de largura
 * inteira, não deixa buraco ao lado dela (o vizinho sobe para a mesma linha).
 */
export const GRADE_DAS_ACOES =
  'grid grid-flow-row-dense grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-2';

/**
 * Uma ação da grade: bloco de pelo menos 56 px, ícone e nome. O nome quebra
 * (`whitespace-normal`) e o bloco cresce com ele (`min-h-14`, não `h-14`): com
 * altura fixa, um nome em três linhas vazava pela borda. A palavra que sozinha
 * não cabe ("Fornecedores", 93 px) quebra no meio em vez de vazar
 * (`overflow-wrap: anywhere`), o que só acontece abaixo de 9rem.
 */
export const ACAO_DA_FOLHA =
  'toque h-auto min-h-14 w-full justify-start gap-2 rounded-xl px-3 py-2 text-left text-[15px] leading-tight font-medium whitespace-normal [overflow-wrap:anywhere] md:h-auto';
