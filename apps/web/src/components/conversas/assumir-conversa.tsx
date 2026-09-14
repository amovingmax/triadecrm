'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Hand } from 'lucide-react';
import { z } from 'zod';

import { cn } from '@/lib/utils';
import { roleFromAccessToken, type AppRole } from '@/lib/auth/role';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

import { CHAVE_CONVERSAS, chaveDaLinha } from './dados';

/**
 * Vários atendentes num número só (migração 20260914100000, seção F).
 *
 * Quem manda mensagem numa conversa já passa a atendê-la sozinho (gatilho
 * `messages_quem_responde_atende`). Este botão é para o momento de ANTES:
 * "deixa comigo", para duas pessoas não responderem o mesmo parceiro ao mesmo
 * tempo. Muda uma coisa só — quem está atendendo — e o banco confere se a
 * pessoa já poderia escrever ali.
 */

/** Espelho de `app.can_write()`: só evita oferecer o botão a quem o banco recusaria. */
const ESCREVEM: readonly AppRole[] = ['admin', 'gestor', 'sdr', 'embaixador'];

export type Eu = { id: string; podeEscrever: boolean };

/** Quem está usando a tela, lido da sessão local (sem ida ao servidor). */
export function useEu(): Eu | null {
  const consulta = useQuery({
    queryKey: ['sessao', 'eu'],
    queryFn: async (): Promise<Eu | null> => {
      const { data } = await createClient().auth.getSession();
      const sessao = data.session;
      if (!sessao) return null;
      return {
        id: sessao.user.id,
        podeEscrever: ESCREVEM.includes(roleFromAccessToken(sessao.access_token)),
      };
    },
    staleTime: Infinity,
  });
  return consulta.data ?? null;
}

const resultadoSchema = z.object({
  ok: z.literal(true),
  ja_era_sua: z.boolean(),
  anterior: z.string().nullable(),
});

export function AssumirConversa({
  fioId,
  organizacaoId,
  className,
}: {
  fioId: string;
  organizacaoId: string;
  className?: string;
}) {
  const clientes = useQueryClient();
  const assumir = useMutation({
    mutationFn: async () => {
      const { data, error } = await createClient().rpc('assumir_conversa', {
        p_conversation_id: fioId,
      });
      if (error) throw error;
      return resultadoSchema.parse(data);
    },
    onSuccess: (r) => {
      toast.success('Agora você está atendendo esta conversa.', {
        description: r.anterior ? `Antes estava com ${r.anterior}.` : undefined,
      });
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      void clientes.invalidateQueries({ queryKey: chaveDaLinha(organizacaoId) });
    },
    onError: () => {
      toast.error('Não deu para assumir a conversa.', {
        description: 'Seu perfil pode não atender conversas. Tente de novo em instantes.',
      });
    },
  });

  return (
    <Button
      variant="outline"
      className={cn('toque h-11 md:h-9', className)}
      disabled={assumir.isPending}
      onClick={() => assumir.mutate()}
    >
      <Hand aria-hidden="true" />
      {assumir.isPending ? 'Assumindo...' : 'Assumir conversa'}
    </Button>
  );
}
