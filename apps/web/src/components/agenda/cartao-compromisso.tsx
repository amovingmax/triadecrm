'use client';

import Link from 'next/link';
import {
  CalendarClock,
  Check,
  CircleCheck,
  CirclePause,
  CircleX,
  MapPin,
  PhoneOff,
  SquarePen,
  Trophy,
  UserX,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DiasSemContato } from '@/components/temperatura';

import {
  faixaDeHoras,
  linkDoMapa,
  recortesDoCompromisso,
  type Compromisso,
  type PedidoDeDesfecho,
  type TomDoResultado,
} from './tipos';
import { type DesfechoCatalogo } from '@/components/registro/tipos';

import { AcoesDaReuniao } from './acoes-da-reuniao';
import { ExcluirCompromisso } from './excluir-compromisso';

/**
 * Um compromisso na lista do dia.
 *
 * A leitura, em ordem: hora (só quando é hora combinada de verdade — ver o cabeçalho
 * de `tipos.ts`), nome do parceiro ligando para a ficha, categoria e bairro, etapa do
 * funil, e a fileira de ações.
 *
 * SEM TEMPERATURA DESDE 29/09/2026: nem a barra na borda, nem o chip. Pelo Tríade
 * Design System a escala térmica mora nos relatórios e na ficha, e na agenda ela
 * era a terceira cor de uma linha que só precisa dizer quem, quando e o que fazer.
 * A linha virou uma superfície dentro do cartão do bloco, como as do Meu dia.
 *
 * As ações são as do catálogo, recortadas por `recortesDoCompromisso`. Nenhuma delas
 * escreve etapa por conta própria: todas abrem a folha de desfecho, que grava pela
 * `public.registrar_contato`. O botão do mapa é um link de busca do Google Maps, e o
 * cartão DIZ quando a busca é pelo nome porque não há endereço cadastrado.
 *
 * Alvo de toque: 44px no celular (`h-11`), 32px no desktop, como no resto do produto.
 *
 * Depois do registro, o cartão diz COMO foi, em cor: verde deu certo (com troféu
 * quando o parceiro autorizou), vermelho não deu, âmbar mudou de data. É a única
 * cor da linha, e é a que responde à pergunta de quem olha a semana que passou.
 *
 * `somenteLeitura` é a agenda de outra pessoa (visão da equipe, admin e gestor):
 * sem desfecho — o resultado é de quem estava lá. Com `podeMexerNaReuniao`, quem
 * acompanha essa pessoa ainda remarca e cancela a reunião: é assim que o gestor
 * desfaz o engano de ter marcado no horário errado para a SDR.
 *
 * EXCLUIR (07/10/2026): o compromisso sem reunião — a visita, a tarefa de marcar —
 * ganhou saída, no fim da fileira (`excluir-compromisso.tsx`). A reunião de
 * verdade continua saindo pelo "Cancelar" dela. Vale a mesma régua de quem
 * mexe na reunião: a própria pessoa, e quem a acompanha.
 */
