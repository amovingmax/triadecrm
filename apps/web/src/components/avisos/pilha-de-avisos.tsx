'use client';

import { BellRing, MessageCircle, Phone, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { hora } from '@/components/conversas/formatos';
import { Button } from '@/components/ui/button';
import { iniciaisDe } from '@/lib/iniciais';
import { cn } from '@/lib/utils';

import { avisarDaPermissao } from './convite-de-avisos';
import { useAvisos, type CartaoDeAviso } from './provedor-avisos';

/**
 * A pilha de avisos: os cartões "Nova mensagem" no canto de cima da tela.
 *
 * ===========================================================================
 * POR QUE UM CARTÃO PRÓPRIO, E NÃO O AVISO PADRÃO
 * ===========================================================================
 * A primeira versão usava o aviso flutuante do sistema (`sonner`): uma linha
 * pequena no centro do topo, igual à de "Conversa arquivada". Janio, 01/10/2026:
 * "deve aparecer um pop-up mais profissional e que seja muito claro que tem uma
 * nova mensagem". Mensagem de gente esperando resposta não pode ter a mesma cara
 * de uma confirmação de clique.
 *
 * O cartão diz, nesta ordem: QUE é mensagem nova (a faixa e o selo em menta, a
 * única cor da casca), DE QUEM (o nome em destaque), O QUÊ (o começo do texto) e
 * o que fazer (Responder). É o que um aplicativo de mensagens mostra, e é o que
 * o time já sabe ler.
 *
 * ===========================================================================
 * COMO ELE SE COMPORTA
 * ===========================================================================
 * - Fica no canto de cima, à direita no desktop e de ponta a ponta no celular,
 *   abaixo do cabeçalho: longe da caixa de resposta de Conversas, que mora
 *   embaixo. O convite de permissão morava no canto de baixo e a cobria.
 * - Some sozinho, e só conta o tempo enquanto a pessoa está OLHANDO: com a aba
 *   escondida ou a janela sem foco o cartão espera. Quem voltou do almoço
 *   encontra o que chegou.
 * - O mouse em cima, ou o foco do teclado, para o relógio: ninguém perde o
 *   cartão enquanto lê.
 * - Três de cada vez no desktop, um no celular. O resto vira uma linha de
 *   resumo — dez cartões empilhados cobririam a tela para dizer o que o número
 *   ao lado de Conversas já diz, e em 390 px dois já tomam metade dela.
 */

/** Quanto o cartão fica na tela, com a pessoa olhando e sem o mouse em cima. */
export const DURACAO_DO_CARTAO_MS = 12_000;

/** Quantos cartões aparecem de uma vez. */
const CARTOES_A_VISTA = 3;

function inscreverNaVista(ouvinte: () => void): () => void {
  document.addEventListener('visibilitychange', ouvinte);
  window.addEventListener('focus', ouvinte);
  window.addEventListener('blur', ouvinte);
  return () => {
    document.removeEventListener('visibilitychange', ouvinte);
    window.removeEventListener('focus', ouvinte);
    window.removeEventListener('blur', ouvinte);
  };
}

const aVista = (): boolean => !document.hidden && document.hasFocus();
const aVistaNoServidor = (): boolean => true;

/** A pessoa está olhando o CRM agora? */
function useAVista(): boolean {
  return useSyncExternalStore(inscreverNaVista, aVista, aVistaNoServidor);
}

export function PilhaDeAvisos() {
  const {
    cartoes,
    dispensarCartao,
    dispensarTodos,
    abrirConversa,
    conviteAberto,
    pedirPermissao,
    dispensarConvite,
  } = useAvisos();
  const olhando = useAVista();

  if (cartoes.length === 0 && !conviteAberto) return null;

  const mostrados = cartoes.slice(0, CARTOES_A_VISTA);
  const resto = cartoes.length - mostrados.length;

  return (
    <div
      role="region"
      aria-label="Avisos de mensagem"
      // `pointer-events-none` na pilha e `auto` em cada cartão: o espaço entre
      // eles, e ao lado deles, continua clicável.
      className="pointer-events-none fixed inset-x-3 top-16 z-40 flex flex-col gap-2.5 md:inset-x-auto md:top-[84px] md:right-5 md:w-[23.5rem]"
    >
      {mostrados.map((cartao, posicao) => (
        <Cartao
          key={cartao.conversaId}
          cartao={cartao}
          olhando={olhando}
          // No celular só o mais novo: os outros entram na linha de resumo.
          className={posicao > 0 ? 'max-md:hidden' : undefined}
          aoAbrir={() => abrirConversa(cartao)}
          aoDispensar={() => dispensarCartao(cartao.conversaId)}
        />
      ))}

      {/* A linha de resumo conta o que NÃO está à vista — e isso muda com a
          largura: no celular é tudo menos o primeiro. */}
      <Resumo quantas={cartoes.length - 1} aoDispensar={dispensarTodos} className="md:hidden" />
      <Resumo quantas={resto} aoDispensar={dispensarTodos} className="max-md:hidden" />

      {conviteAberto ? (
        <Moldura rotulo="Avisos de mensagem neste navegador">
          <div className="flex items-start gap-3 py-3.5 pr-4 pl-5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-menta text-menta-tinta">
              <BellRing className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-[15px] leading-snug font-semibold">
                Quer ser avisado quando chegar mensagem?
              </p>
              <p className="text-sm leading-snug text-muted-foreground">
                O navegador mostra um aviso mesmo com o CRM em outra aba.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-hairline py-2.5 pr-3 pl-5">
            <Button
              size="lg"
              className="toque h-11 flex-1 md:h-9"
              onClick={() => void pedirPermissao().then(avisarDaPermissao)}
            >
              Ativar avisos
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="toque h-11 md:h-9"
              onClick={dispensarConvite}
            >
              Agora não
            </Button>
          </div>
        </Moldura>
      ) : null}
    </div>
  );
}

/** "Mais 4 conversas com mensagem nova": o que não coube nos cartões. */
function Resumo({
  quantas,
  aoDispensar,
  className,
}: {
  quantas: number;
  aoDispensar: () => void;
  className?: string;
}) {
  if (quantas <= 0) return null;
  return (
    <div
      className={cn(
        'sombra-base-forte pointer-events-auto flex items-center justify-between gap-3 rounded-2xl border border-hairline bg-popover py-2 pr-2 pl-4 text-popover-foreground',
        className,
      )}
    >
      <p className="text-sm">
        Mais <span className="numerico font-semibold">{quantas}</span>{' '}
        {quantas === 1 ? 'conversa com mensagem nova' : 'conversas com mensagem nova'}
      </p>
      <Button variant="ghost" size="lg" className="toque h-11 md:h-9" onClick={aoDispensar}>
        Dispensar todas
      </Button>
    </div>
  );
}

/** O cartão por fora: a faixa de menta à esquerda é o que o separa de qualquer outro aviso. */
function Moldura({
  rotulo,
  children,
  className,
  ...resto
}: {
  rotulo: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<'section'>, 'aria-label'>) {
  return (
    <section
      aria-label={rotulo}
      className={cn(
        'sombra-base-forte pointer-events-auto relative overflow-hidden rounded-2xl border border-hairline bg-popover text-popover-foreground',
        'animate-in duration-300 fade-in-0 slide-in-from-top-2 md:slide-in-from-right-6',
        className,
      )}
      {...resto}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-menta" />
      {children}
    </section>
  );
}

function Cartao({
  cartao,
  olhando,
  aoAbrir,
  aoDispensar,
  className,
}: {
  cartao: CartaoDeAviso;
  olhando: boolean;
  aoAbrir: () => void;
  aoDispensar: () => void;
  className?: string;
}) {
  // O mouse em cima ou o foco dentro: a pessoa está lendo, e o cartão espera.
  const [segurando, setSegurando] = useState(false);
  const contando = olhando && !segurando;

  // O relógio recomeça do zero quando a pessoa solta o cartão, e quando a mesma
  // conversa manda outra mensagem (`chegouEm` muda).
  useEffect(() => {
    if (!contando) return;
    const id = window.setTimeout(aoDispensar, DURACAO_DO_CARTAO_MS);
    return () => window.clearTimeout(id);
  }, [contando, aoDispensar, cartao.chegouEm]);

  const semNome = cartao.nome.startsWith('Número ');

  return (
    <Moldura
      rotulo={`Nova mensagem de ${cartao.nome}`}
      className={className}
      // `status`, e não `alert`: avisa o leitor de tela sem interromper o que a
      // pessoa está ouvindo.
      role="status"
      onMouseEnter={() => setSegurando(true)}
      onMouseLeave={() => setSegurando(false)}
      onFocus={() => setSegurando(true)}
      onBlur={() => setSegurando(false)}
    >
      <div className="flex items-start gap-3 py-3.5 pr-2 pl-5">
        <span className="relative mt-0.5 flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
          {semNome ? <Phone className="size-4.5" aria-hidden="true" /> : iniciaisDe(cartao.nome)}
          {/* O selo do canal no ombro do avatar, para fora dele: diz "WhatsApp"
              sem gastar uma linha e sem cobrir as iniciais. */}
          <span className="absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full bg-menta text-menta-tinta ring-2 ring-popover">
            <MessageCircle className="size-2.5" aria-hidden="true" strokeWidth={2.75} />
          </span>
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            {/* O selo cheio em menta é o que diz, antes de qualquer leitura, que
                isto é mensagem de gente esperando — e não uma confirmação de clique. */}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-menta py-0.5 pr-2 pl-1.5 text-[11px] leading-4 font-semibold tracking-[0.04em] text-menta-tinta uppercase">
              <span aria-hidden="true" className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-menta-tinta opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex size-1.5 rounded-full bg-menta-tinta" />
              </span>
              Nova mensagem
            </span>
            <span className="numerico text-xs text-muted-foreground">{hora(cartao.chegouEm)}</span>
          </p>
          <p className="mt-1 truncate text-[15px] leading-snug font-semibold">{cartao.nome}</p>
          {cartao.previa ? (
            <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-muted-foreground">
              {cartao.previa}
            </p>
          ) : null}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="toque size-9 shrink-0 text-muted-foreground"
          onClick={aoDispensar}
          aria-label={`Dispensar o aviso de ${cartao.nome}`}
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className="border-t border-hairline py-2.5 pr-3 pl-5">
        <Button size="lg" className="toque h-11 w-full md:h-9" onClick={aoAbrir}>
          Responder
        </Button>
      </div>

      {/* Quanto tempo o cartão ainda fica. Decoração: quem manda é o relógio
          acima, e por isso a barra recomeça junto com ele (`key`). */}
      {contando ? (
        <span
          key={cartao.chegouEm}
          aria-hidden="true"
          className="absolute bottom-0 left-1.5 h-0.5 w-full origin-left bg-menta/70 motion-reduce:hidden"
          style={{ animation: `aviso-esvazia ${DURACAO_DO_CARTAO_MS}ms linear forwards` }}
        />
      ) : null}
    </Moldura>
  );
}
