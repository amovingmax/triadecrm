'use client';

import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react';
import Link from 'next/link';

import { BarraTermica, DiasSemContato } from '@/components/temperatura';
import { cn } from '@/lib/utils';

import { formatarCategoriaELocal, formatarParado, rotuloResponsavel } from './cartao-formatos';
import { SemaforoProximaAcao, SemaforoTermico } from './semaforo';
import type { CartaoQuadro } from './tipos';

/**
 * O cartão do funil (RF-FUN-02). É a unidade de trabalho da Heloísa: ela varre uma
 * coluna com o polegar, para num cartão, decide, e segue. Tudo aqui é para essa
 * varredura.
 *
 * ---------------------------------------------------------------------------
 * O que o cartão diz, em ordem de leitura
 * ---------------------------------------------------------------------------
 *   borda esquerda   `BarraTermica`: a temperatura em cor cheia, engrossada e pulsando
 *                    quando o negócio está esfriando (`needs_attention`)
 *   linha 1          nome do parceiro, e à direita os dias sem contato em IBM Plex Mono
 *   linha 2          categoria e bairro/cidade
 *   linha 3          `SemaforoTermico` (medidor de cinco talos + a palavra) e, quando o
 *                    prazo da etapa estourou, a pastilha "Parado há N d"
 *   linha 4          `SemaforoProximaAcao` (silhueta + prazo) e o responsável
 *
 * Cinco informações do requisito (nome, categoria, local, responsável, temperatura),
 * mais os três sinais que decidem o que fazer agora: há quanto tempo ninguém fala com
 * a pessoa, se a próxima ação existe e venceu, e se o cartão empacou na etapa.
 *
 * ---------------------------------------------------------------------------
 * Quatro decisões que valem a pena estar escritas
 * ---------------------------------------------------------------------------
 *
 * 1. **Nada é só cor.** A temperatura vem em barra colorida MAIS medidor contável
 *    MAIS palavra; a próxima ação é acromática e se distingue por silhueta, peso e
 *    texto; "parado" é hachura mais pastilha escrita. O detalhe está em `semaforo.tsx`.
 *
 * 2. **"Parado" é hachura, não fundo vermelho.** O PRD pede fundo de alerta, e o
 *    caminho óbvio seria a brasa do `--destructive`, que neste sistema é literalmente
 *    a mesma cor de `quente`. Um cartão pintado de vermelho ao lado de uma barra
 *    vermelha de temperatura destrói a única cromia que a interface tem. Então o
 *    alerta é textura: hachura diagonal em tinta a 8%, que lê como "riscado, travado"
 *    sem gastar matiz nenhum, e a pastilha diz em português o que aconteceu.
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

/**
 * Hachura do cartão parado. Em tinta a 8% ela some no primeiro relance e aparece
 * quando o olho para, que é exatamente o peso certo: o alerta é a pastilha escrita;
 * a textura só marca o retângulo. Funciona igual nos dois modos porque `--foreground`
 * inverte junto com a superfície.
 */
const HACHURA_PARADO =
  'repeating-linear-gradient(135deg, transparent 0 7px, color-mix(in oklab, var(--foreground) 8%, transparent) 7px 14px)';

export type PropsCartaoNegocio = {
  cartao: CartaoQuadro;
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

  return (
    <article
      ref={ref}
      data-parado={cartao.is_rotting ? '' : undefined}
      data-arrastando={arrastando ? '' : undefined}
      className={cn(
        'relative flex min-h-[76px] w-full flex-col gap-1.5 rounded-xl border border-hairline bg-card py-3 pr-3 pl-4',
        'transition-shadow focus-within:ring-2 focus-within:ring-ring',
        arrastando ? 'sombra-base-forte' : 'sombra-base',
        // O fantasma é a silhueta do cartão que saiu do lugar; é o único ponto do
        // sistema onde opacidade é o próprio significado, e não hierarquia de texto.
        fantasma && 'opacity-40',
        className,
      )}
      style={{ ...(parado ? { backgroundImage: HACHURA_PARADO } : null), ...style }}
      {...resto}
    >
      {/* `semRotulo`: o SemaforoTermico logo abaixo já anuncia a temperatura em texto,
          e o leitor de tela não pode lê-la duas vezes no mesmo cartão. */}
      <BarraTermica
        temperatura={cartao.temperature}
        needsAttention={cartao.needs_attention}
        posicao="absoluta"
        semRotulo
      />

      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm leading-5 font-medium">
          {destino ? (
            // Link esticado: o retângulo inteiro do cartão vira alvo de toque, sem
            // envolver os botões do rodapé, que sobem de camada.
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

        {cartao.tier ? (
          <span
            title={`Prioridade comercial ${cartao.tier}.`}
            className="numerico shrink-0 rounded-lg border border-hairline px-1.5 py-px text-[0.6875rem] text-muted-foreground"
          >
            {cartao.tier}
          </span>
        ) : null}
      </div>

      <p className="truncate text-xs text-muted-foreground">
        {categoriaELocal || 'Categoria não informada'}
      </p>

      {/* Os dias sem contato vêm nesta linha, e não ao lado do nome: numa coluna de
          kanban com 300px, "sem contato" (o valor de quase todo alvo novo) roubava uns
          70px justamente do nome do parceiro, que é o que a pessoa procura varrendo a
          coluna. Aqui eles dividem a linha com a temperatura, que é a outra metade da
          mesma pergunta: quão quente está, e há quanto tempo ninguém fala com ele. */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <SemaforoTermico
            temperatura={cartao.temperature}
            needsAttention={cartao.needs_attention}
          />
          {parado ? (
            <span
              title={parado.descricao}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-hairline bg-muted px-1.5 py-px text-[0.6875rem] font-medium text-foreground"
            >
              <PausaParada />
              {/* Tudo num filho só: o `gap-1` do flex separaria "11" de "d". */}
              <span>
                {parado.rotulo}
                {parado.numero ? <span className="numerico">{parado.numero}</span> : null}
                {parado.unidade ? <span className="text-[0.8em]">{parado.unidade}</span> : null}
              </span>
            </span>
          ) : null}
        </span>
        <DiasSemContato dias={cartao.days_since_contact} className="shrink-0" />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <SemaforoProximaAcao estado={cartao.next_action_state} quando={cartao.next_action_at} />
          {cartao.next_action ? (
            <span className="truncate text-xs text-muted-foreground">{cartao.next_action}</span>
          ) : null}
        </span>

        <span
          className="max-w-28 shrink-0 truncate text-xs text-muted-foreground"
          title={
            cartao.owner_name
              ? `Responsável: ${cartao.owner_name}.`
              : 'Negócio do bolo comum: quem mover assume.'
          }
        >
          {rotuloResponsavel(cartao.owner_name)}
        </span>
      </div>

      {/* z-10: precisa ficar acima do link esticado, senão o toque no botão abriria a ficha. */}
      {acoes ? <div className="relative z-10 flex items-center gap-2 pt-1">{acoes}</div> : null}
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
