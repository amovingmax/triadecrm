'use client';

import { useDraggable } from '@dnd-kit/core';
import { ArrowRightLeft, GripVertical } from 'lucide-react';

import { CartaoNegocio } from './cartao';
import type { DadosDoCartao } from './quadro-teclado';
import type { CartaoQuadro } from './tipos';

/**
 * O cartão do quadro, com o arraste pendurado (RF-FUN-01).
 *
 * O desenho do cartão é do `CartaoNegocio`, que de propósito "não sabe arrastar": ele
 * aceita `ref`, ouvintes e o estado visual (`arrastando`, `fantasma`) pelas props.
 * Este arquivo é a única coisa que sabe de dnd-kit no caminho do cartão — assim o
 * mesmo componente serve à coluna do desktop e à lista do celular, onde não há
 * arraste nenhum.
 *
 * ---------------------------------------------------------------------------
 * Por que os ouvintes vão no cartão e o `attributes` vai na alça
 * ---------------------------------------------------------------------------
 * Com o mouse, a área de pegar tem de ser o retângulo inteiro: obrigar a mira numa
 * alça de 16px num quadro de doze colunas é atrito puro. Com o teclado, o contrário:
 * o `KeyboardSensor` do dnd-kit só aceita a tecla de espaço quando ela vem do nó
 * ativador (`event.target !== activator` recusa), então precisa existir UM alvo
 * focável e só um.
 *
 * A solução é a que o próprio dnd-kit prevê: `listeners` no `<article>` (pega em
 * qualquer lugar) e `attributes` mais `setActivatorNodeRef` na alça (papel, tabindex e
 * descrição de papel num ponto só). A tecla apertada na alça sobe por borbulhamento
 * até o cartão e ativa o mesmo sensor. Nada é ouvido duas vezes, porque o ouvinte
 * existe uma vez só.
 *
 * A alça mora no slot `acoes` do cartão, que já sobe de camada (`z-10`) acima do link
 * esticado do nome — senão pegar na alça abriria a ficha do parceiro.
 */

/** Alça de arraste: o alvo focável do teclado e a dica visual de que o cartão se move. */
function AlcaDeArraste({
  ref,
  nome,
  ...resto
}: {
  ref: (elemento: HTMLElement | null) => void;
  nome: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      ref={ref}
      {...resto}
      aria-label={`Mover ${nome} de etapa`}
      title="Arraste, ou aperte espaço e use as setas."
      className="inline-flex h-7 cursor-grab items-center gap-1 rounded-lg px-1.5 text-[0.6875rem] text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
    >
      <GripVertical className="size-3.5" aria-hidden="true" />
      Mover
    </span>
  );
}

/** Botão de mover do celular: lá não há arraste, o destino se escolhe na folha. */
function BotaoMover({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="toque inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-hairline text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ArrowRightLeft className="size-4" aria-hidden="true" />
      Mover de etapa
    </button>
  );
}

export function CartaoArrastavel({
  cartao,
  etapaId,
  emVoo = false,
  aoMover,
}: {
  cartao: CartaoQuadro;
  etapaId: number;
  /** O banco ainda não respondeu sobre este cartão: fica apagado e sem toque. */
  emVoo?: boolean;
  /** Abre a folha de mover; a alça de arraste continua existindo em paralelo. */
  aoMover: () => void;
}) {
  const dados: DadosDoCartao = {
    tipo: 'cartao',
    dealId: cartao.deal_id,
    deEtapaId: etapaId,
    nome: cartao.organization_name,
  };

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: cartao.deal_id,
    data: dados,
    disabled: emVoo,
    attributes: { roleDescription: 'cartão de negócio' },
  });

  return (
    <CartaoNegocio
      ref={setNodeRef}
      cartao={cartao}
      {...listeners}
      // O cartão continua no lugar, apagado, enquanto o fantasma segue o ponteiro:
      // sumir com ele encolheria a coluna e o alvo pularia debaixo da mão.
      fantasma={isDragging || emVoo}
      className={emVoo ? 'pointer-events-none' : 'shrink-0'}
      acoes={
        <>
          <span className="w-full md:hidden">
            <BotaoMover onClick={aoMover} />
          </span>
          <span className="hidden md:inline-flex">
            <AlcaDeArraste
              ref={setActivatorNodeRef}
              nome={cartao.organization_name}
              {...attributes}
            />
          </span>
        </>
      }
    />
  );
}

/** O cartão que acompanha o ponteiro (e o foco do teclado) durante o arraste. */
export function CartaoEmVoo({ cartao }: { cartao: CartaoQuadro }) {
  return (
    <CartaoNegocio
      cartao={cartao}
      href={null}
      arrastando
      className="w-72 rotate-1 cursor-grabbing"
    />
  );
}
