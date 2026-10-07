'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, ChevronLeft, RotateCw, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  carregarExcluidos,
  CHAVE_DOS_EXCLUIDOS,
  recadoDaExclusao,
  restaurarParceiro,
  rotuloDoCampoDuplicado,
  type ParceiroExcluido,
} from '@/components/exclusao/acoes';

import { formatarData, formatarLocal } from './formatos';

/**
 * A lista de parceiros excluídos (07/10/2026).
 *
 * Uma linha por ficha, da exclusão mais recente para a mais antiga, com o que
 * alguém precisa para decidir se restaura: quem é, quem excluiu, quando e POR
 * QUÊ — o motivo é obrigatório na exclusão justamente para aparecer aqui.
 *
 * Sem telefone: a lista serve para reconhecer e restaurar, não para contatar.
 * Quem precisa do número restaura e abre a ficha.
 *
 * Restaurar devolve a ficha, o negócio na etapa em que estava e a conversa. O
 * que foi cancelado na exclusão (tarefas, reuniões) não volta, e a tela diz
 * isso em cima, uma vez, em vez de em cada linha.
 */
export function TelaExcluidos() {
  const cliente = useQueryClient();
  const router = useRouter();
  const [busca, setBusca] = useState('');
  const [restaurando, setRestaurando] = useState<string | null>(null);

  const consulta = useQuery({
    queryKey: [...CHAVE_DOS_EXCLUIDOS, busca.trim()],
    queryFn: () => carregarExcluidos(busca),
    placeholderData: (anterior) => anterior,
  });

  async function restaurar(parceiro: ParceiroExcluido) {
    setRestaurando(parceiro.id);
    const r = await restaurarParceiro(parceiro.id);
    setRestaurando(null);

    if (r.ok) {
      toast.success(`${r.nome} voltou para a base.`, {
        action: {
          label: 'Abrir a ficha',
          onClick: () => router.push(`/parceiros/${parceiro.id}`),
        },
      });
      void cliente.invalidateQueries({ queryKey: CHAVE_DOS_EXCLUIDOS });
      return;
    }
    if (r.motivo === 'duplicado' && r.outraFichaId) {
      const outra = r.outraFichaId;
      // A recusa que mais acontece: o parceiro foi cadastrado de novo enquanto
      // estava fora. A saída é a outra ficha, e o aviso leva até ela.
      toast.error('Já existe outra ficha no lugar desta.', {
        description: `${r.outraFichaNome ?? 'Outra ficha'} tem ${rotuloDoCampoDuplicado(r.campo)}. Use essa, ou exclua-a antes de restaurar esta.`,
        action: {
          label: 'Abrir a outra',
          onClick: () => router.push(`/parceiros/${outra}`),
        },
        duration: 12_000,
      });
      return;
    }
    toast.error('Não deu para restaurar.', { description: recadoDaExclusao(r.motivo) });
  }

  const linhas = consulta.data ?? [];
  const buscando = busca.trim() !== '';

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4">
      <header className="flex flex-col gap-3">
        <Link
          href="/parceiros"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Prospectados
        </Link>
        <div>
          <h1 className="font-heading text-[32px] leading-tight font-normal tracking-[-0.02em]">
            Excluídos
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Quem saiu da base. Restaurar devolve a ficha, o negócio na etapa em que estava e a
            conversa; as tarefas e reuniões canceladas na exclusão não voltam.
          </p>
        </div>

        <div className="relative max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar pelo nome"
            aria-label="Procurar entre os parceiros excluídos"
            className="h-11 pl-8 md:h-9"
          />
          {busca ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Limpar a busca"
              onClick={() => setBusca('')}
              className="absolute top-1/2 right-1 -translate-y-1/2"
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </header>

      {consulta.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Carregando os parceiros excluídos.</span>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[84px] w-full rounded-xl" />
          ))}
        </div>
      ) : consulta.isError ? (
        <Aviso
          icone={<RotateCw className="size-5" aria-hidden="true" />}
          titulo="A lista não carregou."
          texto="Não deu para falar com o servidor."
        >
          <Button
            variant="outline"
            onClick={() => void consulta.refetch()}
            className="toque h-11 md:h-9"
          >
            <RotateCw aria-hidden="true" />
            Tentar de novo
          </Button>
        </Aviso>
      ) : linhas.length === 0 ? (
        buscando ? (
          <Aviso
            icone={<Search className="size-5" aria-hidden="true" />}
            titulo="Ninguém com esse nome entre os excluídos."
            texto="A busca aqui é só pelo nome. Se o parceiro não foi excluído, ele está em Prospectados."
          />
        ) : (
          <Aviso
            icone={<Trash2 className="size-5" aria-hidden="true" />}
            titulo="Nenhum parceiro excluído."
            texto='Para excluir um, abra a ficha dele e use o menu "⋯" no alto. Ele vem para cá, e daqui dá para trazer de volta.'
          />
        )
      ) : (
        <ul className="sombra-base flex flex-col divide-y divide-hairline overflow-hidden rounded-xl bg-card">
          {linhas.map((parceiro) => (
            <li key={parceiro.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
              <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
                <p className="truncate text-[15px] font-medium tracking-tight">{parceiro.nome}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[parceiro.categoria, formatarLocal(parceiro.bairro, parceiro.cidade)]
                    .filter(Boolean)
                    .join(' · ') || 'Sem categoria e sem cidade na ficha'}
                </p>
                <p className="text-sm break-words">
                  {parceiro.motivo ? (
                    <>“{parceiro.motivo}”</>
                  ) : (
                    <span className="text-muted-foreground">Sem motivo registrado.</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Excluído em <span className="numerico">{formatarData(parceiro.excluidoEm)}</span>
                  {parceiro.excluidoPor ? ` por ${parceiro.excluidoPor}` : ''}
                </p>
              </div>
              <Button
                variant="outline"
                className="toque h-11 shrink-0 md:h-9"
                disabled={restaurando !== null}
                onClick={() => void restaurar(parceiro)}
              >
                <ArchiveRestore aria-hidden="true" />
                {restaurando === parceiro.id ? 'Restaurando...' : 'Restaurar'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Aviso({
  icone,
  titulo,
  texto,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  texto: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sombra-base flex flex-col items-center gap-3 rounded-xl bg-card px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
        {icone}
      </span>
      <div className="space-y-1">
        <p className="font-heading font-medium">{titulo}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{texto}</p>
      </div>
      {children}
    </div>
  );
}
