'use client';

import { useQuery } from '@tanstack/react-query';

import { EMPRESA } from '@/lib/empresa';

import { iniciosDoCalendly } from './agenda-do-link';
import { comOrigem, rotuloDoConflito } from './efeito-no-calendly';
import { horaEmNatal } from './tipos';

/**
 * Com o quê o horário pedido bateu, no "Novo compromisso" (11/11/2026). O banco
 * devolve tipo, título e início (`visita_marcar`, que a KOMUNE também usa e não
 * muda); na Imova a lista diz também "(marcado pelo Calendly)" no que o cliente
 * marcou pelo link, como no protótipo aprovado, e lembra a saída.
 */
export function ListaDeConflitos({
  conflitos,
  donoId,
}: {
  conflitos: readonly { tipo: 'reuniao' | 'visita'; titulo: string; inicio: string }[];
  donoId: string;
}) {
  const instantes = conflitos.map((c) => c.inicio).sort();
  const origem = useQuery({
    queryKey: ['agenda', 'conflitos-do-calendly', donoId, instantes],
    queryFn: () =>
      iniciosDoCalendly(donoId, instantes[0] ?? '', instantes[instantes.length - 1] ?? ''),
    enabled: EMPRESA.modulos.calendly && instantes.length > 0,
    staleTime: 30_000,
  });
  if (conflitos.length === 0) return null;
  const lista = comOrigem(conflitos, origem.data ?? []);

  return (
    <>
      <ul className="mt-1 list-disc pl-4">
        {lista.map((c) => (
          <li key={`${c.inicio}-${c.titulo}`}>
            <span className="numerico">{horaEmNatal(c.inicio)}</span> · {rotuloDoConflito(c)}
          </li>
        ))}
      </ul>
      {EMPRESA.modulos.calendly ? (
        <p className="mt-1">
          Duas pessoas não ficam no mesmo horário: escolha outro, ou cancele o compromisso que está
          lá.
        </p>
      ) : null}
    </>
  );
}
