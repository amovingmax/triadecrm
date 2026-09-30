'use client';

import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatarNumero } from '@/components/parceiros/formatos';

import type { CategoriaNova, CategoriaDoCatalogo } from './tipos';

/** "Decidir depois": deixa na Revisão, com o nome da fonte no cartão. É o padrão. */
const NAO_SEI = '__nao_sei__';
/** "Não importar estas linhas": elas não são mandadas ao banco. */
const NAO_IMPORTAR = '__nao_importar__';

export type RespostaDeCategoria =
  | { tipo: 'categoria'; categoriaId: number }
  | { tipo: 'nao_importar' }
  | { tipo: 'nao_sei' };

export type RespostasDeCategoria = Record<string, RespostaDeCategoria>;

/**
 * O passo 2 da importação: a pergunta por NOME de categoria, e não por linha.
 *
 * POR QUÊ, e é a peça central do desenho de 25/09/2026: nas 40 linhas de
 * `listas/` o CRM pediu 36 decisões — uma por linha — sobre 13 nomes distintos
 * de categoria. Decidir por nome são 13 respostas, uma vez; e a resposta fica
 * gravada em `public.source_category_map`, então na lista seguinte são zero.
 *
 * O QUE MUDOU EM 30/09/2026 (Rafael: "to entendendo nada"):
 *   · virou um PASSO próprio, antes da conferência, e não um bloco no meio
 *     dela. Antes a pessoa via a contagem, depois a pergunta que mudava a
 *     contagem, e depois a contagem de novo;
 *   · saiu a segunda pergunta, "O que você foi buscar nesta lista?", que só
 *     reordenava as listas suspensas e parecia outra decisão a tomar;
 *   · saiu o botão "Aplicar às 0 linhas". A resposta vale quando a pessoa
 *     segue em frente: "Continuar" ensina o que foi respondido e refaz a
 *     conferência. Sem resposta nenhuma, "Continuar" também segue — e o que
 *     ficou em "decidir depois" vai para a Revisão.
 *
 * O que NÃO mudou, e não é estética:
 *   1. Os nomes das empresas ficam à vista. "Loja de Presentes" é a PICMIMOS,
 *      que revela foto: sem ver as empresas, descarta-se lead bom pelo rótulo
 *      do Google.
 *   2. A sugestão nunca vem marcada: ela é a primeira opção da lista, e só.
 *      Pré-marcar transformaria "Restaurante self-service" em Buffet adulto num
 *      clique distraído — e aí alguém abre conversa com o pitch errado.
 *   3. "Decidir depois" é resposta, e é o padrão. Nada é escrito no mapa.
 */
export function ResolverCategorias({
  categoriasNovas,
  categorias,
  ocupado,
  aoContinuar,
}: {
  categoriasNovas: readonly CategoriaNova[];
  categorias: readonly CategoriaDoCatalogo[];
  ocupado: boolean;
  /** Recebe as respostas dadas (pode ser nenhuma) e segue para a conferência. */
  aoContinuar: (respostas: RespostasDeCategoria) => void;
}) {
  const [respostas, setRespostas] = useState<RespostasDeCategoria>({});

  const empresas = useMemo(
    () => categoriasNovas.reduce((soma, g) => soma + g.linhas, 0),
    [categoriasNovas],
  );

  const respondidas = useMemo(
    () =>
      categoriasNovas.filter((g) => {
        const r = respostas[g.nome_na_fonte];
        return r !== undefined && r.tipo !== 'nao_sei';
      }),
    [categoriasNovas, respostas],
  );

  const escolher = (nome: string, valor: string) => {
    setRespostas((atual) => {
      const novo = { ...atual };
      if (valor === NAO_SEI) novo[nome] = { tipo: 'nao_sei' };
      else if (valor === NAO_IMPORTAR) novo[nome] = { tipo: 'nao_importar' };
      else novo[nome] = { tipo: 'categoria', categoriaId: Number(valor) };
      return novo;
    });
  };

  const valorDe = (nome: string): string => {
    const r = respostas[nome];
    if (r === undefined || r.tipo === 'nao_sei') return NAO_SEI;
    if (r.tipo === 'nao_importar') return NAO_IMPORTAR;
    return String(r.categoriaId);
  };

  const semResposta = categoriasNovas.length - respondidas.length;

  return (
    <section
      aria-labelledby="categorias-titulo"
      className="sombra-base flex flex-col gap-4 rounded-xl bg-card p-4 sm:p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 id="categorias-titulo" className="text-lg font-semibold tracking-[-0.01em]">
          Qual é a categoria destas empresas?
        </h2>
        <p className="max-w-[90ch] text-sm text-muted-foreground">
          O Google chamou <span className="numerico">{formatarNumero(empresas)}</span>{' '}
          {empresas === 1 ? 'empresa' : 'empresas'} por nomes que o CRM ainda não conhece. Responda
          uma vez: nas próximas listas o CRM já sabe.
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {categoriasNovas.map((g) => (
          <li
            key={g.nome_na_fonte}
            className="flex flex-col gap-3 rounded-lg bg-muted/45 p-4 md:flex-row md:items-center md:gap-4"
          >
            <div className="min-w-0 md:flex-1">
              <p className="text-[15px] font-medium">
                {g.nome_na_fonte}{' '}
                <span className="numerico text-[13px] font-normal text-muted-foreground">
                  · {formatarNumero(g.linhas)} {g.linhas === 1 ? 'empresa' : 'empresas'}
                </span>
              </p>
              {/* Não é enfeite: é por aqui que se descobre que a "Loja de
                  Presentes" é uma revelação de fotos. */}
              <p className="truncate text-[13px] text-muted-foreground" title={g.exemplos.join(' · ')}>
                {g.exemplos.join(' · ')}
              </p>
            </div>

            <Select value={valorDe(g.nome_na_fonte)} onValueChange={(v) => escolher(g.nome_na_fonte, v)}>
              <SelectTrigger
                className="toque h-11 w-full bg-card md:h-10 md:w-80"
                aria-label={`Categoria de “${g.nome_na_fonte}”`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NAO_SEI}>Decidir depois, na Revisão</SelectItem>
                {g.sugestao_id !== null ? (
                  <SelectItem value={String(g.sugestao_id)}>
                    {g.sugestao_nome} (sugestão)
                  </SelectItem>
                ) : null}
                {categorias
                  .filter((c) => c.id !== g.sugestao_id)
                  .map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nome}
                    </SelectItem>
                  ))}
                <SelectItem value={NAO_IMPORTAR}>Não importar estas empresas</SelectItem>
              </SelectContent>
            </Select>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3 border-t border-hairline pt-4 sm:flex-row sm:items-center">
        <Button
          variant="menta"
          disabled={ocupado}
          onClick={() => aoContinuar(respostas)}
          className="toque h-11 md:h-10 md:px-5"
        >
          Continuar
          <ArrowRight aria-hidden="true" />
        </Button>
        <p className="text-[13px] text-muted-foreground">
          {semResposta === 0
            ? 'Tudo respondido.'
            : semResposta === categoriasNovas.length
              ? 'Sem resposta, as empresas vão para a Revisão e você decide lá.'
              : `${formatarNumero(semResposta)} ${semResposta === 1 ? 'nome fica' : 'nomes ficam'} para decidir na Revisão.`}
        </p>
      </div>
    </section>
  );
}
