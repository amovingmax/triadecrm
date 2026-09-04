'use client';

import Link from 'next/link';

import { cn } from '@/lib/utils';
import { RevelarLista, useRevelarLinha } from '@/components/movimento';
import { BarraTermica, ChipTemperatura, DiasSemContato } from '@/components/temperatura';

import { formatarLocal, formatarTelefone } from './formatos';
import { ProximaAcao } from './proxima-acao';
import type { LinhaParceiro } from './tipos';

/**
 * A mesma lista no celular, que é onde a Heloísa trabalha: entre visitas, no sol,
 * com uma mão só. A tabela vira cartão, mas a leitura é a mesma da tela grande:
 * barra térmica na borda esquerda, nome, e os dias sem contato em mono à direita.
 *
 * Os cartões vivem direto sobre a base Ocean Breeze e são separados por hairline
 * translúcida (`border-hairline`), a mesma linha da tabela, nunca por borda cheia.
 *
 * O cartão inteiro é o alvo de toque, com 64px de altura (bem acima dos 44px mínimos).
 *
 * A `<ul>` leva `corpo-tabela`: a regra base de tracking do `globals.css` só pega
 * `<table>`, e esta é a superfície mais estreita do produto, onde a largura da Poppins
 * empurra nome, categoria e bairro para o truncate.
 *
 * A largura útil do texto foi medida em 390px e refeita. Ela era de 219px, com 14 dos
 * 50 nomes e 37 dos 50 subtítulos estourando; o pior subtítulo pedia 506px, e como
 * categoria e bairro vinham concatenados por " · " numa linha só com `truncate`, o
 * corte caía SEMPRE no fim, ou seja no BAIRRO, que é a informação de rota. Três
 * mudanças devolvem ~90px ao nome sem custar uma linha de altura:
 *
 * 1. bairro ANTES da categoria: o que sobra fora da tela passa a ser a categoria, que
 *    a Heloísa em geral já filtrou e que está na ficha, e não o bairro, que decide
 *    para onde ela dirige;
 * 2. o bloco da direita perde o `shrink-0` e o caso nulo vira um traço (`curto`), no
 *    lugar dos 75px fixos que a frase "sem contato" gastava em todas as 50 linhas;
 * 3. o chevron sai: o cartão inteiro já é o link, e o ícone gastava 28px com a coluna
 *    da borda direita, que é justamente onde o botão flutuante pousa.
 *
 * O escalonamento de entrada vem do `useRevelarLinha` (className + delay no próprio
 * `<li>`), e não do `<RevelarItem>`: o componente embrulha o filho numa `<div>`, o que
 * (a) deixava o aninhamento em `<ul> > <div> > <li>`, inválido e sem semântica de
 * lista, e (b) fazia cada `<li>` ser `:last-child` do próprio invólucro, então
 * `last:border-b-0` casava com TODOS os cartões e a lista de 50 parceiros ficava sem
 * nenhuma fronteira (medido: `border-bottom-width: 0px` em todo `<li>`).
 */
export function ListaCartoes({ linhas }: { linhas: LinhaParceiro[] }) {
  return (
    <RevelarLista>
      <ul className="corpo-tabela flex flex-col">
        {linhas.map((linha, indice) => (
          <Cartao key={linha.id} linha={linha} indice={indice} />
        ))}
      </ul>
    </RevelarLista>
  );
}

function Cartao({ linha, indice }: { linha: LinhaParceiro; indice: number }) {
  const revelar = useRevelarLinha(indice);
  const local = formatarLocal(linha.neighborhood, linha.city);

  return (
    <li
      {...revelar}
      className={cn('border-b border-hairline last:border-b-0', revelar.className)}
    >
      <Link
        href={`/parceiros/${linha.id}`}
        className="relative flex min-h-16 items-center gap-3 py-2.5 pr-3 pl-4 outline-none active:bg-muted/60 focus-visible:bg-muted/60"
      >
        {/* `semRotulo`: o ChipTemperatura logo abaixo já anuncia a temperatura e o
            esfriamento em texto, e o leitor de tela não pode lê-los duas vezes. */}
        <BarraTermica
          temperatura={linha.temperature}
          needsAttention={linha.needs_attention}
          posicao="absoluta"
          semRotulo
        />

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{linha.name}</p>
          <p className="truncate text-[0.8125rem] text-muted-foreground">
            {[local || null, linha.primary_category].filter(Boolean).join(' · ')}
          </p>
          {/* O rótulo da temperatura abre a linha de metadados: cor sozinha, num traço
              de 3px, não sobrevive a daltonismo, e este é o cartão que o time lê no
              sol, com uma mão só. */}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <ChipTemperatura
              temperatura={linha.temperature}
              esfriando={linha.needs_attention}
              comDescricao={false}
            />
            {linha.phone ? <span className="numerico">{formatarTelefone(linha.phone)}</span> : null}
            {linha.stage ? <span>{linha.stage}</span> : null}
            <ProximaAcao iso={linha.next_action_at} />
          </p>
        </div>

        <div className="flex max-w-24 min-w-0 flex-col items-end gap-0.5 text-right">
          <DiasSemContato dias={linha.days_since_contact} atencao={linha.needs_attention} curto />
          {linha.owner ? (
            <span className="max-w-full truncate text-xs text-muted-foreground">{linha.owner}</span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
