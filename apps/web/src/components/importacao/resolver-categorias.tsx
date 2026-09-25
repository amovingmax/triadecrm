'use client';

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';

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

/** "Não sei": deixa na fila, com o nome da fonte no cartão. É o padrão. */
const NAO_SEI = '__nao_sei__';
/** "Não importar estas linhas": elas não são mandadas ao banco. */
const NAO_IMPORTAR = '__nao_importar__';
/** Nenhuma categoria declarada como alvo da lista. */
const SEM_BUSCA = '__sem_busca__';

export type RespostaDeCategoria =
  | { tipo: 'categoria'; categoriaId: number }
  | { tipo: 'nao_importar' }
  | { tipo: 'nao_sei' };

export type RespostasDeCategoria = Record<string, RespostaDeCategoria>;

/**
 * A pergunta por NOME de categoria, e não por linha.
 *
 * POR QUÊ, e é a peça central do desenho de 25/09/2026: nas 40 linhas de
 * `listas/` o CRM pediu 36 decisões — uma por linha — sobre 13 nomes distintos
 * de categoria. Decidir por nome são 13 respostas, uma vez; e a resposta fica
 * gravada em `public.source_category_map`, então na lista seguinte são zero.
 * É a troca de O(linhas) por O(nomes novos).
 *
 * TRÊS DECISÕES DE DESENHO QUE NÃO SÃO ESTÉTICA:
 *
 * 1. OS NOMES DAS EMPRESAS FICAM À VISTA. "Loja de Presentes" é a PICMIMOS, que
 *    revela foto, e "Companhia de produção de filmes" é o Fabio Carneiro,
 *    fotógrafo. Sem ver as empresas, a pessoa descarta lead bom pelo rótulo do
 *    Google. O rótulo é do Google; a verdade é o nome.
 *
 * 2. A SUGESTÃO NUNCA VEM MARCADA. Pré-marcar e deixar confirmar tudo num
 *    clique é o carimbo silencioso com outro nome: na lista do buffet ele
 *    transformaria "Restaurante self-service" e "Loja de Presentes" em Buffet
 *    adulto — e aí o funil erra, a meta de déficit erra, e alguém abre conversa
 *    com o pitch errado. O ganho seria de segundos; o estrago é uma mensagem
 *    enviada.
 *
 * 3. "NÃO SEI" É RESPOSTA, E É O PADRÃO. Quem não sabe deixa na fila, onde o
 *    cartão diz como a fonte chamou aquilo. Nada é escrito no mapa.
 */
export function ResolverCategorias({
  categoriasNovas,
  categorias,
  buscava,
  aoTrocarBuscava,
  ocupado,
  aoAplicar,
}: {
  categoriasNovas: readonly CategoriaNova[];
  categorias: readonly CategoriaDoCatalogo[];
  /**
   * O que a pessoa disse que foi buscar nesta lista. NÃO pré-marca nada: só
   * entra como primeira opção da lista suspensa, à frente da sugestão.
   */
  buscava: number | null;
  aoTrocarBuscava: (id: number | null) => void;
  ocupado: boolean;
  aoAplicar: (respostas: RespostasDeCategoria) => void;
}) {
  const [respostas, setRespostas] = useState<RespostasDeCategoria>({});

  const linhasParadas = useMemo(
    () => categoriasNovas.reduce((soma, g) => soma + g.linhas, 0),
    [categoriasNovas],
  );

  const porId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);

  const respondidas = useMemo(
    () =>
      categoriasNovas.filter((g) => {
        const r = respostas[g.nome_na_fonte];
        return r !== undefined && r.tipo !== 'nao_sei';
      }),
    [categoriasNovas, respostas],
  );

  const linhasResolvidas = respondidas.reduce((soma, g) => soma + g.linhas, 0);

  if (categoriasNovas.length === 0) return null;

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

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-hairline p-4">
      <div>
        <h2 className="font-heading text-lg font-semibold tracking-tight">
          <span className="numerico">{formatarNumero(categoriasNovas.length)}</span>{' '}
          {categoriasNovas.length === 1
            ? 'nome de categoria que o CRM ainda não conhece'
            : 'nomes de categoria que o CRM ainda não conhece'}{' '}
          — <span className="numerico">{formatarNumero(linhasParadas)}</span>{' '}
          {linhasParadas === 1 ? 'linha parada' : 'linhas paradas'}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Você responde uma vez. Na próxima lista eu não pergunto de novo. Quem você deixar em
          “não sei” vai para a fila, com o nome da fonte escrito no cartão.
        </p>
      </div>

      {/* "O que você foi buscar" NÃO pré-marca nada — só sobe ao topo de cada
          lista suspensa. É atalho de digitação, e não palpite disfarçado. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">O que você foi buscar nesta lista?</span>
        <Select
          value={buscava === null ? SEM_BUSCA : String(buscava)}
          onValueChange={(v) => aoTrocarBuscava(v === SEM_BUSCA ? null : Number(v))}
        >
          <SelectTrigger className="toque h-11 w-full md:h-9 md:w-72" aria-label="O que você foi buscar nesta lista">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_BUSCA}>Não disse</SelectItem>
            {categorias.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ul className="flex flex-col gap-2">
        {categoriasNovas.map((g) => (
          <li
            key={g.nome_na_fonte}
            className="flex flex-col gap-2 rounded-lg border border-hairline p-3 md:flex-row md:items-center md:gap-3"
          >
            <div className="min-w-0 md:flex-1">
              <p className="font-medium">
                {g.nome_na_fonte}{' '}
                <span className="numerico text-sm text-muted-foreground">
                  · {formatarNumero(g.linhas)} {g.linhas === 1 ? 'linha' : 'linhas'}
                </span>
              </p>
              {/* Não é enfeite: é por aqui que se descobre que a "Loja de
                  Presentes" é uma revelação de fotos. */}
              <p
                className="truncate text-sm text-muted-foreground"
                title={g.exemplos.join(' · ')}
              >
                {g.exemplos.join(' · ')}
              </p>
            </div>

            <Select value={valorDe(g.nome_na_fonte)} onValueChange={(v) => escolher(g.nome_na_fonte, v)}>
              <SelectTrigger
                className="toque h-11 w-full md:h-9 md:w-80"
                aria-label={`Categoria de “${g.nome_na_fonte}”`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NAO_SEI}>Não sei — deixa na fila</SelectItem>
                <SelectItem value={NAO_IMPORTAR}>Não importar estas linhas</SelectItem>
                {buscava !== null && porId.has(buscava) ? (
                  <SelectItem value={String(buscava)}>
                    {porId.get(buscava)!.nome} — o que você foi buscar
                  </SelectItem>
                ) : null}
                {g.sugestao_id !== null && g.sugestao_id !== buscava ? (
                  <SelectItem value={String(g.sugestao_id)}>
                    {g.sugestao_nome} — parece ser
                  </SelectItem>
                ) : null}
                {categorias
                  .filter((c) => c.id !== buscava && c.id !== g.sugestao_id)
                  .map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={ocupado || respondidas.length === 0}
          onClick={() => aoAplicar(respostas)}
          className="toque h-11 md:h-9"
        >
          <Check aria-hidden="true" />
          Aplicar {respondidas.length === 1 ? 'a' : 'às'}{' '}
          <span className="numerico">{formatarNumero(linhasResolvidas)}</span>{' '}
          {linhasResolvidas === 1 ? 'linha' : 'linhas'}
        </Button>
        {respondidas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Responda pelo menos um nome para aplicar. Sem responder nada, tudo vai para a fila.
          </p>
        ) : null}
      </div>
    </section>
  );
}
