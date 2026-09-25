'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { pedirLeituraDaIa } from './dados';

/**
 * Pedir à IA que leia os candidatos que ela ainda não viu.
 *
 * A conta da triagem soma nota, avaliações, categoria e cidade — e não sabe ler.
 * "Fotografia Silva — Formaturas" e "Fotografia Silva — Casamentos" recebem dela
 * a mesma pontuação. Este botão pede a metade que lê.
 *
 * **É um pedido, não uma espera.** O trabalho entra na fila do worker-ai e volta
 * em segundos; a tela avisa que foi pedido e a fila se atualiza sozinha quando o
 * veredito chega (o eco do banco cuida disso). Travar o botão num spinner de
 * trinta segundos seria fingir que a pessoa precisa ficar olhando.
 *
 * O lote é de 30 e a chave é do dia: apertar duas vezes na mesma tarde não gasta
 * duas chamadas ao modelo.
 */
export function PedirLeituraDaIa({ className }: { className?: string }) {
  const clientes = useQueryClient();

  const pedir = useMutation({
    mutationFn: pedirLeituraDaIa,
    onSuccess: (r) => {
      if (r.motivo === 'nada_para_ler') {
        toast.success('A IA já leu todos os nomes da fila.');
        return;
      }
      toast.success('A IA foi acionada.', {
        description:
          r.esperando > 30
            ? `São ${r.esperando} candidatos esperando; ela lê 30 por vez. Os vereditos aparecem na fila em instantes.`
            : 'Os vereditos aparecem na fila em instantes.',
      });
      void clientes.invalidateQueries({ queryKey: ['radar'] });
    },
    onError: (erro: Error) => {
      toast.error('A IA não foi acionada.', { description: erro.message });
    },
  });

  return (
    <Button
      variant="outline"
      className={cn('toque h-11 md:h-9', className)}
      disabled={pedir.isPending}
      onClick={() => pedir.mutate()}
    >
      <Sparkles aria-hidden="true" />
      {pedir.isPending ? 'Pedindo...' : 'Ler com a IA'}
    </Button>
  );
}
