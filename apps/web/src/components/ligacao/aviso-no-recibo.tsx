'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';

import {
  fraseDoAviso,
  RPC_AVISO_CANCELAR,
  RPC_AVISO_SITUACAO,
  situacaoDoAvisoSchema,
} from './aviso-no-whatsapp';

async function lerSituacao(tentativaId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(RPC_AVISO_SITUACAO, { p_attempt_id: tentativaId });
  if (error) throw error;
  const lido = situacaoDoAvisoSchema.safeParse(data);
  // Recusa (sem permissão, tentativa sumida) ou formato novo: o recibo só não fala do aviso.
  return lido.success ? lido.data : null;
}

async function cancelar(tentativaId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(RPC_AVISO_CANCELAR, { p_attempt_id: tentativaId });
  if (error) throw error;
  return data as { ok: boolean; motivo?: string } | null;
}

/**
 * A linha do recibo sobre o aviso no WhatsApp de quem não atendeu. O aviso já
 * está na fila quando esta linha aparece (o gatilho roda na tabulação); o botão
 * "Não avisar" é a opção de cancelar que foi pedida junto com o aviso.
 */
export function AvisoNoWhatsapp({ tentativaId }: { tentativaId: string }) {
  const cliente = useQueryClient();
  const chave = ['ligacao', 'aviso', tentativaId];
  const situacao = useQuery({ queryKey: chave, queryFn: () => lerSituacao(tentativaId) });
  const naoAvisar = useMutation({
    mutationFn: () => cancelar(tentativaId),
    onSuccess: (r) => {
      if (!r?.ok) toast.error('O aviso já tinha saído, não deu para cancelar.');
      void cliente.invalidateQueries({ queryKey: chave });
    },
    onError: () => toast.error('Não deu para cancelar o aviso. Tente de novo.'),
  });

  const frase = situacao.data ? fraseDoAviso(situacao.data) : null;
  if (!frase) return null;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <MessageCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {frase.texto}
      </p>
      {frase.podeCancelar ? (
        <button
          type="button"
          disabled={naoAvisar.isPending}
          onClick={() => naoAvisar.mutate()}
          className="toque self-start rounded-lg px-2 py-1 text-sm whitespace-nowrap underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          Não avisar
        </button>
      ) : null}
    </div>
  );
}
