'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CircleSlash,
  Compass,
  CornerDownRight,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  Target,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BarraTermica, ChipTemperatura } from '@/components/temperatura';

import { ErroDaAgenda } from './consultas';
import { ErroDaAgendaNaTela } from './estados';
import { buscarRotaDoDia, chaveDaRota, pedirRota } from './rota-consultas';
import {
  acumuladoDeCarro,
  agruparExclusoes,
  distanciaCurta,
  duracaoCurta,
  FRASE_DO_MOTIVO,
  linkDaParada,
  linkDoTrajeto,
  linkDoWaze,
  paradasNoMesmoPonto,
  rotuloDaPrecisao,
  type ParadaDaRota,
  type RotaDoDia,
} from './rota-tipos';
import { horaEmNatal, rotuloDiaPorExtenso, type Dia } from './tipos';

/**
 * A rota da tarde (RF-ROT-03 e RF-ROT-05), pensada para o celular parado no carro.
 *
 * Três coisas que esta tela se recusa a fazer:
 *
 * 1. **Não inventa ordem.** A sequência vem do OSRM, que roda na máquina
 *    dedicada sobre o mapa de ruas do RN. Enquanto ele não responde, a tela diz
 *    que está esperando — e, se o worker não bate ponto há mais de 10 minutos,
 *    diz que a máquina está desligada, com o horário da última batida. Nunca
 *    aparece uma lista "aproximada" no lugar.
 *
 * 2. **Não confunde centroide com porta.** Toda parada carrega a precisão da
 *    coordenada e o raio da incerteza, e o link de navegação busca pelo NOME do
 *    parceiro, não pela coordenada. O que o CRM sabe é em que bairro fica; quem
 *    sabe o número da porta é o Google Maps, na hora.
 *
 * 3. **Não esconde quem ficou de fora.** Suprimido, ficha apagada, sem
 *    coordenada e precisão incerta aparecem embaixo, com o motivo. Sumir em
 *    silêncio é como se perde a confiança de quem usa a ferramenta na rua.
 */
