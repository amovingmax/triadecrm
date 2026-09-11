'use client';

import Link from 'next/link';

import { cn } from '@/lib/utils';
import { RevelarLista, useRevelarLinha } from '@/components/movimento';
import { BarraTermica, ChipTemperatura } from '@/components/temperatura';

import { formatarLocal, formatarTelefone } from './formatos';
import type { LinhaParceiro } from './tipos';
import { resumoDoContato, TagDoContato } from './ultimo-contato';

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
  const contato = resumoDoContato(linha);

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

        {/* Três linhas, um assunto por linha — a mesma anatomia da tabela:

              nome ................................ temperatura
              categoria · bairro ................... WhatsApp
              [o que o contato deu] quando · tentativa

            Antes a terceira linha juntava temperatura, tag, telefone, etapa e
            próxima ação numa fileira só, que quebrava onde a largura mandasse. Era
            o "misturado" da tela em miniatura. Etapa, responsável e próxima ação
            estão a um toque, na ficha — e no desktop também só aparecem no 2xl. */}
        <div className="grid min-w-0 flex-1 grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
          <p className="truncate font-medium">{linha.name}</p>
          {/* O rótulo da temperatura fica no canto da primeira linha: cor sozinha,
              num traço de 3px, não sobrevive a daltonismo, e este é o cartão que o
              time lê no sol, com uma mão só. */}
          <ChipTemperatura
            temperatura={linha.temperature}
            esfriando={linha.needs_attention}
            comDescricao={false}
            className="justify-self-end"
          />

          <p className="truncate text-xs text-muted-foreground">
            {[linha.primary_category, local || null].filter(Boolean).join(' · ') || '-'}
          </p>
          {linha.phone ? (
            <span className="numerico justify-self-end text-xs text-muted-foreground">
              {formatarTelefone(linha.phone)}
            </span>
          ) : (
            <span aria-hidden="true" />
          )}

          {/* A linha do contato ocupa as duas colunas: a tag e o "quando" são uma
              frase só ("não atendeu, há 2 dias"), e cortá-la ao meio pela grade
              separaria o que a pessoa lê junto. */}
          <div className="col-span-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {contato.contatado ? (
              <>
                <TagDoContato resumo={contato} />
                <span className="truncate" title={contato.descricao}>
                  {[contato.quando, contato.tentativas].filter(Boolean).join(' · ')}
                </span>
              </>
            ) : (
              <span>Ainda não contatado</span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}
