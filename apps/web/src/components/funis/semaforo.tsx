import { cn } from '@/lib/utils';

import { formatarPrazoProximaAcao } from './cartao-formatos';
import { SEMAFORO_PROXIMA_ACAO, type EstadoProximaAcao } from './tipos';

/**
 * O semáforo da próxima ação, no cartão do funil (RF-FUN-03).
 *
 * Este arquivo já teve DOIS semáforos. O `SemaforoTermico` — medidor de cinco
 * talos mais a palavra "Frio/Morno/Quente" — foi apagado em 28/09/2026 junto com
 * a temperatura no cartão (ADR-16): as 12 etapas do funil apareciam na tela como
 * três cores, e Rafael recusou isso com todas as letras ("o fato de só o lead
 * responder e ele já virar morno não faz sentido e tá errado"). Quem ocupa a
 * borda esquerda do cartão agora é a `BarraEtapa`, em `etapa.tsx`. A escala
 * térmica continua viva, e continua pintando os relatórios.
 *
 * A regra que sobrou é a mesma que governava os dois, e é o motivo de este
 * arquivo existir em vez de um punhado de `<span>` dentro do cartão: **nenhum
 * estado pode depender só de cor.** A Heloísa lê esta coluna no celular, na rua,
 * no sol de Natal, e uma parte das pessoas não separa vermelho de verde.
 *
 * ---------------------------------------------------------------------------
 * `SemaforoProximaAcao` — se alguém vai fazer alguma coisa, e quando
 * ---------------------------------------------------------------------------
 * Este é ACROMÁTICO de propósito, e não por descuido. O semáforo de trânsito pedia
 * verde, amarelo e vermelho, e é exatamente o que não pode acontecer aqui: verde já
 * significa "fechou" em outras telas do produto, e vermelho já significa "quente" na
 * escala térmica dos relatórios. Então o estado vem de **silhueta** (quatro desenhos
 * que se distinguem a 12px), de **peso** (o vencido e o sem-ação ficam em tinta cheia
 * e 500; o agendado fica esmaecido) e do **texto** do prazo, que está sempre lá.
 *
 *   anel cortado  Sem próxima ação   o "!" do RF-FUN-03: nada marcado
 *   disco cheio   Hoje, 09:00        é hoje, resolve hoje
 *   anel vazado   Em 3d              está agendada, pode seguir
 *   triângulo     Atrasada 4d        venceu e ninguém fez
 */

/* ==========================================================================
   Semáforo da próxima ação
   ========================================================================== */

/** Silhueta de cada estado, em 16x16, pintada com `currentColor`. */
function Silhueta({ estado }: { estado: EstadoProximaAcao }) {
  const comum = {
    className: 'size-3.5 shrink-0',
    viewBox: '0 0 16 16',
    'aria-hidden': true,
  } as const;

  if (estado === 'hoje') {
    // Disco cheio: a forma mais "presente" das quatro, para o que é para hoje.
    return (
      <svg {...comum}>
        <circle cx="8" cy="8" r="5.5" fill="currentColor" />
      </svg>
    );
  }

  if (estado === 'atrasada') {
    // Triângulo: a única silhueta angulosa do conjunto, e a que o olho acha primeiro
    // varrendo uma coluna cheia de círculos.
    return (
      <svg {...comum}>
        <path d="M8 2.2 14.6 13.4H1.4Z" fill="currentColor" />
      </svg>
    );
  }

  if (estado === 'sem') {
    // Anel cortado: "não há nada marcado". A barra atravessa o anel inteiro, então a
    // silhueta continua diferente do anel vazado mesmo em 12px.
    return (
      <svg {...comum} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="8" cy="8" r="5" />
        <path d="M4.5 11.5 11.5 4.5" />
      </svg>
    );
  }

  // Agendada: anel vazado, o estado de repouso.
  return (
    <svg {...comum} fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="8" cy="8" r="5" />
    </svg>
  );
}

export function SemaforoProximaAcao({
  estado,
  quando,
  className,
}: {
  estado: EstadoProximaAcao;
  /** `deals.next_action_at` em ISO; `null` quando não há ação marcada. */
  quando: string | null;
  className?: string;
}) {
  const prazo = formatarPrazoProximaAcao(estado, quando);

  return (
    <span
      data-proxima-acao={estado}
      title={prazo.descricao}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap',
        // Peso e tinta, nunca matiz: cor nesta interface quer dizer temperatura.
        prazo.urgente ? 'font-medium text-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      <Silhueta estado={estado} />
      <span aria-hidden="true">
        {prazo.prefixo}
        {prazo.numero ? <span className="numerico">{prazo.numero}</span> : null}
        {/* A unidade vem colada e menor, como em `DiasSemContato`: o olho cai no número. */}
        {prazo.unidade ? <span className="text-[0.8em]">{prazo.unidade}</span> : null}
      </span>
      <span className="sr-only">
        {SEMAFORO_PROXIMA_ACAO[estado].rotulo}. {prazo.descricao}
      </span>
    </span>
  );
}
