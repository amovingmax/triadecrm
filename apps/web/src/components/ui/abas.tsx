'use client';

import { cn } from '@/lib/utils';

/**
 * As duas barras de aba do CRM. Duas, e não mais.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO SAIU DA ADMIN E VIROU COMPARTILHADO
 * ---------------------------------------------------------------------------
 * Até 09/09/2026 o mesmo controle — "escolha qual recorte você está vendo" —
 * tinha CINCO desenhos diferentes, um por módulo: segmentado sobre `muted` com
 * raio `lg` na Admin, pílula com contorno e raio total nas Conversas,
 * segmentado com raio `xl` nos Funis, sublinhado com borda embaixo no Radar, e
 * segmentado com contorno mais gradiente na Agenda. Três raios, dois
 * preenchimentos e um sublinhado para a mesma pergunta.
 *
 * O custo não é estético. Quem aprende que "a faixa cinza em cima troca a
 * seção" na Admin não reconhece o sublinhado do Radar como a mesma coisa, e
 * procura a faixa cinza. E o desenho mais forte que existia — o gradiente da
 * Agenda, que é o da AÇÃO PRINCIPAL do produto — estava marcando a escolha
 * menos importante da tela.
 *
 * ---------------------------------------------------------------------------
 * QUAL USAR
 * ---------------------------------------------------------------------------
 * `SeletorDeAba`  poucos destinos que NÃO se parecem (Pessoas · Catálogos ·
 *                 LGPD; Dia · Semana · Rota; Fila · Fontes). Segmentado, com a
 *                 aba ativa em relevo sobre o fundo.
 *
 * `ChipsDeSecao`  muitos destinos PARECIDOS (as seis listas de catálogo, os
 *                 funis). Pílulas com a contagem ao lado do nome — é a
 *                 contagem que diferencia "Feriados" de "Modelos" antes do
 *                 clique.
 *
 * Nenhum dos dois usa cor: quem está ativo se diz por contraste de superfície e
 * peso, porque a única cromia do produto é a escala térmica, e escolher aba não
 * tem temperatura.
 *
 * Ambos são `<button>` de verdade dentro de um `role="tablist"`: navegam por
 * teclado, anunciam o estado e cumprem 44px de alvo no celular.
 */

export function SeletorDeAba<T extends string>({
  itens,
  ativo,
  aoTrocar,
  rotulo,
  rolavel = false,
}: {
  itens: readonly { id: T; rotulo: string; contagem?: number | null; sufixo?: string }[];
  ativo: T;
  aoTrocar: (id: T) => void;
  rotulo: string;
  /**
   * Para quando os rótulos não cabem: a faixa rola de lado em vez de empilhar.
   * É o caso dos funis, cujos nomes vêm do banco e passam de 390px — empilhar
   * empurraria o quadro para baixo da dobra no celular.
   */
  rolavel?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label={rotulo}
      className={cn(
        'flex gap-1 rounded-lg bg-muted/60 p-1 md:w-fit',
        rolavel ? '-mx-1 overflow-x-auto md:mx-0' : 'w-full',
      )}
    >
      {itens.map((item) => {
        const selecionado = item.id === ativo;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selecionado}
            onClick={() => aoTrocar(item.id)}
            className={cn(
              'toque h-11 rounded-md px-4 text-sm font-medium transition-colors md:h-8',
              rolavel ? 'shrink-0 whitespace-nowrap' : 'flex-1 md:flex-none',
              'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              selecionado
                ? 'bg-background text-foreground sombra-base'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.rotulo}
            {/* Anotação em voz baixa ao lado do nome — hoje só o "(v1)" dos funis
                que ainda não têm quadro. Fica esmaecida porque não é o nome. */}
            {item.sufixo ? (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {item.sufixo}
              </span>
            ) : null}
            {/* A contagem entra DENTRO da aba, e não como badge solto ao lado:
                "Aprovar 3" é uma coisa só que se lê de uma vez. Some quando é
                zero — um zero permanente vira ruído que ninguém enxerga mais. */}
            {item.contagem ? (
              <span
                className={cn(
                  'numerico ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]',
                  selecionado ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
                )}
              >
                {item.contagem}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function ChipsDeSecao<T extends string>({
  itens,
  ativo,
  aoTrocar,
  rotulo,
}: {
  itens: readonly { id: T; rotulo: string; contagem?: number }[];
  ativo: T;
  aoTrocar: (id: T) => void;
  rotulo: string;
}) {
  return (
    <div role="tablist" aria-label={rotulo} className="flex flex-wrap gap-2">
      {itens.map((item) => {
        const selecionado = item.id === ativo;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selecionado}
            onClick={() => aoTrocar(item.id)}
            className={cn(
              'toque flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors md:h-8',
              'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              selecionado
                ? 'border-transparent bg-foreground text-background'
                : 'border-hairline text-muted-foreground hover:text-foreground',
            )}
          >
            {item.rotulo}
            {item.contagem === undefined ? null : (
              <span className={cn('numerico text-xs', !selecionado && 'text-muted-foreground')}>
                {item.contagem}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