export function TelaRota({ usuarioId, dia, hoje }: { usuarioId: string; dia: Dia; hoje: Dia }) {
  const clienteDeConsultas = useQueryClient();

  const consulta = useQuery({
    queryKey: chaveDaRota(usuarioId, dia),
    queryFn: () => buscarRotaDoDia(dia),
    // Enquanto o pedido está na fila, a tela olha de novo a cada 2 s: quem
    // responde é um worker noutra máquina, e não há evento vindo dali.
    refetchInterval: (consulta) =>
      consulta.state.data?.plano?.status === 'enfileirada' ? 2_000 : false,
  });

  const rota = consulta.data;

  const pedido = useMutation({
    mutationFn: () => pedirRota(dia),
    onSuccess: (resultado) => {
      if (!resultado.enfileirado) {
        toast.warning(resultado.frase);
        return;
      }
      toast.success(
        `Pedido na fila: ${resultado.alvos_elegiveis} visita(s) para ordenar. O cálculo é na máquina de casa.`,
      );
      void clienteDeConsultas.invalidateQueries({ queryKey: ['rota'] });
    },
    onError: () => toast.error('Não deu para pedir a rota. Confira a conexão e tente de novo.'),
  });

  const montar = useCallback(() => pedido.mutate(), [pedido]);

  if (consulta.isPending) {
    return <EsqueletoDaRota />;
  }

  if (consulta.error || !rota) {
    const erro = consulta.error;
    return (
      <ErroDaAgendaNaTela
        causa={erro instanceof ErroDaAgenda ? erro.message : 'A busca da rota falhou.'}
        podeTentar={!(erro instanceof ErroDaAgenda) || erro.podeTentarDeNovo}
        aoTentar={() => void consulta.refetch()}
      />
    );
  }

  const elegiveis = rota.alvos.filter((a) => a.elegivel);
  const exclusoes = agruparExclusoes(rota.alvos);
  const paradas = rota.paradas;
  const status = rota.plano?.status ?? null;

  return (
    <div className="flex flex-col gap-6">
      <CabecalhoDaRota
        rota={rota}
        dia={dia}
        hoje={hoje}
        elegiveis={elegiveis.length}
        pedindo={pedido.isPending}
        aoMontar={montar}
      />

      {status === 'enfileirada' ? <NaFila rota={rota} /> : null}
      {status === 'falhou' ? <Falhou rota={rota} /> : null}

      {paradas.length > 0 ? (
        <ListaDeParadas paradas={paradas} />
      ) : status === 'pronta' ? (
        <p className="rounded-lg border border-hairline p-4 text-sm text-muted-foreground">
          A rota foi calculada e ficou sem parada nenhuma: no momento do cálculo, nenhuma das
          visitas do dia ainda podia entrar.
        </p>
      ) : null}

      {exclusoes.length > 0 ? <ForaDaRota exclusoes={exclusoes} /> : null}

      <AindaNaoLigado rota={rota} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cabeçalho: o resumo e o único botão que importa
// ---------------------------------------------------------------------------

function CabecalhoDaRota({
  rota,
  dia,
  hoje,
  elegiveis,
  pedindo,
  aoMontar,
}: {
  rota: RotaDoDia;
  dia: Dia;
  hoje: Dia;
  elegiveis: number;
  pedindo: boolean;
  aoMontar: () => void;
}) {
  const plano = rota.plano;
  const pronta = plano?.status === 'pronta' && rota.paradas.length > 0;
  const trajeto = pronta ? linkDoTrajeto(rota.paradas) : null;
  const origemConfirmada = rota.config?.origem?.confirmada === true;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-hairline p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold tracking-tight">
            <Route className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Rota da tarde
          </h2>
          <p className="text-sm text-muted-foreground first-letter:uppercase">
            {rotuloDiaPorExtenso(dia)}
            {dia === hoje ? ' · hoje' : ''}
          </p>
        </div>

        <Button
          size="lg"
          className="toque h-11 md:h-9"
          onClick={aoMontar}
          disabled={pedindo || elegiveis === 0}
        >
          <RefreshCw className={cn(pedindo && 'animate-spin')} aria-hidden="true" />
          {plano ? 'Refazer a rota' : 'Montar a rota'}
        </Button>
      </div>

      {pronta && plano ? (
        <>
          <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <Medida rotulo="paradas" valor={String(rota.paradas.length)} />
            <Medida rotulo="de carro" valor={duracaoCurta(plano.total_segundos ?? 0)} />
            <Medida rotulo="no total" valor={distanciaCurta(plano.total_metros ?? 0)} />
          </dl>

          {trajeto ? (
            <Button asChild size="lg" className="toque h-12 w-full md:h-10 md:w-auto">
              <a href={trajeto.url} target="_blank" rel="noopener noreferrer">
                <Navigation aria-hidden="true" />
                Abrir o trajeto no Google Maps
              </a>
            </Button>
          ) : null}

          <p className="text-xs leading-relaxed text-muted-foreground">
            O trajeto começa de onde você estiver: o link não manda ponto de partida, o Maps usa a
            posição do aparelho. Os botões buscam cada parceiro pelo NOME — a coordenada que o CRM
            tem é o centro do bairro, e serve para ordenar a tarde, não para chegar na porta.
            {trajeto && trajeto.incluidas < rota.paradas.length
              ? ` As ${rota.paradas.length - trajeto.incluidas} última(s) parada(s) não cabem num link só — cada uma tem o botão dela na lista.`
              : ''}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {elegiveis === 0
            ? 'Nenhuma visita deste dia tem coordenada boa o bastante para entrar numa rota.'
            : `${elegiveis} visita(s) do dia podem entrar na rota. O tempo entre elas é calculado pelo OSRM, com o mapa de ruas do RN.`}
        </p>
      )}

      {!origemConfirmada ? (
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Target className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {/* Uma frase, um filho: num `p` com `display:flex`, cada trecho de texto vira
              um item de flex e a frase se quebra em colunas no celular. */}
          <span>
            O primeiro trecho parte de{' '}
            <span className="text-foreground">
              {rota.config?.origem?.rotulo ?? 'um ponto padrão'}
            </span>
            , que ninguém confirmou. Só o primeiro tempo depende disso; a ordem das paradas, não.
          </span>
        </p>
      ) : null}
    </section>
  );
}

function Medida({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dd className="numerico text-2xl font-medium tracking-tight">{valor}</dd>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estados do cálculo
// ---------------------------------------------------------------------------

function NaFila({ rota }: { rota: RotaDoDia }) {
  const dePe = rota.motor.de_pe;
  return (
    <section
      className={cn(
        'flex items-start gap-3 rounded-lg border border-hairline p-4',
        !dePe && 'border-dashed',
      )}
    >
      <Compass
        className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground', dePe && 'animate-pulse')}
        aria-hidden="true"
      />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">
          {dePe ? 'Calculando a ordem…' : 'O pedido está na fila, e ninguém está calculando.'}
        </p>
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          {dePe ? (
            <>
              Quem calcula é o OSRM na máquina de casa, com o mapa de ruas do Rio Grande do Norte.
              Costuma levar poucos segundos.
            </>
          ) : (
            <>
              O worker de rotas não bate ponto{' '}
              {rota.motor.ultimo_pulso ? (
                <>
                  desde <span className="numerico">{horaEmNatal(rota.motor.ultimo_pulso)}</span>
                </>
              ) : (
                'nunca'
              )}
              . O pedido fica guardado na fila e sai assim que a máquina voltar — nada se perde, e
              nada vai ser inventado enquanto isso.
            </>
          )}
        </p>
      </div>
    </section>
  );
}

function Falhou({ rota }: { rota: RotaDoDia }) {
  return (
    <section className="flex items-start gap-3 rounded-lg border border-hairline border-dashed p-4">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">A rota não saiu.</p>
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          {rota.plano?.motivo_da_falha ?? 'Sem motivo registrado.'}
        </p>
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          Enquanto isso, a aba <span className="text-foreground">Dia</span> lista as mesmas visitas
          agrupadas por bairro — sem tempo de carro, mas sem chute nenhum.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// As paradas
// ---------------------------------------------------------------------------

function ListaDeParadas({ paradas }: { paradas: readonly ParadaDaRota[] }) {
  const acumulado = acumuladoDeCarro(paradas);
  const mesmoPonto = paradasNoMesmoPonto(paradas);

  return (
    <ol className="flex flex-col">
      {paradas.map((parada, indice) => (
        <li key={parada.task_id} className="flex flex-col">
          <Trecho
            segundos={parada.segundos_do_anterior}
            metros={parada.metros_do_anterior}
            primeiro={indice === 0}
            mesmoPonto={mesmoPonto.has(parada.task_id) && indice > 0}
          />
          <CartaoDaParada
            parada={parada}
            acumuladoSegundos={acumulado[indice] ?? 0}
            mesmoPonto={mesmoPonto.has(parada.task_id)}
          />
        </li>
      ))}
    </ol>
  );
}

function Trecho({
  segundos,
  metros,
  primeiro,
  mesmoPonto,
}: {
  segundos: number;
  metros: number;
  primeiro: boolean;
  mesmoPonto: boolean;
}) {
  return (
    <p className="flex items-center gap-2 py-2 pl-1 text-xs text-muted-foreground">
      <CornerDownRight className="size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {primeiro ? 'Da origem: ' : ''}
        <span className="numerico text-foreground">{duracaoCurta(segundos)}</span>
        {' · '}
        <span className="numerico">{distanciaCurta(metros)}</span>
        {mesmoPonto && segundos === 0
          ? ' — mesma coordenada de bairro da parada anterior: o tempo real entre as duas portas não é zero.'
          : ''}
      </span>
    </p>
  );
}

function CartaoDaParada({
  parada,
  acumuladoSegundos,
  mesmoPonto,
}: {
  parada: ParadaDaRota;
  acumuladoSegundos: number;
  mesmoPonto: boolean;
}) {
  const alvo = {
    organizacao: parada.organizacao,
    bairro: parada.bairro,
    cidade: parada.cidade,
    endereco: parada.endereco,
  };

  return (
    <article
      className={cn(
        'relative flex flex-col gap-2.5 rounded-lg border border-hairline p-4 pl-5',
        !parada.ainda_vale && 'opacity-60',
      )}
    >
      <BarraTermica temperatura={parada.temperatura} posicao="absoluta" semRotulo />

      <div className="flex items-start gap-3">
        <span
          className="numerico flex size-8 shrink-0 items-center justify-center rounded-full border border-hairline text-sm font-medium"
          aria-hidden="true"
        >
          {parada.posicao}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* O nome é link para a ficha, e no celular ele precisa ser ALVO, não só
              texto: `min-h-11` põe os 44 px de dedo em volta de uma linha de 24 px,
              sem mudar o desenho (o `-my-1.5` devolve o espaço ao layout). Quem lê
              isto no carro, parado, acerta de primeira. */}
          <Link
            href={`/parceiros/${parada.organization_id}`}
            className="-my-1.5 flex min-h-11 items-center truncate py-1.5 font-medium tracking-tight outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-0 md:py-0"
          >
            <span className="sr-only">Parada {parada.posicao}: </span>
            <span className="truncate">{parada.organizacao}</span>
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {[parada.bairro, parada.cidade].filter(Boolean).join(' · ') || 'Sem bairro na ficha'}
            {' · '}
            <span className="numerico">{duracaoCurta(acumuladoSegundos)}</span> de carro desde o
            começo
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <ChipTemperatura temperatura={parada.temperatura} />
        {parada.etapa ? (
          <span className="truncate text-xs text-muted-foreground">{parada.etapa}</span>
        ) : null}
        <Badge variant="pilula" className="font-normal">
          {rotuloDaPrecisao(parada.precisao, parada.raio_m)}
        </Badge>
      </div>

      {mesmoPonto ? (
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Outra parada desta rota tem a mesma coordenada de bairro. O tempo entre as duas aparece
          como zero e não é: são portas diferentes dentro do mesmo bairro.
        </p>
      ) : null}

      {!parada.ainda_vale ? (
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <CircleSlash className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Esta ficha saiu depois que a rota foi calculada (supressão ou exclusão). Não vá.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="lg" className="toque h-11 md:h-9">
          <a href={linkDaParada(alvo)} target="_blank" rel="noopener noreferrer">
            <MapPin aria-hidden="true" />
            Google Maps
          </a>
        </Button>
        <Button asChild variant="outline" size="lg" className="toque h-11 md:h-9">
          <a href={linkDoWaze(alvo)} target="_blank" rel="noopener noreferrer">
            <Navigation aria-hidden="true" />
            Waze
          </a>
        </Button>
        <Button asChild variant="outline" size="lg" className="toque h-11 md:h-9">
          <Link href={`/registrar?org=${parada.organization_id}`}>Registrar a visita</Link>
        </Button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Quem ficou de fora
// ---------------------------------------------------------------------------

function ForaDaRota({ exclusoes }: { exclusoes: ReturnType<typeof agruparExclusoes> }) {
  const total = exclusoes.reduce((soma, g) => soma + g.itens.length, 0);
  return (
    <section className="flex flex-col gap-3 border-t border-hairline pt-4">
      <h2 className="text-xs font-medium text-muted-foreground">
        Fora da rota <span className="numerico">({total})</span>
      </h2>
      <ul className="flex flex-col gap-3">
        {exclusoes.map((grupo) => (
          <li key={grupo.motivo} className="flex flex-col gap-1">
            <p className="text-sm">
              {grupo.itens.map((a) => a.organizacao).join(', ')}
              {grupo.itens[0]?.bairro ? (
                <span className="text-muted-foreground"> · {grupo.itens[0].bairro}</span>
              ) : null}
            </p>
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              {FRASE_DO_MOTIVO[grupo.motivo]}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// O que ainda não está ligado
// ---------------------------------------------------------------------------

function AindaNaoLigado({ rota }: { rota: RotaDoDia }) {
  return (
    <section className="flex flex-col gap-2 border-t border-hairline pt-4">
      <h2 className="text-xs font-medium text-muted-foreground">O que ainda não está ligado</h2>
      <ul className="flex max-w-prose flex-col gap-1.5 text-xs leading-relaxed text-muted-foreground">
        <li>
          <span className="text-foreground">Hora marcada dentro da rota</span> (o &quot;TSP com
          janelas&quot; do RF-ROT-03): a ordem é só por tempo de carro. O horário que aparece na
          tarefa de visita é prazo calculado, não hora combinada com o fornecedor — a Agenda explica
          isso na aba Dia.
        </li>
        <li>
          <span className="text-foreground">Tempo dentro de cada visita</span>: os minutos mostrados
          são de deslocamento, e só. Ninguém mediu quanto dura uma conversa, então a tela não soma
          um número que não existe.
        </li>
        <li>
          <span className="text-foreground">Cheguei, com check-in por GPS</span> (RF-ROT-06) e{' '}
          <span className="text-foreground">bloco no Google Calendar</span> (RF-ROT-04): fora do
          MVP. O resultado da visita continua sendo registrado pelo caminho de sempre.
        </li>
        <li>
          <span className="text-foreground">Endereço com rua e número</span>: nenhuma das 100 fichas
          da base tem logradouro. Quando tiver, a mesma máquina geocodifica com precisão de porta e
          estas frases mudam sozinhas.
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">{rota.atribuicao}</p>
    </section>
  );
}

function EsqueletoDaRota() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="h-28 animate-pulse rounded-lg border border-hairline" />
      <div className="h-32 animate-pulse rounded-lg border border-hairline" />
      <div className="h-32 animate-pulse rounded-lg border border-hairline" />
    </div>
  );
}
