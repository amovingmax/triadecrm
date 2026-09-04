'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, UserPlus } from 'lucide-react';

import { HREF_NOVO_PARCEIRO } from '@/lib/navegacao';
import { Input } from '@/components/ui/input';
import { RevelarItem, RevelarLista } from '@/components/movimento';

import { buscarAlvos, carregarSugestoes } from './alvos';
import { LinhaAlvo, TituloDoGrupo } from './linha-alvo';
import { DEBOUNCE_BUSCA_MS, type SugestaoDeAlvo } from './tipos';

/**
 * Passo 1: QUEM. Um toque, e muitas vezes zero digitação.
 *
 * A tela abre com o TECLADO FECHADO — sem `autoFocus`. Não é descuido: o teclado do
 * celular cobre metade da altura útil e esconderia justamente a lista "Agora", que é
 * o caminho de um toque. Quem precisa digitar toca na busca; quem ia visitar a loja
 * da esquina só toca no nome.
 *
 * A lista "Agora" é o que ela ia fazer de qualquer jeito: as tarefas de hoje que são
 * dela, e depois os últimos parceiros que ela registrou (três lojas na mesma rua é o
 * padrão de campo). A busca só entra em cena a partir de duas letras, com 250 ms de
 * espera, porque ela digita três letras e para.
 */
export function PassoQuem({
  usuarioId,
  aoEscolher,
}: {
  usuarioId: string;
  aoEscolher: (alvo: SugestaoDeAlvo) => void;
}) {
  const [texto, setTexto] = useState('');
  const [consulta, setConsulta] = useState('');

  useEffect(() => {
    const id = window.setTimeout(() => setConsulta(texto.trim()), DEBOUNCE_BUSCA_MS);
    return () => window.clearTimeout(id);
  }, [texto]);

  const buscando = consulta.length >= 2;

  const sugestoes = useQuery({
    queryKey: ['registro', 'sugestoes', usuarioId],
    queryFn: () => carregarSugestoes(usuarioId),
    staleTime: 30_000,
  });

  const resultados = useQuery({
    queryKey: ['registro', 'busca', consulta],
    queryFn: () => buscarAlvos(consulta),
    enabled: buscando,
    staleTime: 30_000,
  });

  const lista = buscando ? (resultados.data ?? []) : (sugestoes.data ?? []);
  const carregando = buscando ? resultados.isPending : sugestoes.isPending;

  return (
    <div className="-mx-4 flex flex-col md:mx-0">
      <div className="flex flex-col gap-3 px-4 md:px-0">
        <p className="text-lg font-medium">O que aconteceu agora?</p>
        <label className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="sr-only">Buscar parceiro por nome, telefone, @instagram ou bairro</span>
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar parceiro"
            enterKeyHint="search"
            autoComplete="off"
            className="h-12 pl-9 text-base"
          />
          {buscando && resultados.isFetching ? (
            <Loader2
              className="absolute right-3 size-4 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
          ) : null}
        </label>
      </div>

      <TituloDoGrupo>{tituloDaLista(buscando, lista)}</TituloDoGrupo>

      {carregando ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          {buscando
            ? 'Nenhum parceiro com esse nome, telefone ou @.'
            : 'Nenhum parceiro na sua carteira ainda. Busque pelo nome.'}
        </p>
      ) : (
        <RevelarLista>
          <ul className="corpo-tabela flex flex-col border-t border-hairline">
            {lista.map((alvo, indice) => (
              <RevelarItem key={alvo.id} indice={indice}>
                <LinhaAlvo alvo={alvo} aoEscolher={aoEscolher} />
              </RevelarItem>
            ))}
          </ul>
        </RevelarLista>
      )}

      {/* Cadastro rápido (RF-BAS-15) mora na tela de Parceiros e termina abrindo a
          ficha nova — por isso aqui é um link para o contrato que já existe
          (`HREF_NOVO_PARCEIRO`), e não a mesma folha embutida: montá-la aqui
          duplicaria o fluxo e mandaria a pessoa para dois lugares diferentes. */}
      <Link
        href={HREF_NOVO_PARCEIRO}
        className="toque flex min-h-14 items-center gap-3 border-t border-hairline px-4 text-sm font-medium active:bg-muted/60"
      >
        <UserPlus className="size-4 text-muted-foreground" aria-hidden="true" />
        Não achei, cadastrar rápido
      </Link>
    </div>
  );
}

/**
 * O rótulo do grupo diz de onde a lista veio, para ela não confundir "o que está
 * marcado para hoje" com "quem está esquecido". Sem tarefa e sem registro recente, a
 * lista é o fundo de fila, e o título tem de dizer isso.
 */
function tituloDaLista(buscando: boolean, lista: readonly SugestaoDeAlvo[]): string {
  if (buscando) return 'Resultados';
  if (lista.length > 0 && lista.every((alvo) => alvo.origem === 'parado')) {
    return 'Há mais tempo sem contato';
  }
  return 'Agora';
}
