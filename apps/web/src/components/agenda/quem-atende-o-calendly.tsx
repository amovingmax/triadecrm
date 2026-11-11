'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  erroAoGravarQuemAtende,
  explicacaoDaEscolha,
  lerQuemAtende,
  rotuloDaPessoa,
  rotuloDoPadrao,
  SEM_ESCOLHA,
  type QuemAtende,
} from './calendly';

/**
 * "Quem atende o que chega pelo Calendly" (11/11/2026), só para admin e só na Imova
 * (módulo `calendly`), no pé da Agenda — é onde o Calendly aparece; Ajustes não tem
 * nada dele.
 *
 * A conta do Calendly é uma só (a do Rafael), então o e-mail do anfitrião que chega
 * em cada agendamento é sempre o dele, e tudo caía na agenda dele, com a ficha sem
 * responsável. A pessoa escolhida aqui vale antes do anfitrião: o agendamento entra
 * na agenda dela, a ficha e o negócio novos ficam com ela, e é a agenda dela que o
 * espelho copia no Google para o Calendly esconder os horários ocupados. Grava
 * `app_settings['calendly'].dono_email` por `public.calendly_quem_atende_gravar`,
 * que confere o papel e não mexe no resto da configuração.
 *
 * Banco sem a migração 20261111204000: a leitura falha e o campo não aparece.
 */
const CHAVE = ['agenda', 'calendly', 'quem-atende'] as const;

async function buscar(): Promise<QuemAtende | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('calendly_quem_atende');
  return error ? null : lerQuemAtende(data);
}

export function QuemAtendeOCalendly() {
  const cliente = useQueryClient();
  const consulta = useQuery({ queryKey: CHAVE, queryFn: buscar, staleTime: 5 * 60_000 });
  const gravacao = useMutation({
    mutationFn: async (pessoa: string | null) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc(
        'calendly_quem_atende_gravar',
        pessoa ? { p_pessoa: pessoa } : {},
      );
      if (error) throw error;
      return lerQuemAtende(data);
    },
    onSuccess: (quem) => {
      cliente.setQueryData(CHAVE, quem);
      const escolhida = quem.pessoas.find((p) => p.id === quem.pessoaId);
      toast.success(
        escolhida
          ? `O que chegar pelo Calendly vai para a agenda de ${escolhida.nome}.`
          : 'O que chegar pelo Calendly vai para a agenda do dono da conta do Calendly.',
      );
    },
    onError: (erro: { code?: string }) => {
      toast.error(erroAoGravarQuemAtende(erro?.code));
    },
  });

  const quem = consulta.data;
  if (!quem) return null;

  return (
    <section
      aria-labelledby="calendly-quem-atende"
      className="sombra-base flex flex-col gap-2 rounded-xl bg-card p-5"
    >
      <h2
        id="calendly-quem-atende"
        className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]"
      >
        <CalendarCheck className="size-4 text-muted-foreground" aria-hidden="true" />
        Quem atende o que chega pelo Calendly
      </h2>
      <Select
        value={quem.pessoaId ?? SEM_ESCOLHA}
        disabled={gravacao.isPending}
        onValueChange={(valor) => gravacao.mutate(valor === SEM_ESCOLHA ? null : valor)}
      >
        <SelectTrigger
          className="h-11 w-full max-w-md md:h-9"
          aria-label="Quem atende o que chega pelo Calendly"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SEM_ESCOLHA}>{rotuloDoPadrao(quem)}</SelectItem>
          {quem.pessoas.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {rotuloDaPessoa(p)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="max-w-prose text-xs text-muted-foreground">{explicacaoDaEscolha(quem)}</p>
    </section>
  );
}
