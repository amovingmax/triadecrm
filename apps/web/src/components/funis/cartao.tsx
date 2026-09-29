'use client';

import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import Link from 'next/link';

import { iniciaisDe } from '@/lib/iniciais';
import { cn } from '@/lib/utils';

import {
  formatarCategoriaELocal,
  formatarParado,
  rotuloResponsavel,
} from './cartao-formatos';
import { SemaforoProximaAcao } from './semaforo';
import type { CartaoQuadro } from './tipos';

/**
 * O cartão do funil (RF-FUN-02). É a unidade de trabalho da Heloísa: ela varre uma
 * coluna com o polegar, para num cartão, decide, e segue. Tudo aqui é para essa
 * varredura.
 *
 * ---------------------------------------------------------------------------
 * O que o cartão diz, em ordem de leitura
 * ---------------------------------------------------------------------------
 *   borda esquerda   `BarraEtapa`: quão longe no funil, em tinta neutra
 *   linha 1          nome do parceiro, e à direita os dias sem contato em IBM Plex Mono
 *   linha 2          categoria e bairro/cidade
 *   linha 3          a pastilha "Parado há N d" (quando o prazo da etapa estourou),
 *                    e à direita o ícone do canal do último toque e os dias sem contato
 *   linha 4          `SemaforoProximaAcao` (silhueta + prazo) e o responsável
 *
 * Cinco informações do requisito (nome, categoria, local, responsável, etapa), mais
 * os três sinais que decidem o que fazer agora: há quanto tempo ninguém fala com a
 * pessoa, se a próxima ação existe e venceu, e se o cartão empacou na etapa.
 *
 * ---------------------------------------------------------------------------
 * Quatro decisões que valem a pena estar escritas
 * ---------------------------------------------------------------------------
 *
 * 1. **Nada é cor.** A TEMPERATURA SAIU DO CARTÃO EM 28/09/2026 (ADR-16): a etapa é a
 *    verdade, e a etapa é a própria coluna em que o cartão vive. A barra da esquerda
 *    passou a ser acromática e diz só quão longe no funil o negócio está. A próxima
 *    ação continua se distinguindo por silhueta, peso e texto, e "parado" por véu
 *    mais pastilha escrita. Rafael: "o fato de só o lead responder e ele já virar
 *    morno não faz sentido e tá errado" — e a cor era a projeção de 12 etapas em 3.
 *
 * 2. **"Parado" não é fundo vermelho.** O PRD pede fundo de alerta, e o caminho óbvio
 *    seria a brasa do `--destructive`, que neste sistema é literalmente a mesma cor de
 *    `quente` na escala térmica dos relatórios. Então o alerta é véu, não matiz, e a
 *    pastilha diz em português o que aconteceu.
 *
 * 3. **O cartão inteiro é o alvo de toque.** O link do nome se estica por cima do
 *    cartão com `after:inset-0`, então a área tocável é o retângulo todo, com no
 *    mínimo 76px de altura (o mínimo de acessibilidade é 44px). O que precisa ficar
 *    ACIMA desse link (o botão de mover, no celular) vai no slot `acoes`, que já sobe
 *    de camada.
 *
 * 4. **O cartão não sabe arrastar.** Quem monta o quadro passa `ref` e os ouvintes do
 *    dnd-kit direto nas props: elas caem no `<article>`. Aqui só existe o estado
 *    visual (`arrastando`, `fantasma`). Assim o mesmo componente serve ao quadro do
 *    desktop e à lista do celular, onde não há arrasto nenhum.
 *
 * O cartão não carrega telefone, e-mail nem @: o quadro mostra dezenas por tela e PII
 * em lote é o que o RF-BAS-14 e o `pii_access_log` existem para evitar. Quem precisa
 * do número abre a ficha e revela lá, com registro.
 */


export type PropsCartaoNegocio = {
  cartao: CartaoQuadro;
  /**
   * Quantas etapas de TRABALHO o funil tem — o denominador da barra da esquerda.
   * É prop, e nunca constante: fornecedor tem 9, ativação 6 e produtor 11. Quem
   * sabe é o quadro, que já carrega a lista de etapas.
   */
  etapasDeTrabalho: number;
  /**
   * Para onde o toque leva. O padrão é a ficha do parceiro (RF-FUN-06); passe `null`
   * para desligar o link e deixar o cartão só arrastável.
   */
  href?: string | null;
  /** Rodapé opcional: no celular é o botão que abre a folha de mover (RF-FUN-01). */
  acoes?: ReactNode;
  /** `true` enquanto o dnd-kit carrega este cartão sob o dedo. */
  arrastando?: boolean;
  /** `true` no cartão que fica no lugar de origem durante o arrasto. */
  fantasma?: boolean;
  ref?: Ref<HTMLElement>;
} & Omit<ComponentPropsWithoutRef<'article'>, 'children'>;

