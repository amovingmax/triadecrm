'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { excluirTarefa, recadoDaExclusao } from '@/components/exclusao/acoes';
import { DialogoExcluir } from '@/components/exclusao/dialogo-excluir';

/**
 * Excluir uma tarefa aberta, direto dos "Próximos passos" da ficha (07/10/2026).
 *
 * A lista era só leitura: a tarefa criada por engano — ou a que perdeu o sentido
 * porque o parceiro já resolveu por outro caminho — ficava ali até alguém
 * achá-la na Agenda. Agora sai daqui, com a mesma função da Agenda
 * (`public.tarefa_excluir`): a tarefa fica cancelada, a próxima ação do negócio
 * passa para a seguinte e a exclusão vai para a auditoria.
 *
 * Só TAREFA tem este botão. A reunião sai pelo "Cancelar" da Agenda, que pede o
 * motivo e avisa o time.
 *
 * É a ilha de cliente de um painel que é todo servidor: por isso, depois de
 * excluir, quem atualiza a lista é `router.refresh()`.
 */
export function ExcluirPasso({ tarefaId, titulo }: { tarefaId: string; titulo: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function excluir(motivo: string) {
    setOcupado(true);
    const r = await excluirTarefa(tarefaId, motivo);
    setOcupado(false);
    if (!r.ok) {
      toast.error('Não foi excluída.', { description: recadoDaExclusao(r.motivo) });
      return;
    }
    setAberto(false);
    toast.success(r.eraReuniao ? 'Reunião cancelada.' : 'Tarefa excluída.');
    router.refresh();
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="toque size-11 shrink-0 text-muted-foreground hover:text-destructive-texto md:size-8"
        aria-label={`Excluir a tarefa: ${titulo}`}
        title="Excluir esta tarefa"
        onClick={() => setAberto(true)}
      >
        <Trash2 aria-hidden="true" />
      </Button>

      <DialogoExcluir
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        titulo="Excluir esta tarefa?"
        descricao={
          <>
            <p>“{titulo}” sai dos próximos passos, da Agenda e do Meu dia de quem ia fazê-la.</p>
            <p>
              O funil não muda. Se era a próxima ação do negócio, a seguinte assume o lugar; sem
              outra, o negócio fica sem próxima ação.
            </p>
          </>
        }
        motivo="opcional"
        exemploDeMotivo="Ex.: já resolvido pelo WhatsApp"
        rotuloConfirmar="Excluir tarefa"
        ocupado={ocupado}
        aoConfirmar={(motivo) => void excluir(motivo)}
      />
    </>
  );
}
