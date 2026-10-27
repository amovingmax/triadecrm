'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';

import { partesDestacadas, MINIMO_DA_BUSCA } from './busca-no-fio';
import { buscarMensagens, chaveDaBuscaDeMensagens, type AchadoDaBusca } from './dados';
import { nomeDoCliente } from './fora-da-base-dados';
import { rotuloDoDia } from './formatos';
import type { FioCru } from './mensagens';
import type { OrganizacaoCrua } from './montagem';

/**
 * "Mensagens", embaixo da lista, quando a busca tem texto (27/10/2026): o que
 * a lupa acha no TEXTO das conversas, e não só no nome do parceiro. É a lupa do
 * WhatsApp. Quem procura é o banco (`public.conversas_buscar`, com a RLS de
 * quem pergunta); o campo já espera a pessoa parar de digitar (`CampoBusca`).
 *
 * Um toque abre a conversa já na mensagem.
 */
export function BuscaDeMensagens({
  texto,
  fios,
  organizacoes,
  aoAbrir,
}: {
  texto: string;
  fios: readonly FioCru[];
  organizacoes: readonly Pick<OrganizacaoCrua, 'id' | 'name'>[];
  aoAbrir: (alvo: { conversaId: string; organizacaoId: string | null; mensagemId: string }) => void;
}) {
  const termo = texto.trim();
  const busca = useQuery({
    queryKey: chaveDaBuscaDeMensagens(termo),
    queryFn: () => buscarMensagens(termo),
    enabled: termo.length >= MINIMO_DA_BUSCA,
    staleTime: 30_000,
  });

  const nomes = useMemo(() => {
    const daFicha = new Map(organizacoes.map((o) => [o.id, o.name]));
    return new Map(
      fios.map((f) => [
        f.id,
        {
          organizacaoId: f.organization_id,
          nome: (f.organization_id ? daFicha.get(f.organization_id) : null) ?? nomeDoCliente(f),
        },
      ]),
    );
  }, [fios, organizacoes]);

  if (termo.length < MINIMO_DA_BUSCA) return null;
  // Só o que esta tela sabe abrir: a conversa que a lista carregou.
  const achados = (busca.data ?? []).filter((a) => nomes.has(a.conversaId));

  return (
    <section aria-label="Mensagens que batem com a busca" className="border-t border-hairline">
      <h2 className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        <MessageSquareText className="size-3.5" aria-hidden="true" />
        Mensagens
      </h2>
      {busca.isPending ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">Procurando nas mensagens...</p>
      ) : busca.isError ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          A busca nas mensagens não respondeu.
        </p>
      ) : achados.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">Nenhuma mensagem com esse texto.</p>
      ) : (
        <ul className="flex flex-col pb-1">
          {achados.map((a) => (
            <Achado
              key={a.mensagemId}
              achado={a}
              termo={termo}
              nome={nomes.get(a.conversaId)?.nome ?? 'Conversa'}
              aoAbrir={() =>
                aoAbrir({
                  conversaId: a.conversaId,
                  organizacaoId: nomes.get(a.conversaId)?.organizacaoId ?? null,
                  mensagemId: a.mensagemId,
                })
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Achado({
  achado,
  termo,
  nome,
  aoAbrir,
}: {
  achado: AchadoDaBusca;
  termo: string;
  nome: string;
  aoAbrir: () => void;
}) {
  const dia = rotuloDoDia(achado.em);
  return (
    <li>
      <button
        type="button"
        onClick={aoAbrir}
        className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
      >
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{nome}</span>
          <span className="numerico shrink-0 text-xs text-muted-foreground">
            {dia.palavra}
            {dia.numero ?? ''}
          </span>
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {achado.entrada ? null : <span className="text-foreground">Time: </span>}
          {partesDestacadas(achado.trecho, termo).map((p, i) =>
            p.destaque ? (
              <mark key={i} className="rounded-sm bg-menta px-0.5 text-menta-tinta">
                {p.texto}
              </mark>
            ) : (
              <span key={i}>{p.texto}</span>
            ),
          )}
        </span>
      </button>
    </li>
  );
}
