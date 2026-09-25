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
 * O lote é de 20 por rodada, e um pedido enfileira quantas rodadas o que está
 * esperando pedir, até 15 (300 nomes). A chave é da RODADA, e não do dia: com a
 * chave do dia, 155 candidatos levavam oito DIAS, porque a segunda chamada da
 * mesma tarde era recusada por idempotência, em silêncio.
 *
 * E o FREIO DO ORÇAMENTO é dito aqui, não engolido: acima de 80% do teto só
 * passam o atendimento e a transcrição. Sem esta mensagem, quem clicasse ficaria
 * esperando um veredito que nunca vem.
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
      if (r.motivo === 'orcamento_na_linha_de_alerta') {
        toast.error('A IA não foi acionada: o orçamento do mês passou de 80%.', {
          description:
            'Acima dessa linha só o atendimento e a transcrição continuam. A leitura da fila volta no mês que vem, ou quando um admin subir o teto em Ajustes.',
        });
        return;
      }
      if (r.motivo === 'orcamento_esgotado') {
        toast.error('A IA não foi acionada: o orçamento do mês acabou.', {
          description: 'Nenhuma chamada sai até o mês virar ou o teto subir.',
        });
        return;
      }
      toast.success('A IA foi acionada.', {
        description:
          r.rodadas > 1
            ? `São ${r.esperando} nomes esperando; ela lê 20 por vez, e ${r.rodadas} rodadas entraram na fila. Os vereditos aparecem em instantes.`
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
