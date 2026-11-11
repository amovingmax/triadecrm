'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  CalendarCheck,
  CalendarClock,
  Check,
  CircleCheck,
  CirclePause,
  CircleX,
  ExternalLink,
  MapPin,
  MapPinOff,
  PhoneOff,
  SquarePen,
  TriangleAlert,
  Trophy,
  UserX,
  Video,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DiasSemContato } from '@/components/temperatura';
import { VOCABULARIO } from '@/lib/vocabulario';

import {
  faixaDeHoras,
  linkDoMapa,
  ondeDoCompromisso,
  recortesDoCompromisso,
  type Compromisso,
  type PedidoDeDesfecho,
  type TomDoResultado,
} from './tipos';
import { type DesfechoCatalogo } from '@/components/registro/tipos';

import { AcoesDaReuniao } from './acoes-da-reuniao';
import { DefinirImovel } from './definir-imovel';
import { FALTA_O_IMOVEL, linhaDoImovel, type ImovelDaVisita } from './imovel-da-visita';
import { ROTULO_DA_RESPOSTA } from './lembrete-de-visita';
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
 *
 * O IMÓVEL DA VISITA (11/11/2026, só na Imova): a linha de onde vira "IM0003 ·
 * título do anúncio", que abre o anúncio, com o endereço embaixo, e o Maps busca
 * por esse endereço. A visita sem imóvel ganha o selo "Falta o imóvel" e a ação
 * "Definir imóvel", com a mesma régua de quem mexe. A reunião fica com o `local`.
 */
