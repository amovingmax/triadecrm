'use client';

import Link from 'next/link';
import {
  ArrowUpRight,
  BadgeCheck,
  CalendarCheck,
  ClipboardList,
  DoorClosed,
  DoorOpen,
  Info,
  MapPin,
  Phone,
  Target,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

import {
  definicaoDaMetrica,
  metricasVisiveis,
  ressalvasDasMetricas,
  type MetricaDoDia,
} from './tipos';

/**
 * O resumo que abre a tela: quanto já foi feito hoje, contra a meta quando ela
 * existe (RF-MET-02).
 *
 * Duas escolhas que valem estar escritas:
 *
 * 1. **A barra de progresso é acromática.** A única cromia do produto é a escala
 *    térmica; uma barra verde de "meta batida" ao lado de uma linha verde de
 *    "cliente" apagaria a leitura de relance que o CRM inteiro depende. O
 *    preenchimento é a própria tinta do texto, e quem diz que a meta foi batida é o
 *    número, não a cor.
 *
 * 2. **Métrica sem meta continua aparecendo.** O banco devolve uma linha por métrica
 *    tenha ou não meta definida, e hoje a tabela `goals` está vazia: esconder as
 *    métricas sem meta deixaria a tela em branco justamente para quem mais precisa
 *    ver o que fez. Sem meta, o cartão mostra o realizado e diz "sem meta".
 *
 * 3. **Cada número carrega a própria definição.** "Portas abertas" é jargão de
 *    captação, e esta faixa é a primeira coisa que alguém vê ao entrar no CRM:
 *    quatro números que a pessoa não sabe ler não abrem o dia, atrapalham. A
 *    definição fica no pé do cartão, sempre visível, e não num `title` (que o
 *    celular não mostra) nem dentro da nota, que nasce fechada.
 */
export function ResumoDoDia({
  metricas,
  carregando,
  podeDefinirMeta,
  esperando,
  parados,
  pendentes,
}: {
  metricas: readonly MetricaDoDia[];
  carregando: boolean;
  /** Gestor e admin definem meta (é o que a RLS de `goals` permite); os demais só leem. */
  podeDefinirMeta: boolean;
  /** Quantos responderam no WhatsApp e ninguém falou (o relógio de outra pessoa). */
  esperando: number;
  /** Quantos negócios estão parados na etapa além do SLA. */
  parados: number;
  /** O total pendente de hoje — o mesmo número que o cabeçalho já mostra. */
  pendentes: number;
}) {
  if (carregando) return <EsqueletoDoResumo />;

  const visiveis = metricasVisiveis(metricas);
  const semNenhumaMeta = visiveis.every((m) => m.meta === null);
  const ressalvas = ressalvasDasMetricas(metricas);

  if (visiveis.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        O resumo do dia não veio. Recarregue a tela; se continuar, avise no grupo do time.
      </p>
    );
  }

  return (
    <section aria-label="Resumo do dia" className="flex flex-col gap-3">
      {/* OS DOIS QUE FAZEM ALGUÉM AGIR VÊM PRIMEIRO (29/09/2026).
          ---------------------------------------------------------------------
          Rafael pediu fidelidade ao protótipo, e o protótipo abre o Meu dia com
          cartões que respondem "o que está me esperando?" — não com o placar das
          metas. A diferença não é estética: "Portas batidas: 3" é o que EU fiz;
          "Esperando a gente: 9" é o que está parado por minha causa. Só o
          segundo faz alguém levantar da cadeira.

          Os dois números novos não custam consulta: eles já estão na fila que a
          tela carrega, contados por tipo de item. As metas ficam logo abaixo,
          menores — continuam existindo, e continuam linkando para Metas. */}
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <CartaoDeAtencao
          rotulo="Esperando a gente"
          apoio="Responderam e ninguém falou"
          valor={esperando}
          unidade={esperando === 1 ? 'conversa' : 'conversas'}
          alerta={esperando > 0}
          href="/conversas?aba=responderam"
        />
        <CartaoDeAtencao
          rotulo="Parados na etapa"
          apoio="Passaram do prazo do funil"
          valor={parados}
          unidade={parados === 1 ? 'negócio' : 'negócios'}
          alerta={parados > 0}
          href="/funis"
        />
        {/* O MESMO número do cabeçalho, e é de propósito: somar as métricas
            aqui daria "portas batidas + ligações + reuniões", que não é
            quantidade de nada. Um número inventado num cartão grande é pior que
            não ter o cartão. */}
        <CartaoDeAtencao
          rotulo="Pendentes hoje"
          apoio="Tarefas, reuniões e próximas ações"
          valor={pendentes}
          unidade={pendentes === 1 ? 'item' : 'itens'}
          alerta={false}
          href="/agenda"
        />
      </ul>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {visiveis.map((metrica) => (
          <CartaoDeMetrica key={metrica.metrica} metrica={metrica} />
        ))}
      </ul>

      {semNenhumaMeta ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Target className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {/* O texto inteiro num filho só: com `flex-wrap`, em 390 px o alvo ficava
              sozinho numa linha e a frase começava na linha de baixo. */}
          <span>
            Sem meta para hoje: os números acima são só o realizado.{' '}
            {podeDefinirMeta ? (
              <Link href="/metas" className="underline underline-offset-4 hover:text-foreground">
                Definir em Metas
              </Link>
            ) : (
              <span>Quem define a meta é gestor ou admin.</span>
            )}
          </span>
        </p>
      ) : null}

      {/* Chamava-se "De onde saem estes números" e listava só as exceções: quem
          abria procurando o que é uma porta aberta não achava, porque a explicação
          nunca esteve aqui. Agora a definição está no cartão e esta nota volta a se
          chamar pelo que ela de fato guarda — a aproximação e o que ainda não é
          medido. */}
      {ressalvas.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 sm:min-h-8">
            <Info className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="underline underline-offset-4">Ressalvas destes números</span>
          </summary>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-8 sm:pl-5">
            {ressalvas.map((frase) => (
              <li key={frase}>{frase}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/**
 * Um desenho por número. A faixa era quatro rótulos cinzas com quatro números do
 * mesmo tamanho: nada dizia, de relance, qual deles era porta batida e qual era
 * reunião. O ícone faz isso sem gastar linha.
 */
const ICONE_DA_METRICA: Record<string, LucideIcon> = {
  doors_knocked: DoorOpen,
  doors_opened: DoorClosed,
  calls_made: Phone,
  meetings_booked: CalendarCheck,
  meetings_done: CalendarCheck,
  visits_done: MapPin,
  new_targets: UserPlus,
  pre_registrations: ClipboardList,
  published: BadgeCheck,
};

function CartaoDeMetrica({ metrica }: { metrica: MetricaDoDia }) {
  const realizado = metrica.realizado ?? 0;
  const meta = metrica.meta;
  const percentual = meta && meta > 0 ? Math.round((realizado / meta) * 100) : null;
  const preenchido = percentual === null ? 0 : Math.min(100, percentual);
  const bateu = percentual !== null && percentual >= 100;
  const definicao = definicaoDaMetrica(metrica.metrica);
  const Icone = ICONE_DA_METRICA[metrica.metrica];

  return (
    <li
      // A DEFINIÇÃO VIROU TÍTULO (23/09/2026). "Contato registrado. Um por alvo, por
      // dia." embaixo de cada número somava quatro parágrafos cinzas na primeira
      // dobra da tela para explicar quatro palavras que o time usa todo dia. Quem
      // ainda não sabe passa o mouse — ou abre "Ressalvas destes números", logo
      // abaixo, que é onde a explicação longa mora de verdade.
      title={definicao ? `${metrica.rotulo}: ${definicao}` : metrica.rotulo}
      className="sombra-base flex flex-col gap-2 rounded-xl bg-card p-5"
    >
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        {/* O ícone num DISCO, como todo ícone do sistema. Solto, ele flutuava ao
            lado do rótulo; no disco vira um objeto do cartão. */}
        {Icone ? (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
            <Icone className="size-3.5" aria-hidden="true" strokeWidth={1.75} />
          </span>
        ) : null}
        <span className="truncate">{metrica.rotulo}</span>
      </p>

      <p className="flex items-baseline gap-1.5">
        {/* 40px, que é o degrau de FIGURA do sistema: o número é a razão de o
            cartão existir, e em 30px ele dividia peso com o rótulo. A meta ao
            lado fica na tinta esmaecida, como os decimais da referência. */}
        <span
          className={cn(
            'numerico text-[40px] leading-none font-medium tracking-[-0.03em]',
            realizado === 0 && 'text-muted-foreground',
          )}
        >
          {realizado}
        </span>
        {meta !== null ? (
          <span className="text-sm text-muted-foreground">
            de <span className="numerico">{meta}</span>
          </span>
        ) : null}
      </p>

      {meta !== null ? (
        <div className="flex items-center gap-2">
          <span
            role="progressbar"
            aria-valuenow={preenchido}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${metrica.rotulo}: ${realizado} de ${meta}`}
            className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <span
              aria-hidden="true"
              className={cn('block h-full rounded-full', bateu ? 'bg-primary' : 'bg-foreground')}
              style={{ width: `${preenchido}%` }}
            />
          </span>
          <span
            className={cn(
              'numerico shrink-0 text-[0.6875rem]',
              bateu ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {percentual}%
          </span>
        </div>
      ) : null}

      {/* A definição só existe como `title` do cartão: ver a nota acima. */}
      <span className="sr-only">{definicao}</span>
    </li>
  );
}

/**
 * Um dos três cartões do topo: o número que faz alguém agir.
 *
 * `alerta` NÃO pinta o cartão inteiro de vermelho — pinta só o número e a
 * pastilha. Um cartão inteiro em brasa é um alarme, e alarme que aparece todo
 * dia (sempre há alguém esperando) é alarme que ninguém escuta. O que muda é a
 * TINTA DO NÚMERO, que é o que a pessoa varre.
 */
function CartaoDeAtencao({
  rotulo,
  apoio,
  valor,
  unidade,
  alerta,
  href,
}: {
  rotulo: string;
  apoio: string;
  valor: number;
  unidade: string;
  alerta: boolean;
  href: string;
}) {
  return (
    <li className="sombra-base flex flex-col gap-2 rounded-xl bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading text-[17px] leading-tight font-medium tracking-[-0.01em]">
            {rotulo}
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">{apoio}</p>
        </div>
        {/* O disco de "abrir" no canto, que é a ação do cartão no sistema. */}
        <Link
          href={href}
          aria-label={`Abrir ${rotulo}`}
          className="toque flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted-hover"
        >
          <ArrowUpRight className="size-4" aria-hidden="true" strokeWidth={1.75} />
        </Link>
      </div>
      <p className="flex items-baseline gap-2">
        <span
          className={cn(
            'numerico text-[40px] leading-none font-medium tracking-[-0.03em]',
            valor === 0 ? 'text-muted-foreground' : alerta ? 'text-destructive-texto' : '',
          )}
        >
          {valor}
        </span>
        <span className="text-sm text-muted-foreground">{unidade}</span>
      </p>
    </li>
  );
}

/** Espera no formato final: quatro cartões da mesma altura, sem pulso. */
function EsqueletoDoResumo() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando o resumo do dia.</span>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="sombra-base flex flex-col gap-2 rounded-xl bg-card p-5">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-9 w-14" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}
