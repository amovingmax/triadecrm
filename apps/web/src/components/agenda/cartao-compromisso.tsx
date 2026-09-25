'use client';

import Link from 'next/link';
import { Check, MapPin, PhoneOff, SquarePen } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BarraTermica, ChipTemperatura, DiasSemContato } from '@/components/temperatura';

import {
  faixaDeHoras,
  linkDoMapa,
  recortesDoCompromisso,
  type Compromisso,
  type PedidoDeDesfecho,
} from './tipos';
import { type DesfechoCatalogo } from '@/components/registro/tipos';

import { AcoesDaReuniao } from './acoes-da-reuniao';

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
  aoMudarReuniao,
}: {
  compromisso: Compromisso;
  catalogo: readonly DesfechoCatalogo[];
  aoPedirDesfecho: (pedido: PedidoDeDesfecho) => void;
  aoMudarReuniao?: () => void;
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

      {/* `10h20–11h00` quando a reunião tem fim — é a primeira vez que o produto
          tem fim para mostrar. A `meeting` antiga, sem objeto, continua com só a
          hora: fim não se inventa para a linha ficar bonita. */}
      {temHora ? (
        <p className={cn('shrink-0 pt-0.5', compromisso.fim ? 'w-24' : 'w-12')}>
          <span className="numerico text-sm font-medium">{faixaDeHoras(compromisso)}</span>
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

            {/* As ações da reunião de verdade (ADR-15): entrar na sala, remarcar,
                cancelar, confirmar o horário enquanto a rampa está ligada, mais o
                selo de quem marcou e o aviso de e-mail que não saiu.

                Elas existem só quando há linha em `public.reunioes`. A `meeting`
                antiga — a que o `lig_reuniao_marcada` ainda cria sem objeto — não
                tem sala, nem fim, nem estado: dar a ela um botão "entrar na sala"
                seria a tela prometendo o que o banco não tem. */}
            <AcoesDaReuniao compromisso={compromisso} aoMudar={aoMudarReuniao ?? (() => {})} />
          </div>
        )}
      </div>
    </li>
  );
}
