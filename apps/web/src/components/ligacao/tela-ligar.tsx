'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { Skeleton } from '@/components/ui/skeleton';

import { type ContextoDaLigacao } from './chamada-contexto';
import { ErroDaChamada } from './chamada-estados';
import { ErroDaLigacao, lerLote } from './chamada-rpc';
import { TelaChamada } from './tela-chamada';

/**
 * A rota `/ligar/[id]`: a tela onde se liga.
 *
 * Ela é a segunda metade do módulo, e a separação das duas é o desenho, não uma
 * divisão de arquivos: **montar** o lote acontece uma vez por turno, em `/ligar`, e é
 * onde se pensa; **ligar** acontece o dia inteiro, aqui, e é onde não se pensa mais em
 * quem é o próximo. Misturar os dois é o que faz o operador escolher para quem ligar,
 * e escolher é justamente o que o R13 §3.1 proíbe.
 *
 * O que esta camada faz é só encontrar o lote e sair da frente: quem trabalha é
 * `TelaChamada`.
 */
export function TelaLigar({
  contexto,
  quemLiga,
  loteId,
}: {
  contexto: ContextoDaLigacao;
  /** Nome de quem está ligando: entra no `[eu]` da fala de abertura. */
  quemLiga: string;
  loteId: string;
}) {
  const router = useRouter();
  const doServidor = contexto.lotes.find((l) => l.id === loteId);

  // O lote recém-montado pode não estar no que o servidor entregou (a montagem
  // acontece em `/ligar`, no cliente), então ele é lido por id. Quando já veio do
  // servidor, aquilo vale como dado inicial e a leitura só atualiza os contadores.
  const lote = useQuery({
    queryKey: ['ligacao', 'lote', loteId],
    queryFn: () => lerLote(loteId),
    initialData: doServidor,
    staleTime: 10_000,
    retry: false,
  });

  if (lote.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <span className="sr-only">Abrindo o lote.</span>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (lote.isError || !lote.data) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <ErroDaChamada
          frase={
            lote.error instanceof ErroDaLigacao
              ? lote.error.message
              : 'Este lote não existe mais, ou é de outra pessoa.'
          }
          aoTentarDeNovo={null}
          aoVoltar={() => router.push('/ligar')}
        />
      </div>
    );
  }

  const aberto = lote.data;

  return (
    <TelaChamada
      lote={aberto}
      roteiroConhecido={
        contexto.roteiros.find((r) => r.id === aberto.roteiroId) ?? contexto.roteiros[0] ?? null
      }
      contexto={contexto}
      quemLiga={quemLiga}
      aoSair={() => router.push('/ligar')}
      aoMontarOutro={() => router.push('/ligar?montar=1')}
    />
  );
}