export function CartaoCompromisso({
  compromisso,
  catalogo,
  aoPedirDesfecho,
  aoMudarReuniao,
  somenteLeitura = false,
  podeMexerNaReuniao = !somenteLeitura,
}: {
  compromisso: Compromisso;
  catalogo: readonly DesfechoCatalogo[];
  aoPedirDesfecho: (pedido: PedidoDeDesfecho) => void;
  aoMudarReuniao?: () => void;
  somenteLeitura?: boolean;
  podeMexerNaReuniao?: boolean;
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
        'flex items-start gap-3 rounded-lg bg-muted/45 px-4 py-3',
        compromisso.concluido && !compromisso.resultado && 'opacity-70',
      )}
    >

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
            className="truncate text-[15px] font-medium tracking-tight outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
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
          {/* O rótulo é o TIPO da tarefa (reunião ou visita), não a natureza: depois
              do registro a etapa muda e "a marcar" viraria uma contradição em cima de
              um compromisso que já aconteceu. Quem diz a natureza é o cabeçalho do
              bloco, que não muda com a etapa. */}
          <Badge variant="pilula" className="font-normal">
            {ehVisita ? 'Visita' : 'Reunião'}
          </Badge>
          {/* A reunião que é a nova data de outra (`reunioes.remarcada_de`). Âmbar
              pelo mesmo motivo do resultado "Reagendada": mudou de data. */}
          {compromisso.reagendada && !compromisso.concluido ? (
            <Badge variant="pilula" className="gap-1 bg-morno-fundo font-normal text-morno-texto">
              <CalendarClock className="size-3" aria-hidden="true" />
              Reagendada
            </Badge>
          ) : null}
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
          compromisso.resultado ? (
            <FaixaDoResultado resultado={compromisso.resultado} />
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="size-3.5 shrink-0" aria-hidden="true" />
              Já registrado.
            </p>
          )
        ) : somenteLeitura ? (
          <div className="flex flex-wrap items-center gap-2 pt-1 empty:hidden">
            {ehVisita ? (
              <Button asChild variant="outline" size="lg" className="toque h-11 md:h-9">
                <a href={linkDoMapa(compromisso)} target="_blank" rel="noopener noreferrer">
                  <MapPin aria-hidden="true" />
                  Google Maps
                </a>
              </Button>
            ) : null}
            {podeMexerNaReuniao ? (
              <AcoesDaReuniao compromisso={compromisso} aoMudar={aoMudarReuniao ?? (() => {})} />
            ) : null}
            {podeMexerNaReuniao && !compromisso.reuniaoId ? (
              <ExcluirCompromisso compromisso={compromisso} aoMudar={aoMudarReuniao ?? (() => {})} />
            ) : null}
          </div>
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

            {/* Quem não tem reunião por trás sai por aqui. No fim da fileira e em
                tinta fraca: é a saída do engano, não uma das respostas do dia. */}
            {!compromisso.reuniaoId ? (
              <ExcluirCompromisso compromisso={compromisso} aoMudar={aoMudarReuniao ?? (() => {})} />
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * As cores de cada resultado. Verde é "deu certo" (o verde de "publicado" da escala
 * do produto), coral é "não deu" (o do destrutivo: recusou, agora não, não
 * apareceu), âmbar é "mudou de data".
 */
const ESTILO_DO_TOM: Record<
  TomDoResultado,
  { caixa: string; Icone: React.ComponentType<{ className?: string }> }
> = {
  sucesso: { caixa: 'bg-cliente-fundo text-cliente-texto', Icone: CircleCheck },
  ausente: { caixa: 'bg-destructive/10 text-destructive-texto', Icone: UserX },
  perda: { caixa: 'bg-destructive/10 text-destructive-texto', Icone: CircleX },
  adiado: { caixa: 'bg-destructive/10 text-destructive-texto', Icone: CirclePause },
  reagendado: { caixa: 'bg-morno-fundo text-morno-texto', Icone: CalendarClock },
  neutro: { caixa: 'bg-card text-foreground', Icone: Check },
};

/** O que aconteceu, grande o bastante para ler de relance na lista do dia. */
function FaixaDoResultado({ resultado }: { resultado: NonNullable<Compromisso['resultado']> }) {
  const { caixa, Icone } = ESTILO_DO_TOM[resultado.tom];
  return (
    <div role="status" className={cn('mt-1 flex items-start gap-2.5 rounded-lg px-3 py-2.5', caixa)}>
      <Icone className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          {resultado.rotulo}
          {resultado.trofeu ? <Trophy className="size-4 shrink-0" aria-hidden="true" /> : null}
        </p>
        {resultado.desfecho !== resultado.rotulo ? (
          <p className="text-xs opacity-90">{resultado.desfecho}</p>
        ) : null}
      </div>
    </div>
  );
}
