'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';

import { FolhaMover, type AlvoDeMovimento } from './acoes/folha-mover';
import { carregarParaMover } from './mudar-etapa-dados';
import { rotuloDaEtapa } from './etapa';
import type { EtapaQuadro } from './tipos';

/**
 * A etapa do parceiro como um botão (14/10/2026): mostra a etapa e, num clique,
 * abre a folha de mover do Funis para trocá-la. Usado em Prospectados e no
 * cabeçalho da conversa. As regras e o porquê estão em `mudar-etapa-dados.ts`.
 *
 * O negócio e as etapas são buscados no clique, e não com a lista: são 50 linhas
 * na página e a pessoa muda a etapa de uma de cada vez.
 */
export function MudarEtapa({
  organizacaoId,
  nome,
  etapa,
  aoMudar,
  className,
}: {
  organizacaoId: string;
  nome: string;
  /** O nome da etapa de agora, como a lista já sabe. */
  etapa: string | null;
  /** Depois de mover: a tela recarrega o que mostra. */
  aoMudar: () => void;
  className?: string;
}) {
  const [alvo, setAlvo] = useState<AlvoDeMovimento | null>(null);
  const [etapas, setEtapas] = useState<EtapaQuadro[]>([]);
  const [buscando, setBuscando] = useState(false);

  async function abrir() {
    setBuscando(true);
    const r = await carregarParaMover(organizacaoId, nome);
    setBuscando(false);
    if (!r.ok) {
      toast.error(
        r.motivo === 'sem_negocio'
          ? `${nome} não tem negócio em funil nenhum.`
          : 'Não deu para abrir as etapas. Tente de novo.',
      );
      return;
    }
    setEtapas(r.etapas);
    setAlvo({ cartao: r.cartao, etapaAtualId: r.etapaAtualId, etapaDestinoId: null });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void abrir()}
        disabled={buscando}
        title="Mudar a etapa do funil"
        aria-label={`Etapa de ${nome}: ${rotuloDaEtapa(etapa)}. Mudar a etapa`}
        className={cn(
          'inline-flex max-w-full shrink-0 items-center gap-1 overflow-hidden rounded-lg',
          'border border-hairline bg-muted px-2 py-0.5 text-xs font-medium whitespace-nowrap',
          'transition-colors outline-none hover:border-input hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50',
          buscando && 'opacity-60',
          !etapa && 'text-muted-foreground',
          className,
        )}
      >
        <span className="truncate">{rotuloDaEtapa(etapa)}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" />
      </button>

      <FolhaMover
        alvo={alvo}
        etapas={etapas}
        aoFechar={() => setAlvo(null)}
        aoMover={() => aoMudar()}
        aoDesencontro={() => {
          setAlvo(null);
          aoMudar();
        }}
      />
    </>
  );
}
