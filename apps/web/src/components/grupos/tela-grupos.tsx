'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';
import { useAreaVisivel } from '@/components/conversas/area-visivel';
import { EsqueletoLista, ErroDaTela, TelaDeEntrada } from '@/components/conversas/estados';
import { useEhCelular } from '@/components/parceiros/usar-eh-celular';

import { CriarGrupo } from './criar-grupo';
import { CHAVE_DOS_GRUPOS, carregarGrupos } from './dados';
import { useEcoDosGrupos } from './eco-dos-grupos';
import { FioDoGrupo } from './fio-do-grupo';
import { ListaGrupos } from './lista-grupos';
import type { PessoaDoTime } from './tipos';

/** Sem eco, a lista pergunta de 20 em 20 s. */
const RITMO_SEM_ECO_MS = 20_000;

/**
 * A aba "Grupos" de Conversas (27/10/2026): a lista de grupos à esquerda, o fio
 * do grupo à direita. Mesmo comportamento da aba de conversas: no computador,
 * duas colunas e, sem escolha, a tela de entrada com a marca da empresa; no
 * celular, uma coisa por vez, e o grupo aberto ocupa a tela inteira, com um
 * "voltar".
 *
 * MORA DENTRO DA GRADE DE CONVERSAS: devolve as duas colunas (a lista e o fio)
 * soltas, e quem as põe lado a lado é a grade de `tela-conversas.tsx`, a mesma
 * das outras abas. Assim as larguras são as mesmas em toda aba.
 *
 * Pedido do Rafael: "quero todas as funcionalidades do wpp no nosso CRM, criar
 * grupo, apagar mensagem e etc". O que a API oficial da Meta deixa fazer com
 * grupo está aqui; o que ela não deixa (pôr alguém dentro sem o link, apagar
 * mensagem para todos), a tela diz.
 */
export function TelaGrupos({
  pessoas,
  cabecalho = null,
}: {
  pessoas: readonly PessoaDoTime[];
  /**
   * O alto da coluna da lista: o título de Conversas e as pílulas das abas, para
   * a aba Grupos não perder o caminho de volta (03/11/2026, Conversas no jeito
   * do WhatsApp).
   */
  cabecalho?: React.ReactNode;
}) {
  const ehCelular = useEhCelular();
  const [escolhidoId, setEscolhidoId] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const eco = useEcoDosGrupos();

  const lista = useQuery({
    queryKey: CHAVE_DOS_GRUPOS,
    queryFn: carregarGrupos,
    refetchInterval: eco === 'sem_eco' ? RITMO_SEM_ECO_MS : false,
  });
  const grupos = lista.data ?? [];

  // Só abre o grupo que a pessoa escolheu, como em Conversas (04/11/2026): sem
  // escolha, o computador mostra a tela de entrada com a marca da empresa.
  const aberto = escolhidoId ? (grupos.find((g) => g.id === escolhidoId) ?? null) : null;

  const telaCheia = ehCelular && aberto !== null;
  useAreaVisivel(telaCheia);

  return (
    <>
      {telaCheia ? null : (
        <section
          aria-label="Grupos de WhatsApp"
          className="flex min-h-0 min-w-0 flex-col md:border-r md:border-wpp-linha"
        >
          {cabecalho ? (
            <div className="flex shrink-0 flex-col gap-3 px-3.5 pt-3.5 pb-2.5">
              <h1 className="font-heading text-[21px] font-semibold tracking-tight">Conversas</h1>
              {cabecalho}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 md:overflow-y-auto">
            {lista.isPending ? (
              <EsqueletoLista />
            ) : lista.isError ? (
              <ErroDaTela causa={lista.error.message} aoTentar={() => void lista.refetch()} />
            ) : (
              <ListaGrupos
                grupos={grupos}
                selecionadoId={aberto?.id ?? null}
                aoEscolher={setEscolhidoId}
                aoCriar={() => setCriando(true)}
              />
            )}
          </div>
        </section>
      )}

      {ehCelular && !aberto ? null : (
        <section
          aria-label="Mensagens do grupo"
          className={cn(
            'min-h-0 min-w-0 md:overflow-hidden',
            telaCheia &&
              'fixed inset-x-0 top-0 z-40 h-dvh rounded-none bg-wpp-painel pt-[env(safe-area-inset-top)] shadow-none',
          )}
          data-area-visivel={telaCheia ? '' : undefined}
        >
          {aberto ? (
            <FioDoGrupo
              key={aberto.id}
              grupo={aberto}
              pessoas={pessoas}
              escolhaExplicita={aberto.id === escolhidoId}
              semEco={eco === 'sem_eco'}
              aoVoltar={() => setEscolhidoId(null)}
            />
          ) : (
            <TelaDeEntrada
              texto={
                !lista.isPending && grupos.length === 0
                  ? 'Crie o primeiro grupo na lista ao lado.'
                  : 'Escolha um grupo na lista ao lado.'
              }
            />
          )}
        </section>
      )}

      <CriarGrupo
        aberto={criando}
        aoFechar={() => setCriando(false)}
        aoCriado={(id) => {
          setCriando(false);
          setEscolhidoId(id);
        }}
      />
    </>
  );
}
