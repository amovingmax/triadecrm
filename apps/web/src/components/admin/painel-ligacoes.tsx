'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';

import { Interruptor } from './painel-atendimento';

/**
 * Ajustes → Ligações (13/10/2026).
 *
 * As duas chaves da voz, que até aqui só mudavam por SQL: a ligação pelo
 * navegador (`app_settings['voz.telefonia'].ativa`) e o aviso no WhatsApp para
 * quem não atendeu (`app_settings['voz.aviso_nao_atendeu'].ativo`). Quem grava é
 * `public.voz_configurar`, só para admin e gestor.
 *
 * NENHUMA DAS DUAS DECIDE QUEM LIGA. Ligar é de admin, gestor e de quem liga, e
 * a primeira frase do painel diz isso: desligar a telefonia não tira a ligação
 * de ninguém, só muda de onde ela sai.
 */
type Chaves = { telefoniaAtiva: boolean; avisoAtivo: boolean };

const CHAVE = ['admin', 'ligacoes'] as const;

async function carregar(): Promise<Chaves> {
  const { data, error } = await createClient()
    .from('app_settings')
    .select('key, value')
    .in('key', ['voz.telefonia', 'voz.aviso_nao_atendeu']);
  if (error) throw error;
  const valor = (chave: string) =>
    ((data ?? []).find((linha) => linha.key === chave)?.value ?? {}) as Record<string, unknown>;
  return {
    telefoniaAtiva: valor('voz.telefonia').ativa === true,
    avisoAtivo: valor('voz.aviso_nao_atendeu').ativo === true,
  };
}

const RECUSA: Record<string, string> = {
  sem_permissao: 'Seu perfil não muda estas chaves. Isso é de admin e gestor.',
  valor_invalido: 'O valor não foi aceito. Recarregue a página e tente de novo.',
};

async function configurar(p: Record<string, boolean>): Promise<void> {
  const { data, error } = await createClient().rpc('voz_configurar', { p });
  if (error) throw new Error('Não deu para falar com o servidor. Tente de novo.');
  const r = (data ?? {}) as { ok?: boolean; motivo?: string };
  if (r.ok !== true) throw new Error(RECUSA[r.motivo ?? ''] ?? 'A mudança não foi aceita.');
}

export function PainelLigacoes({ podeEditar }: { podeEditar: boolean }) {
  const clientes = useQueryClient();
  const consulta = useQuery({ queryKey: CHAVE, queryFn: carregar });

  const mudar = useMutation({
    mutationFn: configurar,
    onSuccess: () => {
      toast.success('Salvo.');
      void clientes.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: Error) => toast.error('Não salvou.', { description: e.message }),
  });

  if (consulta.isPending) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (consulta.isError || !consulta.data) {
    return <p className="text-sm text-destructive">Não deu para ler as configurações.</p>;
  }
  const { telefoniaAtiva, avisoAtivo } = consulta.data;

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Todo mundo que trabalha no CRM pode ligar para parceiros: admin, gestor e quem liga. As
        chaves abaixo não mudam isso. Elas decidem por onde a ligação sai e o que acontece quando
        ninguém atende.
      </p>
      <Interruptor
        id="voz-telefonia"
        titulo="Ligação pelo navegador"
        descricao={
          telefoniaAtiva
            ? 'Ligada: o botão Ligar disca pelo computador, e a duração da chamada vem da linha. Cada minuto falado é cobrado.'
            : 'Desligada: cada pessoa liga do próprio aparelho e registra o resultado no CRM. Nada é cobrado.'
        }
        ligado={telefoniaAtiva}
        podeEditar={podeEditar && !mudar.isPending}
        aoMudar={(v) => mudar.mutate({ telefonia_ativa: v })}
      />
      <Interruptor
        id="voz-aviso"
        titulo="Aviso no WhatsApp para quem não atendeu"
        descricao={
          avisoAtivo
            ? 'Ligado: quem não atende, está ocupado ou cai na caixa postal recebe uma mensagem curta avisando da tentativa. No máximo uma a cada 72 horas por contato, e cada aviso é uma mensagem paga.'
            : 'Desligado: nenhuma mensagem sai depois de uma ligação não atendida. Os avisos que já estão na fila continuam até serem enviados ou cancelados.'
        }
        ligado={avisoAtivo}
        podeEditar={podeEditar && !mudar.isPending}
        aoMudar={(v) => mudar.mutate({ aviso_ativo: v })}
      />
    </div>
  );
}
