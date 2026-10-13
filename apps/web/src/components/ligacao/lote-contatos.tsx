'use client';

/**
 * Quem está no lote, com o botão de tirar da fila (13/10/2026).
 *
 * Só a gestão abre esta folha (`lote-lista.tsx`). Tirar não pede confirmação:
 * é um contato, volta para a base na hora e pode entrar em outro lote — o aviso
 * diz isso com o nome dele. Quem já foi ligado fica na lista sem botão: é
 * história do lote, não fila.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { CHAVE_LOTES, type LoteNaLista } from './consultas';
import {
  carregarContatosDoLote,
  chaveDosContatosDoLote,
  recadoDoLote,
  ROTULO_DO_CONTATO_NO_LOTE,
  tirarContatoDoLote,
  type ContatoDoLote,
} from './lote-gestao';

export function ContatosDoLote({
  lote,
  aberto,
  aoFechar,
}: {
  lote: LoteNaLista;
  aberto: boolean;
  aoFechar: () => void;
}) {
  const cliente = useQueryClient();
  const loteAberto = lote.status === 'ativo' || lote.status === 'pausado';
  const contatos = useQuery({
    queryKey: chaveDosContatosDoLote(lote.id),
    queryFn: () => carregarContatosDoLote(lote.id),
    enabled: aberto,
  });

  const tirar = useMutation({
    mutationFn: (contato: ContatoDoLote) => tirarContatoDoLote(contato.itemId),
    onSuccess: (resultado) => {
      if (!resultado.ok) {
        toast.error('Não saiu do lote.', { description: recadoDoLote(resultado.motivo) });
      } else {
        toast.success(`${resultado.nome} saiu do lote e voltou para a base.`);
      }
      void cliente.invalidateQueries({ queryKey: chaveDosContatosDoLote(lote.id) });
      void cliente.invalidateQueries({ queryKey: CHAVE_LOTES });
      void cliente.invalidateQueries({ queryKey: ['ligacao', 'base-da-montagem'] });
    },
  });

  return (
    <Dialog open={aberto} onOpenChange={(estado) => !estado && aoFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Contatos de “{lote.nome}”</DialogTitle>
          <DialogDescription>
            {loteAberto
              ? 'Quem ainda está na fila pode sair do lote: volta para a base e pode entrar em outro.'
              : 'Este lote está encerrado: a lista fica só para consulta.'}
          </DialogDescription>
        </DialogHeader>

        {contatos.isPending ? (
          <p className="text-sm text-muted-foreground">Carregando os contatos...</p>
        ) : contatos.isError ? (
          <p className="text-sm text-destructive-texto">
            Não deu para ler os contatos deste lote. Feche e abra de novo.
          </p>
        ) : contatos.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este lote não tem contatos.</p>
        ) : (
          <ul className="-mx-1 flex max-h-[60vh] flex-col divide-y overflow-y-auto px-1">
            {contatos.data.map((contato) => (
              <li key={contato.itemId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{contato.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {contato.tentativas === 0
                      ? 'Ainda não foi ligado'
                      : `${contato.tentativas} ${contato.tentativas === 1 ? 'ligação' : 'ligações'}`}
                    {contato.ultimoResultado ? ` · ${contato.ultimoResultado}` : ''}
                  </p>
                </div>
                {loteAberto && contato.status === 'fila' ? (
                  <Button
                    variant="outline"
                    className="toque h-11 shrink-0 md:h-8"
                    disabled={tirar.isPending}
                    onClick={() => tirar.mutate(contato)}
                  >
                    {tirar.isPending && tirar.variables?.itemId === contato.itemId
                      ? 'Tirando...'
                      : 'Tirar do lote'}
                  </Button>
                ) : (
                  <Badge variant="pilula" className="shrink-0">
                    {ROTULO_DO_CONTATO_NO_LOTE[contato.status]}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
