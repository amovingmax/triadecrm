'use client';

import Link from 'next/link';
import { Check, MapPin, PhoneOff, SquarePen } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BarraTermica, ChipTemperatura, DiasSemContato } from '@/components/temperatura';

import {
  horaEmNatal,
  linkDoMapa,
  recortesDoCompromisso,
  type Compromisso,
  type PedidoDeDesfecho,
} from './tipos';
import { type DesfechoCatalogo } from '@/components/registro/tipos';

/**
 * Um compromisso na lista do dia.
 *
 * A leitura, em ordem: barra térmica na borda, hora (só quando é hora combinada de
 * verdade — ver o cabeçalho de `tipos.ts`), nome do parceiro ligando para a ficha,
 * categoria e bairro, etapa do funil, e a fileira de ações.
 *
 * As ações são as do catálogo, recortadas por `recortesDoCompromisso`. Nenhuma delas
 * escreve etapa por conta própria: todas abrem a folha de desfecho, que grava pela
 * `public.registrar_contato`. O botão do mapa é um link de busca do Google Maps, e o
 * cartão DIZ quando a busca é pelo nome porque não há endereço cadastrado.
 *
 * Alvo de toque: 44px no celular (`h-11`), 32px no desktop, como no resto do produto.
 */
export function CartaoCompromisso({
  compromisso,
  catalogo,
  aoPedirDesfecho,
}: {
  compromisso: Compromisso;
  catalogo: readonly DesfechoCatalogo[];
  aoPedirDesfecho: (pedido: PedidoDeDesfecho) => void;
}) {
  const { realizada, ausente, reagendar } = recortesDoCompromisso(catalogo, compromisso);
  const ehVisita = compromisso.tipo === 'visita';
  const temHora = compromisso.natureza === 'marcado';

  function pedir(titulo: string, descricao: string, opcoes: DesfechoCatalogo[]) {
    aoPedirDesfecho({ compromisso, titulo, descricao, opcoes });
  }

  return (
    <li
      className={cn(
        'relative flex items-start gap-3 border-b border-hairline py-3 pl-4',
        compromisso.concluido && 'opacity-70',
      )}
    >
      <BarraTermica
        temperatura={compromisso.temperatura}
        needsAttention={compromisso.precisaAtencao}
        posicao="absoluta"
        semRotulo
      />

      {temHora ? (
        <p className="w-12 shrink-0 pt-0.5">
          <span className="numerico text-sm font-medium">{horaEmNatal(compromisso.quando)}</span>
        </p>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/parceiros/${compromisso.organizationId}`}
            className="truncate font-medium tracking-tight outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {compromisso.organizacao}
          </Link>
          <DiasSemContato dias={compromisso.diasSemContato} className="shrink-0" curto />
        </div>

        <p className="truncate text-xs text-muted-foreground">
          {[compromisso.categoria, compromisso.bairro, compromisso.cidade]
            .filter(Boolean)
            .join(' · ') || 'Sem categoria e sem bairro na base'}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          <ChipTemperatura
            temperatura={compromisso.temperatura}
            esfriando={compromisso.precisaAtencao}
          />
          {/* O rótulo é o TIPO da tarefa (reunião ou visita), não a natureza: depois
              do registro a etapa muda e "a marcar" viraria uma contradição em cima de
              um compromisso que já aconteceu. Quem diz a natureza é o cabeçalho do
              bloco, que não muda com a etapa. */}
          <Badge variant="pilula" className="font-normal">
            {ehVisita ? 'Visita' : 'Reunião'}
          </Badge>
          {compromisso.etapa ? (
            <span className="truncate text-xs text-muted-foreground">{compromisso.etapa}</span>
          ) : null}
        </div>

        {compromisso.naoContatar ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <PhoneOff className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Pediu para não ser contatado. Só dá para registrar o que não devolve este parceiro para
            a fila.
          </p>
        ) : null}

        {compromisso.concluido ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check className="size-3.5 shrink-0" aria-hidden="true" />
            Já registrado.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {compromisso.natureza === 'a_marcar' ? (
              <Button asChild size="lg" className="toque h-11 md:h-9">
                <Link href={`/registrar?org=${compromisso.organizationId}`}>
                  <SquarePen aria-hidden="true" />
                  Registrar contato
                </Link>
              </Button>
            ) : (
              <>
                {realizada.length > 0 ? (
                  <Button
                    size="lg"
                    className="toque h-11 md:h-9"
                    onClick={() =>
                      pedir(
                        ehVisita ? 'Como foi a visita?' : 'Como foi a reunião?',
                        `${compromisso.organizacao} · ${ehVisita ? 'visita' : 'reunião'}`,
                        realizada,
                      )
                    }
                  >
                    {ehVisita ? 'Registrar a visita' : 'Realizada'}
                  </Button>
                ) : null}

                {ausente.length > 0 ? (
                  <Button
                    variant="outline"
                    size="lg"
                    className="toque h-11 md:h-9"
                    onClick={() =>
                      pedir(
                        ehVisita ? 'Não estava?' : 'Não compareceu?',
                        `${compromisso.organizacao} · ${ehVisita ? 'visita' : 'reunião'}`,
                        ausente,
                      )
                    }
                  >
                    {ehVisita ? 'Não estava' : 'Não compareceu'}
                  </Button>
                ) : null}

                {reagendar.length > 0 ? (
                  <Button
                    variant="outline"
                    size="lg"
                    className="toque h-11 md:h-9"
                    onClick={() =>
                      pedir(
                        'Reagendar',
                        `${compromisso.organizacao} · nova data e formato`,
                        reagendar,
                      )
                    }
                  >
                    Reagendar
                  </Button>
                ) : null}
              </>
            )}

            {ehVisita ? (
              <Button asChild variant="outline" size="lg" className="toque h-11 md:h-9">
                <a href={linkDoMapa(compromisso)} target="_blank" rel="noopener noreferrer">
                  <MapPin aria-hidden="true" />
                  Google Maps
                </a>
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}
