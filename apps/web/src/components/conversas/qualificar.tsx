'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flame, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

import { ROTULO_INTENCAO } from './mensagens';

/**
 * "Qualificar" na conversa de quem respondeu ao aviso de ligação (migração
 * 20261013120000).
 *
 * Pedido de 13/10/2026: quem responde ao "Tentamos entrar em contato" e tem
 * interesse em continuar é qualificado no funil. Decisões do mesmo dia:
 * qualificado = Respondeu + Quente, e a IA SUGERE, uma pessoa CONFIRMA (ADR-05).
 *
 * O cartão é o de aviso da casa (faixa, disco e selo em menta), o mesmo do aviso
 * no WhatsApp do recibo da ligação: quem viu um reconhece o outro. Ele só existe
 * quando o banco diz que há sugestão (`public.qualificacao_sugerida`) — sem
 * leitura de interesse, sem aviso de ligação, ou com o negócio já Quente, a
 * conversa fica como sempre foi. "Agora não" esconde para quem clicou, neste
 * navegador, até a IA ler outra intenção.
 */

const sugestaoSchema = z.object({
  sugerir: z.boolean(),
  motivo: z.string().nullable().optional(),
  intencao: z.string().nullable().optional(),
});

async function lerSugestao(fioId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('qualificacao_sugerida', { p_conversation_id: fioId });
  if (error) throw error;
  const lido = sugestaoSchema.safeParse(data);
  return lido.success ? lido.data : null;
}

async function qualificar(fioId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('qualificar_pela_conversa', {
    p_conversation_id: fioId,
    p_client_key: crypto.randomUUID(),
  });
  if (error) throw error;
  return data as { ok: boolean; motivo?: string | null; ja_estava?: boolean } | null;
}

const CHAVE_RAIZ = ['conversas'] as const;
const chaveDaSugestao = (fioId: string) => [...CHAVE_RAIZ, 'qualificar', fioId] as const;

function chaveDoAgoraNao(fioId: string, intencao: string) {
  return `triade:qualificar:agora-nao:${fioId}:${intencao}`;
}
function lerAgoraNao(fioId: string, intencao: string) {
  try {
    return window.localStorage.getItem(chaveDoAgoraNao(fioId, intencao)) === '1';
  } catch {
    return false;
  }
}

export function QualificarPelaConversa({
  fioId,
  nome,
  className,
}: {
  fioId: string;
  nome: string;
  className?: string;
}) {
  const clientes = useQueryClient();
  const [escondida, setEscondida] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: chaveDaSugestao(fioId),
    queryFn: () => lerSugestao(fioId),
    // A leitura da IA chega segundos depois da mensagem: a tela pergunta de novo.
    refetchInterval: 20_000,
  });
  const qualificando = useMutation({
    mutationFn: () => qualificar(fioId),
    onSuccess: (r) => {
      if (r?.ok) {
        toast.success('Qualificado no funil', {
          description: `${nome} · Respondeu, Quente. Próxima ação: marcar a apresentação.`,
          icon: <Flame className="size-4" aria-hidden="true" />,
        });
      } else {
        toast.error('Não deu para qualificar.', {
          description:
            r?.motivo === 'sem_permissao'
              ? 'Seu perfil não registra contatos.'
              : 'A sugestão mudou enquanto a tela estava aberta. Confira a ficha.',
        });
      }
      // `['conversas']` cobre a sugestão, a lista e o cabeçalho da conversa (etapa e
      // temperatura), que mudam com o clique.
      void clientes.invalidateQueries({ queryKey: CHAVE_RAIZ });
    },
    onError: () => toast.error('Não deu para qualificar. Tente de novo.'),
  });

  if (!data?.sugerir || !data.intencao) return null;
  const intencao = data.intencao;
  if (escondida === intencao || lerAgoraNao(fioId, intencao)) return null;
  const leitura = ROTULO_INTENCAO[intencao as keyof typeof ROTULO_INTENCAO] ?? 'mostrou interesse';

  function agoraNao() {
    try {
      window.localStorage.setItem(chaveDoAgoraNao(fioId, intencao), '1');
    } catch {
      // Sem armazenamento: esconde só enquanto a tela estiver aberta.
    }
    setEscondida(intencao);
  }

  return (
    <section
      aria-label="Sugestão de qualificar"
      className={cn(
        'relative overflow-hidden rounded-2xl border border-hairline bg-card text-card-foreground',
        'animate-in duration-300 fade-in-0 slide-in-from-bottom-1',
        className,
      )}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-menta" />
      {/* Compacto: mora no rodapé, em cima da caixa de resposta, e não pode empurrar
          a conversa para fora da tela. Em tela larga, texto e botões numa linha só. */}
      <div className="flex flex-col gap-2.5 py-3 pr-3 pl-5 md:flex-row md:items-center md:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-menta text-menta-tinta">
            <Sparkles className="size-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-[15px] leading-snug font-semibold">
                Respondeu ao aviso e {leitura}
              </p>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-menta py-px pr-2 pl-1.5 text-[10px] leading-4 font-semibold tracking-[0.04em] text-menta-tinta uppercase">
                <Sparkles className="size-3" aria-hidden="true" />
                Sugestão da IA
              </span>
            </div>
            <p className="text-sm leading-snug text-muted-foreground">
              Qualificar deixa {nome} em Respondeu, Quente, com “Marcar apresentação” para hoje.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pl-12 md:pl-0">
          <Button
            type="button"
            size="lg"
            className="toque h-11 md:h-9"
            disabled={qualificando.isPending}
            onClick={() => qualificando.mutate()}
          >
            <Flame aria-hidden="true" />
            Qualificar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="toque h-11 md:h-9"
            disabled={qualificando.isPending}
            onClick={agoraNao}
          >
            Agora não
          </Button>
        </div>
      </div>
    </section>
  );
}