export function CartaoNegocio({
  cartao,
  // Continua no tipo porque o quadro inteiro ainda o passa, mas o cartão limpo
  // (29/09/2026) não desenha mais a barra de progresso que o usava: a coluna
  // onde o cartão mora já diz em que ponto do funil ele está.
  etapasDeTrabalho: _etapasDeTrabalho,
  href,
  acoes,
  arrastando = false,
  fantasma = false,
  className,
  style,
  ref,
  ...resto
}: PropsCartaoNegocio) {
  const destino = href === undefined ? `/parceiros/${cartao.organization_id}` : href;
  const categoriaELocal = formatarCategoriaELocal(cartao);
  const parado = cartao.is_rotting ? formatarParado(cartao.days_in_stage) : null;
  // ===========================================================================
  // O CARTÃO LIMPO (29/09/2026)
  // ===========================================================================
  // Rafael, com o quadro aberto: "os leads no funil ta muito poluido (...) evite
  // muita informação junta, quero algo clean e organizado". O cartão tinha
  // QUATRO linhas e seis sinais: nota comercial com borda, categoria e local,
  // a pastilha "Parado há 56d" E um segundo "53d" de dias sem contato (dois
  // números de dias para a mesma pergunta), o ícone do canal, a próxima ação
  // cortada no meio ("Primeiro...") e o nome inteiro do dono. Os parados ainda
  // ganhavam um véu cinza, e num funil onde metade está parada o quadro inteiro
  // ficava com cara de sujo.
  //
  // Sobram TRÊS linhas e UM sinal de tempo:
  //   1. quem é (o nome, e a nota comercial como letra discreta);
  //   2. o que é e onde (categoria · bairro);
  //   3. quem cuida (as iniciais num disco) e O QUE IMPORTA AGORA — se está
  //      parado, há quanto tempo, em coral; se não está, quando é o próximo
  //      passo. Nunca os dois: é essa escolha que faz o cartão ser lido de
  //      relance em vez de lido.
  //
  // O que saiu não sumiu: a próxima ação por extenso, o canal e os dias sem
  // contato estão na ficha, a um clique, que é onde se lê com calma.
  const iniciais = cartao.owner_name ? iniciaisDe(cartao.owner_name) : null;

  return (
    <article
      ref={ref}
      data-parado={cartao.is_rotting ? '' : undefined}
      data-arrastando={arrastando ? '' : undefined}
      className={cn(
        'group/cartao relative flex w-full flex-col gap-3 rounded-xl bg-card p-4',
        'transition-shadow focus-within:ring-2 focus-within:ring-ring',
        arrastando ? 'sombra-base-forte' : 'sombra-base',
        // O fantasma é a silhueta do cartão que saiu do lugar; é o único ponto do
        // sistema onde opacidade é o próprio significado, e não hierarquia de texto.
        fantasma && 'opacity-40',
        className,
      )}
      style={style}
      {...resto}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[15px] leading-5 font-semibold tracking-[-0.01em]">
            {destino ? (
              // Link esticado: o retângulo inteiro do cartão vira alvo de toque,
              // sem envolver os botões do canto, que sobem de camada.
              <Link
                href={destino}
                className="rounded-xl outline-none after:absolute after:inset-0 after:rounded-xl"
              >
                {cartao.organization_name}
              </Link>
            ) : (
              cartao.organization_name
            )}
          </h3>
          {/* A nota comercial como LETRA, sem moldura: com borda ela era o
              segundo objeto mais chamativo do cartão, e é só um desempate. */}
          {cartao.tier ? (
            <span
              title={`Prioridade comercial ${cartao.tier}.`}
              className="numerico shrink-0 text-xs font-medium text-muted-foreground"
            >
              {cartao.tier}
            </span>
          ) : null}
        </div>
        <p className="truncate text-[13px] text-muted-foreground">
          {categoriaELocal || 'Categoria não informada'}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        {/* Quem cuida, em DISCO: o nome inteiro ("Heloísa Cavalcanti") comia um
            terço da linha para dizer o que duas letras dizem. O nome completo
            continua no `title`. */}
        <span
          title={
            cartao.owner_name
              ? `Responsável: ${cartao.owner_name}.`
              : 'Negócio do bolo comum: quem mover assume.'
          }
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
            iniciais ? 'bg-muted text-foreground' : 'border border-dashed border-input text-muted-foreground',
          )}
        >
          {iniciais ?? '?'}
          <span className="sr-only">{rotuloResponsavel(cartao.owner_name)}</span>
        </span>

        {parado ? (
          // PARADO vence a próxima ação: é o sinal que pede alguém agora.
          <span
            title={parado.descricao}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive-texto"
          >
            <PausaParada />
            <span>
              {parado.rotulo}
              {parado.numero ? <span className="numerico">{parado.numero}</span> : null}
              {parado.unidade ? <span className="text-[0.85em]">{parado.unidade}</span> : null}
            </span>
          </span>
        ) : (
          <SemaforoProximaAcao estado={cartao.next_action_state} quando={cartao.next_action_at} />
        )}
      </div>

      {/* A alça de arraste (e, no celular, o botão de mover) fica no CANTO, não
          numa linha própria. z-10: precisa ficar acima do link esticado, senão o
          toque abriria a ficha. */}
      {acoes ? (
        <div className="relative z-10 flex items-center gap-2 md:absolute md:top-2 md:right-2">
          {acoes}
        </div>
      ) : null}
    </article>
  );
}

/** Duas barras verticais: a silhueta de "pausado", no mesmo tamanho do texto da pastilha. */
function PausaParada() {
  return (
    <svg viewBox="0 0 16 16" className="size-3 shrink-0" aria-hidden="true" fill="currentColor">
      <rect x="3.5" y="2.5" width="3.5" height="11" rx="1" />
      <rect x="9" y="2.5" width="3.5" height="11" rx="1" />
    </svg>
  );
}