export function CartaoCompromisso({
  compromisso,
  catalogo,
  aoPedirDesfecho,
  aoMudarReuniao,
  somenteLeitura = false,
  podeMexerNaReuniao = !somenteLeitura,
  destacado = false,
}: {
  compromisso: Compromisso;
  catalogo: readonly DesfechoCatalogo[];
  aoPedirDesfecho: (pedido: PedidoDeDesfecho) => void;
  aoMudarReuniao?: () => void;
  somenteLeitura?: boolean;
  podeMexerNaReuniao?: boolean;
  /** Tocou no aviso deste compromisso: o cartão aparece na tela, contornado. */
  destacado?: boolean;
}) {
  const { realizada, ausente, reagendar } = recortesDoCompromisso(catalogo, compromisso);
  const ehVisita = compromisso.tipo === 'visita';
  // A visita sem hora combinada é porta a bater no dia; a do Calendly (e, na Imova,
  // a marcada no CRM com hora) tem hora, e é ela que a pessoa precisa ver no cartão.
  const temHora = compromisso.natureza === 'marcado' || (ehVisita && compromisso.horaCombinada);
  const onde = ondeDoCompromisso(compromisso);
  const linha = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (destacado) linha.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [destacado]);

  function pedir(titulo: string, descricao: string, opcoes: DesfechoCatalogo[]) {
    aoPedirDesfecho({ compromisso, titulo, descricao, opcoes });
  }

  return (
    <li
      ref={linha}
      className={cn(
        'flex items-start gap-3 rounded-lg bg-muted/45 px-4 py-3 transition-shadow duration-700',
        compromisso.concluido && !compromisso.resultado && 'opacity-70',
        destacado && 'ring-2 ring-menta',
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

        {/* Onde: a sala (pelo link) ou o endereço combinado. Na visita do Calendly,
            é o endereço que o cliente escreveu ao marcar. Na visita da Imova com
            imóvel, o código e o título do anúncio, e o endereço embaixo. */}
        {ehVisita && compromisso.imovel ? (
          <OndeDaVisita imovel={compromisso.imovel} />
        ) : onde ? (
          <p className="flex items-start gap-1.5 text-xs text-foreground/80">
            {onde.formato === 'online' ? (
              <Video className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 break-words">{onde.texto}</span>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          {/* O rótulo é o TIPO da tarefa (reunião ou visita), não a natureza: depois
              do registro a etapa muda e "a marcar" viraria uma contradição em cima de
              um compromisso que já aconteceu. Quem diz a natureza é o cabeçalho do
              bloco, que não muda com a etapa. */}
          <Badge variant="pilula" className="font-normal">
            {ehVisita ? 'Visita' : 'Reunião'}
          </Badge>
          {/* Chegou e a pessoa ainda não tocou em "Ok, vi" no aviso do topo. */}
          {compromisso.novo && !compromisso.concluido ? (
            <Badge variant="pilula" className="bg-menta font-medium text-menta-tinta">
              Novo
            </Badge>
          ) : null}
          {/* O toque do cliente no lembrete da véspera (só na Imova). Verde é o
              "deu certo" da faixa do resultado; âmbar é "mudou de data". Some
              quando o compromisso é registrado: aí quem fala é o resultado. */}
          {compromisso.respostaDoLembrete && !compromisso.concluido ? (
            <Badge
              variant="pilula"
              className={cn(
                'gap-1 font-medium',
                compromisso.respostaDoLembrete === 'confirmou'
                  ? 'bg-cliente-fundo text-cliente-texto'
                  : 'bg-morno-fundo text-morno-texto',
              )}
            >
              {compromisso.respostaDoLembrete === 'confirmou' ? (
                <CircleCheck className="size-3" aria-hidden="true" />
              ) : (
                <CalendarClock className="size-3" aria-hidden="true" />
              )}
              {ROTULO_DA_RESPOSTA[compromisso.respostaDoLembrete]}
            </Badge>
          ) : null}
          {/* A reunião que é a nova data de outra (`reunioes.remarcada_de`). Âmbar
              pelo mesmo motivo do resultado "Reagendada": mudou de data. */}
          {compromisso.reagendada && !compromisso.concluido ? (
            <Badge variant="pilula" className="gap-1 bg-morno-fundo font-normal text-morno-texto">
              <CalendarClock className="size-3" aria-hidden="true" />
              Reagendada
            </Badge>
          ) : null}
          {/* O cliente marcou sozinho, pelo link. Cinza como o "marcada pelo robô":
              é procedência, não alerta. */}
          {compromisso.peloCalendly ? (
            <Badge variant="pilula" className="gap-1 font-normal text-muted-foreground">
              <CalendarCheck className="size-3" aria-hidden="true" />
              pelo Calendly
            </Badge>
          ) : null}
          {/* O Calendly não enxerga a agenda do CRM: o horário pode já estar ocupado.
              Vermelho, porque alguém precisa resolver com o cliente. Some sozinho
              quando o outro compromisso sai (a conta é refeita a cada leitura). */}
          {compromisso.emConflito && !compromisso.concluido ? (
            <Badge
              variant="pilula"
              className="gap-1 bg-destructive/10 font-normal text-destructive-texto"
            >
              <TriangleAlert className="size-3" aria-hidden="true" />
              Horário em conflito
            </Badge>
          ) : null}
          {/* A visita da Imova sem imóvel (sem anúncio nem endereço). Vermelho como
              o conflito: alguém precisa descobrir com o cliente onde é. */}
          {compromisso.faltaImovel && !compromisso.concluido ? (
            <Badge
              variant="pilula"
              className="gap-1 bg-destructive/10 font-normal text-destructive-texto"
            >
              <MapPinOff className="size-3" aria-hidden="true" />
              {FALTA_O_IMOVEL}
            </Badge>
          ) : null}
          {compromisso.etapa ? (
            <span className="truncate text-xs text-muted-foreground">{compromisso.etapa}</span>
          ) : null}
        </div>

        {compromisso.naoContatar ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <PhoneOff className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Pediu para não ser contatado. Só dá para registrar o que não devolve este{' '}
            {VOCABULARIO.parceiro} para a fila.
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
            {compromisso.faltaImovel && podeMexerNaReuniao ? (
              <DefinirImovel
                taskId={compromisso.taskId}
                organizacao={compromisso.organizacao}
                aoMudar={aoMudarReuniao ?? (() => {})}
              />
            ) : null}
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

            {/* A visita sem imóvel ganha o imóvel aqui (só na Imova). */}
            {compromisso.faltaImovel ? (
              <DefinirImovel
                taskId={compromisso.taskId}
                organizacao={compromisso.organizacao}
                aoMudar={aoMudarReuniao ?? (() => {})}
              />
            ) : null}

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
 * Onde é a visita da Imova (`visita_imoveis`): "IM0003 · Casa com 3 quartos" — que
 * abre o anúncio no CRM — e o endereço embaixo, que é o que o botão do Maps busca.
 */
function OndeDaVisita({ imovel }: { imovel: ImovelDaVisita }) {
  const linha = linhaDoImovel(imovel);
  return (
    <div className="flex items-start gap-1.5 text-xs text-foreground/80">
      <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-0.5">
        {imovel.anuncioId ? (
          <Link
            href={`/anuncios/${imovel.anuncioId}`}
            title="Abrir o anúncio no CRM"
            className="inline-flex min-w-0 items-start gap-1 font-medium break-words text-foreground outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="min-w-0">{linha}</span>
            <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-70" aria-hidden="true" />
            <span className="sr-only">: abrir o anúncio no CRM</span>
          </Link>
        ) : (
          <span className="font-medium break-words text-foreground">{linha}</span>
        )}
        <span className="break-words">{imovel.endereco}</span>
      </div>
    </div>
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
