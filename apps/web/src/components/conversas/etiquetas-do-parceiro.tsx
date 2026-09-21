'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { EscolhaMultipla } from '@/components/envios/escolha-multipla';

/**
 * As etiquetas do parceiro, no topo da conversa (Fase 3). Qualquer pessoa que
 * escreve põe e tira; quem cria etiqueta nova é gestor, em Ajustes → Atendimento.
 */
type Etiqueta = { id: number; name: string; color: string | null };

export function EtiquetasDoParceiro({
  organizacaoId,
  podeEditar,
}: {
  organizacaoId: string;
  podeEditar: boolean;
}) {
  const clientes = useQueryClient();
  const chave = ['conversas', 'etiquetas', organizacaoId];
  const dados = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const supabase = createClient();
      const [todas, minhas] = await Promise.all([
        supabase.from('tags').select('id, name, color').order('name'),
        supabase.from('organization_tags').select('tag_id').eq('organization_id', organizacaoId),
      ]);
      return {
        todas: (todas.data ?? []) as Etiqueta[],
        doParceiro: (minhas.data ?? []).map((m) => m.tag_id as number),
      };
    },
    staleTime: 60_000,
  });

  const mudar = useMutation({
    mutationFn: async (novas: number[]) => {
      const supabase = createClient();
      const atuais = dados.data?.doParceiro ?? [];
      const tirar = atuais.filter((id) => !novas.includes(id));
      const por = novas.filter((id) => !atuais.includes(id));
      if (tirar.length > 0) {
        const { error } = await supabase
          .from('organization_tags')
          .delete()
          .eq('organization_id', organizacaoId)
          .in('tag_id', tirar);
        if (error) throw new Error(error.message);
      }
      if (por.length > 0) {
        const { error } = await supabase
          .from('organization_tags')
          .insert(por.map((tag_id) => ({ organization_id: organizacaoId, tag_id })));
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => void clientes.invalidateQueries({ queryKey: chave }),
    onError: () => toast.error('Não deu para mudar as etiquetas.'),
  });

  const todas = dados.data?.todas ?? [];
  const doParceiro = dados.data?.doParceiro ?? [];
  const marcadas = todas.filter((t) => doParceiro.includes(t.id));

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {marcadas.map((t) => (
        <span
          key={t.id}
          className="inline-flex h-5 items-center gap-1 rounded-full border border-hairline px-2 text-[11px]"
        >
          <span className="size-2 rounded-full" style={{ background: t.color ?? '#64748b' }} aria-hidden="true" />
          {t.name}
        </span>
      ))}
      {podeEditar && todas.length > 0 ? (
        <EscolhaMultipla
          rotulo="Etiquetas"
          compacto
          opcoes={todas.map((t) => ({ valor: t.id, rotulo: t.name }))}
          valor={doParceiro}
          aoMudar={(v) => mudar.mutate(v)}
        />
      ) : null}
    </span>
  );
}
