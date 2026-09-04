import {
  definicaoTemperatura,
  TEMPERATURAS_EM_ORDEM,
  type Temperatura,
} from '@/components/temperatura';
import { cn } from '@/lib/utils';

import { formatarPrazoProximaAcao } from './cartao-formatos';
import { SEMAFORO_PROXIMA_ACAO, type EstadoProximaAcao } from './tipos';

/**
 * Os dois semáforos do cartão do funil (RF-FUN-02).
 *
 * A regra que governa os dois é a mesma, e é o motivo de este arquivo existir em vez
 * de um punhado de `<span>` dentro do cartão: **nenhum estado pode depender só de
 * cor.** A Heloísa lê esta coluna no celular, na rua, no sol de Natal, e uma parte
 * das pessoas não separa vermelho de verde. Então cada semáforo carrega três canais
 * ao mesmo tempo: forma, texto e (só o térmico) cor.
 *
 * ---------------------------------------------------------------------------
 * 1. `SemaforoTermico` — quanto o negócio está quente
 * ---------------------------------------------------------------------------
 * Cinco talos de altura crescente, preenchidos até a posição da temperatura atual,
 * mais o rótulo escrito ao lado. É medidor de sinal, não bolinha: quem enxerga cor
 * lê a cor; quem não enxerga conta os talos cheios (1 de 5 é frio, 5 de 5 é cliente
 * ativo) ou simplesmente lê "Frio". A ordem dos talos é a ordem do enum
 * `app.temperature` no Postgres, que é a mesma de `ESCALA_TERMICA`.
 *
 * A cor sai inteira da escala térmica (`cor` para o talo cheio, `-texto` para a
 * palavra): a escala é a única cromia da interface e este arquivo não inventa
 * nenhuma. O que separa cheio de vazio é a ALTURA, e não um cinza de trilho: medido
 * no navegador, `--border` dava 1,94:1 no escuro e 1,23:1 no claro, longe dos 3:1 que
 * a WCAG 1.4.11 pede de objeto gráfico, e o "de cinco" sumia no sol. O degrau vazio é
 * um toco de 3px em `--muted-foreground` (5,71:1 e 5,06:1) e o cheio vai de 6px a
 * 14px na cor da temperatura (pior par medido: 3,88:1).
 *
 * Ele não substitui a `BarraTermica` da borda esquerda do cartão: aquela é o que se
 * vê varrendo a coluna com o olho, esta é o que se lê ao parar num cartão. É o mesmo
 * par barra + rótulo que a lista de parceiros já usa.
 *
 * ---------------------------------------------------------------------------
 * 2. `SemaforoProximaAcao` — se alguém vai fazer alguma coisa, e quando
 * ---------------------------------------------------------------------------
 * Este é ACROMÁTICO de propósito, e não por descuido. O semáforo de trânsito pedia
 * verde, amarelo e vermelho, e é exatamente o que não pode acontecer aqui: verde já
 * significa "fechou" e vermelho já significa "quente" na mesma tela, no mesmo cartão,
 * a dois centímetros de distância. Um cartão vermelho de atraso ao lado de uma barra
 * vermelha de temperatura ensinaria a pessoa a desconfiar da cor. Então o estado vem
 * de **silhueta** (quatro desenhos que se distinguem a 12px), de **peso** (o vencido
 * e o sem-ação ficam em tinta cheia e 500; o agendado fica esmaecido) e do **texto**
 * do prazo, que está sempre lá.
 *
 *   anel cortado  Sem próxima ação   o "!" do RF-FUN-03: nada marcado
 *   disco cheio   Hoje, 09:00        é hoje, resolve hoje
 *   anel vazado   Em 3d              está agendada, pode seguir
 *   triângulo     Atrasada 4d        venceu e ninguém fez
 */

/* ==========================================================================
   Semáforo térmico
   ========================================================================== */

export function SemaforoTermico({
  temperatura,
  needsAttention = false,
  semRotulo = false,
  className,
}: {
  temperatura: Temperatura | string | null | undefined;
  /** `deals.needs_attention`: entra na descrição acessível, não na cor. */
  needsAttention?: boolean;
  /** Esconde a palavra e deixa só o medidor (use quando a linha já diz a temperatura). */
  semRotulo?: boolean;
  className?: string;
}) {
  const definicao = definicaoTemperatura(temperatura);

  const descricao = needsAttention
    ? `Temperatura: ${definicao.rotulo}. Esfriando por falta de contato. ${definicao.descricao}`
    : `Temperatura: ${definicao.rotulo}. ${definicao.descricao}`;

  return (
    <span title={descricao} className={cn('inline-flex shrink-0 items-center gap-1.5', className)}>
      {/* `data-temperatura` fica no medidor, e não no invólucro, porque é assim que os
          scripts de medida acham a cor pintada: eles leem o primeiro <span> de dentro,
          que aqui é o primeiro talo cheio. É a mesma convenção da BarraTermica. */}
      <span
        data-temperatura={definicao.valor}
        aria-hidden="true"
        className="flex items-end gap-[2px]"
      >
        {TEMPERATURAS_EM_ORDEM.map((degrau, indice) => {
          const cheio = degrau.ordem <= definicao.ordem;
          return (
            <span
              key={degrau.valor}
              className="w-[3px] rounded-[1px]"
              style={{
                // O degrau vazio é um toco de 3px, e não um talo inteiro em cinza-claro.
                // A primeira versão pintava o trilho com `--border`, que mede 1,94:1 no
                // escuro e 1,23:1 no claro: abaixo dos 3:1 da WCAG 1.4.11, ou seja, o
                // "de cinco" simplesmente não aparecia no sol. Trocar por um cinza forte
                // o bastante criava o problema oposto, porque `--input` e o azul de
                // `frio` são quase o mesmo pixel num traço de 3px. Então quem separa
                // cheio de vazio é a ALTURA (6px contra 3px já no primeiro degrau), e a
                // cor do toco fica em `--muted-foreground`, que passa em 5,71:1 no
                // escuro e 5,06:1 no claro.
                height: cheio ? `${6 + indice * 2}px` : '3px',
                backgroundColor: cheio ? definicao.cor : 'var(--muted-foreground)',
              }}
            />
          );
        })}
      </span>
      {semRotulo ? null : (
        <span
          aria-hidden="true"
          className="text-xs font-medium"
          // `-texto` é a variante da escala medida em pelo menos 4,5:1 sobre fundo,
          // cartão e muted; a `cor` cheia serviria de marca, mas não de texto.
          style={{ color: definicao.corTexto }}
        >
          {definicao.rotulo}
        </span>
      )}
      <span className="sr-only">{descricao}</span>
    </span>
  );
}

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
