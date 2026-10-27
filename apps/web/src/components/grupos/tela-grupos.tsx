'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';
import { useAreaVisivel } from '@/components/conversas/area-visivel';
import { EsqueletoLista, ErroDaTela } from '@/components/conversas/estados';
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
 * duas colunas e o primeiro grupo já aberto; no celular, uma coisa por vez, e o
 * grupo aberto ocupa a tela inteira, com um "voltar".
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
export function TelaGrupos({ pessoas }: { pessoas: readonly PessoaDoTime[] }) {
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

  // Sem escolha, o computador abre o primeiro da lista; o celular, nenhum.
  const abertoId = escolhidoId ?? (ehCelular ? null : (grupos[0]?.id ?? null));
  const aberto = abertoId ? (grupos.find((g) => g.id === abertoId) ?? null) : null;

  const telaCheia = ehCelular && aberto !== null;
  const areaVisivel = useAreaVisivel(telaCheia);

  // MEXER NO GRUPO É ESCOLHÊ-LO, como em Conversas: a abertura sozinha do
  // primeiro da lista não zera o "por ler" de ninguém; clicar, rolar ou digitar
  // dentro dele vale como a escolha.
  const abertoAgoraId = aberto?.id ?? null;
  const escolherAberto = () => {
    if (abertoAgoraId !== null && abertoAgoraId !== escolhidoId) setEscolhidoId(abertoAgoraId);
  };

  return (
    <>
      {telaCheia ? null : (
        <section
          aria-label="Grupos de WhatsApp"
          className="sombra-base min-h-0 min-w-0 rounded-xl bg-card md:overflow-y-auto"
        >
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
        </section>
      )}

      {ehCelular && !aberto ? null : (
        <section
          aria-label="Mensagens do grupo"
          className={cn(
            'sombra-base min-h-0 min-w-0 rounded-xl bg-card md:overflow-hidden',
            telaCheia &&
              'fixed inset-x-0 top-0 z-40 h-dvh rounded-none bg-background pt-[env(safe-area-inset-top)] shadow-none',
          )}
          style={areaVisivel}
          onPointerDownCapture={escolherAberto}
          onKeyDownCapture={escolherAberto}
          onWheelCapture={escolherAberto}
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
          ) : lista.isPending ? null : (
            <div className="flex h-full min-h-64 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {grupos.length === 0
                ? 'Crie o primeiro grupo na lista ao lado.'
                : 'Escolha um grupo na lista.'}
            </div>
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
