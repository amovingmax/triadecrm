'use client';

import { useQuery } from '@tanstack/react-query';
import { PhoneMissed } from 'lucide-react';

import { EMPRESA } from '@/lib/empresa';
import { cn } from '@/lib/utils';

import { SEM_PERDIDAS, textoDoSelo, type LigacaoPerdida, type Perdidas } from './logica';
import { lerPerdidas } from './rpc';

/**
 * A ligação perdida na lista de Conversas (03/11/2026).
 *
 * O cliente ligou e ninguém atendeu: a conversa sobe para o topo da lista com o selo
 * "Ligação perdida", até alguém do time ligar de volta ou escrever. Quem decide o que é
 * perdida sem retorno é o banco (`wa_ligacoes_perdidas`); aqui só se lê e se desenha.
 *
 * A chave mora debaixo de `CHAVE_CONVERSAS` (`['conversas', 'lista']`): o eco do banco
 * invalida a lista quando sai uma mensagem, e o prefixo leva junto as perdidas. É isso
 * que tira o selo na hora em que alguém responde. A ligação nova chega pelo Realtime do
 * provedor da ligação (`provedor.tsx`).
 */
export const CHAVE_DAS_PERDIDAS = ['conversas', 'lista', 'ligacoes-perdidas'] as const;

export function useLigacoesPerdidas(): Perdidas {
  const ligada = EMPRESA.modulos.ligacaoWhatsapp;
  const { data } = useQuery({
    queryKey: CHAVE_DAS_PERDIDAS,
    queryFn: lerPerdidas,
    enabled: ligada,
    staleTime: 30_000,
    // A reserva do Realtime e do eco: a marca não pode ficar parada se os dois falharem.
    refetchInterval: 60_000,
  });
  return ligada && data ? data : SEM_PERDIDAS;
}

/** A faixa coral na borda da linha, no lugar da menta da "Nova": é a que pede alguém agora. */
export function FaixaDePerdida() {
  return <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-destructive" />;
}

/** O selo na linha da lista: em coral, porque é cliente esperando retorno. */
export function SeloDeLigacaoPerdida({
  perdida,
  className,
}: {
  perdida: LigacaoPerdida;
  className?: string;
}) {
  const texto = textoDoSelo(perdida);
  return (
    <span
      title={`${texto}. Sai quando alguém ligar de volta ou escrever ao cliente.`}
      className={cn(
        'inline-flex h-4 shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-1.5 text-[10px] font-semibold text-destructive-texto',
        className,
      )}
    >
      <PhoneMissed className="size-2.5" aria-hidden="true" />
      {texto}
    </span>
  );
}
