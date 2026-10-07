'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { HREF_EXCLUIDOS } from '@/lib/navegacao';
import { Button } from '@/components/ui/button';
import {
  recadoDaExclusao,
  restaurarParceiro,
  rotuloDoCampoDuplicado,
} from '@/components/exclusao/acoes';

import { formatarData } from './formatos';

/** O que a página lê de uma ficha que saiu da base (`ficha.ts`, `carregarFichaExcluida`). */
export type FichaExcluidaLida = {
  id: string;
  nome: string;
  excluidaEm: string;
  excluidaPor: string | null;
  motivo: string | null;
};

/**
 * A ficha de um parceiro excluído, no lugar do "Erro 404" (07/10/2026).
 *
 * Oito lugares do CRM apontam para a ficha, e um link colado no grupo do time
 * dura mais do que a ficha. Quem abria o link de um parceiro excluído lia
 * "página não encontrada — o endereço pode estar errado", que é falso: o
 * endereço está certo, a ficha é que saiu. Para quem pode restaurar (admin e
 * gestor), a tela diz o que houve — quem excluiu, quando e por quê — e põe o
 * botão de volta ali.
 *
 * Quem não é da gestão continua vendo o 404: a política de leitura não lhe
 * mostra ficha excluída, e dizer "existe, mas foi excluída" seria contar o que o
 * banco decidiu não contar.
 */
export function FichaExcluida({ ficha }: { ficha: FichaExcluidaLida }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  async function restaurar() {
    setOcupado(true);
    const r = await restaurarParceiro(ficha.id);
    setOcupado(false);
    if (r.ok) {
      toast.success(`${r.nome} voltou para a base.`);
      router.refresh();
      return;
    }
    if (r.motivo === 'duplicado' && r.outraFichaId) {
      const outra = r.outraFichaId;
      toast.error('Já existe outra ficha no lugar desta.', {
        description: `${r.outraFichaNome ?? 'Outra ficha'} tem ${rotuloDoCampoDuplicado(r.campo)}.`,
        action: { label: 'Abrir a outra', onClick: () => router.push(`/parceiros/${outra}`) },
        duration: 12_000,
      });
      return;
    }
    toast.error('Não deu para restaurar.', { description: recadoDaExclusao(r.motivo) });
  }

  return (
    <div className="sombra-base mx-auto flex w-full max-w-xl flex-col items-center gap-4 rounded-xl bg-card px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
        <Trash2 className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1.5">
        <h1 className="font-heading text-xl font-medium tracking-tight">
          {ficha.nome} foi excluído da base
        </h1>
        <p className="text-sm text-muted-foreground">
          Em <span className="numerico">{formatarData(ficha.excluidaEm)}</span>
          {ficha.excluidaPor ? `, por ${ficha.excluidaPor}` : ''}.
        </p>
        {ficha.motivo ? <p className="text-sm break-words">“{ficha.motivo}”</p> : null}
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          O histórico está guardado. Restaurar devolve a ficha, o negócio na etapa em que estava e
          a conversa; as tarefas e reuniões canceladas na exclusão não voltam.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => void restaurar()} disabled={ocupado} className="toque h-11 md:h-9">
          <ArchiveRestore aria-hidden="true" />
          {ocupado ? 'Restaurando...' : 'Restaurar'}
        </Button>
        <Button asChild variant="outline" className="toque h-11 md:h-9">
          <Link href={HREF_EXCLUIDOS}>Ver os excluídos</Link>
        </Button>
      </div>
    </div>
  );
}
