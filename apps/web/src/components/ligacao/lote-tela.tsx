'use client';

/**
 * A tela de Ligar (R13 §3.1): montar o lote de hoje e acompanhar os que estão de pé.
 *
 * ---------------------------------------------------------------------------
 * O que esta tela decide (e o que ela NÃO decide)
 * ---------------------------------------------------------------------------
 * Decide quando a folha de montagem abre, o que a lista mostra e o que acontece
 * depois que um lote é encerrado. Não decide quem entra no lote (é `montar_lote`),
 * nem como se disca (é a tela do lote, em `/ligar/[id]`), nem quando se pode discar
 * (é a janela de horário, que vale no banco).
 *
 * ---------------------------------------------------------------------------
 * Um número no topo, e só um
 * ---------------------------------------------------------------------------
 * "34 contatos esperando ligação em 2 lotes" é a única pergunta que a pessoa faz ao
 * abrir esta tela de manhã. Todo resto — taxa, reunião, tentativas — é por lote, no
 * cartão, onde a comparação tem sentido. Um painel de indicadores aqui em cima
 * competiria com o botão que faz o trabalho começar.
 */
import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PhoneOutgoing } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { traduzirFalha } from '@/components/funis/acoes/erros';

import { CHAVE_LOTES, carregarLotes, encerrarLote, type LoteNaLista } from './consultas';
import { ErroDosLotes, EsqueletoDosLotes, SemLotes } from './lote-estados';
import { ListaDeLotes } from './lote-lista';
import { FolhaDeMontagem } from './lote-montagem';

export function TelaDeLotes({
  podeMontar,
  abrirMontagem = false,
}: {
  podeMontar: boolean;
  /** `?montar=1`: quem chegou pedindo para montar já encontra a folha aberta. */
  abrirMontagem?: boolean;
}) {
  const cliente = useQueryClient();
  // `?montar=1` só abre a folha para quem monta: quem não monta veria um formulário
  // cujo único desfecho é a recusa do `app.can_write()` no banco.
  const [montando, setMontando] = useState(abrirMontagem && podeMontar);

  const lotes = useQuery({ queryKey: CHAVE_LOTES, queryFn: carregarLotes });

  const encerramento = useMutation({
    mutationFn: (lote: LoteNaLista) => encerrarLote(lote.id),
    onSuccess: (_dado, lote) => {
      toast.success(
        lote.faltam > 0
          ? `Lote encerrado. ${lote.faltam} contatos voltaram para a base.`
          : 'Lote encerrado.',
      );
      void cliente.invalidateQueries({ queryKey: CHAVE_LOTES });
      void cliente.invalidateQueries({ queryKey: ['ligacao', 'base-da-montagem'] });
    },
    onError: (erro) => {
      const { titulo, saida } = traduzirFalha(erro);
      toast.error(titulo, { description: saida });
    },
  });

  const abrirFolha = useCallback(() => setMontando(true), []);

  const emAndamento = (lotes.data ?? []).filter(
    (lote) => lote.status === 'ativo' || lote.status === 'pausado',
  );
  const esperando = emAndamento.reduce((soma, lote) => soma + lote.faltam, 0);

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Ligar</h1>
          <p className="text-sm text-muted-foreground">
            {lotes.isPending ? (
              'Carregando os lotes...'
            ) : esperando > 0 ? (
              <>
                <span className="numerico">{esperando}</span>
                {esperando === 1
                  ? ' contato esperando ligação em '
                  : ' contatos esperando ligação em '}
                <span className="numerico">{emAndamento.length}</span>
                {emAndamento.length === 1 ? ' lote' : ' lotes'}
              </>
            ) : (
              'Nenhum contato na fila. Monte o lote do turno para começar.'
            )}
          </p>
        </div>

        {podeMontar ? (
          <Button onClick={abrirFolha} className="toque h-11 md:h-9">
            <PhoneOutgoing aria-hidden="true" />
            Montar lote
          </Button>
        ) : null}
      </header>

      {lotes.isPending ? (
        <EsqueletoDosLotes />
      ) : lotes.isError ? (
        <ErroDosLotes causa={lotes.error} aoTentar={() => void lotes.refetch()} />
      ) : (lotes.data ?? []).length === 0 ? (
        <SemLotes aoMontar={abrirFolha} podeMontar={podeMontar} />
      ) : (
        <ListaDeLotes
          lotes={lotes.data ?? []}
          aoEncerrar={(lote) => encerramento.mutate(lote)}
          encerrandoId={encerramento.isPending ? (encerramento.variables?.id ?? null) : null}
        />
      )}

      <FolhaDeMontagem aberta={montando} aoFechar={() => setMontando(false)} />
    </div>
  );
}
