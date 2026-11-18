import { CalendarDays, ChevronDown, ChevronUp, KeyRound, Minus, UserPlus } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { NumerosDoPainel, PeriodoDoPainel } from './dados';
import { progressoDaMeta, rotulosDosDias, variacao, type Variacao } from './formatos';

/**
 * Os três números do topo (17/11/2026): leads novos, visitas marcadas e negócios
 * fechados, cada um com a comparação ao período anterior. Os dois primeiros têm
 * a série dos dias; o terceiro, o último negócio e a meta do mês.
 */
export function NumerosDoTopo({
  numeros,
  periodo,
  hoje,
}: {
  numeros: NumerosDoPainel;
  periodo: PeriodoDoPainel;
  hoje: string;
}) {
  const dias = rotulosDosDias(numeros.dias, hoje);
  const meta = progressoDaMeta(numeros.fechados.noMes, numeros.fechados.metaMes);
  const ultimo = numeros.fechados.ultimo;
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
      <Cartao
        icone={<UserPlus className="size-4.5" />}
        tomDoIcone="marca"
        rotulo="Leads novos"
        rotuloCurto="Leads"
        valor={numeros.leads.agora}
        variacao={variacao(numeros.leads.agora, numeros.leads.antes, periodo)}
      >
        <Serie valores={numeros.leads.serie} rotulos={dias} cor="marca" />
      </Cartao>
      <Cartao
        icone={<CalendarDays className="size-4.5" />}
        tomDoIcone="petroleo"
        rotulo="Visitas marcadas"
        rotuloCurto="Visitas"
        valor={numeros.visitas.agora}
        extra={
          numeros.visitas.pelaIa > 0 ? (
            <Pilula tom="igual">{numeros.visitas.pelaIa} pela IA</Pilula>
          ) : null
        }
        variacao={variacao(numeros.visitas.agora, numeros.visitas.antes, periodo)}
      >
        <Serie valores={numeros.visitas.serie} rotulos={dias} cor="petroleo" />
      </Cartao>
      <Cartao
        icone={<KeyRound className="size-4.5" />}
        tomDoIcone="petroleo"
        rotulo="Negócios fechados"
        rotuloCurto="Fechados"
        valor={numeros.fechados.agora}
        variacao={variacao(numeros.fechados.agora, numeros.fechados.antes, periodo)}
      >
        <div className="mt-auto hidden pt-3 sm:block">
          {ultimo ? (
            <p className="truncate text-[12.5px] text-muted-foreground">
              Último:{' '}
              <span className="font-medium text-foreground">{ultimo.nome ?? 'cliente'}</span>
              {ultimo.por ? ` · por ${ultimo.por}` : ''}
            </p>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Nenhum negócio fechado ainda.</p>
          )}
          <div className="mt-2.5">
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role={meta === null ? undefined : 'progressbar'}
              aria-valuenow={meta ?? undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Negócios fechados no mês, em relação à meta"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${meta ?? 0}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
              <span>
                <span className="numerico font-semibold text-foreground">
                  {numeros.fechados.noMes}
                </span>{' '}
                no mês
              </span>
              <span>
                {numeros.fechados.metaMes ? (
                  <>
                    meta: <span className="numerico">{numeros.fechados.metaMes}</span>
                  </>
                ) : (
                  'sem meta do mês'
                )}
              </span>
            </div>
          </div>
        </div>
        <p className="mt-1 text-[11.5px] text-muted-foreground sm:hidden">
          <span className="numerico">{numeros.fechados.noMes}</span> no mês
        </p>
      </Cartao>
    </div>
  );
}

function Cartao({
  icone,
  tomDoIcone,
  rotulo,
  rotuloCurto,
  valor,
  variacao: v,
  extra,
  children,
}: {
  icone: React.ReactNode;
  tomDoIcone: 'marca' | 'petroleo';
  rotulo: string;
  rotuloCurto: string;
  valor: number;
  variacao: Variacao;
  extra?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="sombra-base flex min-w-0 flex-col rounded-xl border border-border/60 bg-card p-3 sm:px-5 sm:pt-4.5 sm:pb-3.5">
      <div className="flex items-center gap-2.5 text-[12.5px] font-medium text-muted-foreground sm:text-sm">
        <span
          aria-hidden="true"
          className={cn(
            'hidden size-8 items-center justify-center rounded-[10px] sm:flex',
            tomDoIcone === 'marca'
              ? 'bg-menta-fundo text-menta-texto'
              : 'bg-primary/12 text-primary',
          )}
        >
          {icone}
        </span>
        <span className="truncate sm:hidden">{rotuloCurto}</span>
        <span className="hidden truncate sm:inline">{rotulo}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 sm:mt-3">
        <span className="numerico font-heading text-[28px] leading-none font-semibold tracking-[-0.02em] sm:text-[38px]">
          {valor}
        </span>
        <span className="hidden sm:inline-flex">
          <Pilula tom={v.tom}>{v.texto}</Pilula>
        </span>
        {extra ? <span className="hidden sm:inline-flex">{extra}</span> : null}
      </div>
      <span className="mt-1.5 sm:hidden">
        <Pilula tom={v.tom}>
          <span className="numerico">{v.curta}</span>
          <span className="sr-only"> ({v.texto})</span>
        </Pilula>
      </span>
      {children}
    </div>
  );
}

function Pilula({ tom, children }: { tom: Variacao['tom']; children: React.ReactNode }) {
  const Icone = tom === 'sobe' ? ChevronUp : tom === 'desce' ? ChevronDown : Minus;
  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-0.5 rounded-full px-2 text-xs font-semibold',
        tom === 'sobe' && 'bg-cliente-fundo text-cliente-texto',
        tom === 'desce' && 'bg-quente-fundo text-quente-texto',
        tom === 'igual' && 'bg-muted text-muted-foreground',
      )}
    >
      {tom === 'igual' ? null : <Icone className="size-3.5 shrink-0" aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A série dos dias, em linha com área: o último ponto (hoje) em destaque. */
function Serie({
  valores,
  rotulos,
  cor,
}: {
  valores: readonly number[];
  rotulos: readonly string[];
  cor: 'marca' | 'petroleo';
}) {
  if (valores.length < 2) return null;
  const maximo = Math.max(1, ...valores);
  const passo = 300 / (valores.length - 1);
  const pontos = valores.map((v, i) => [i * passo, 40 - (v / maximo) * 34] as const);
  const linha = pontos
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const area = `${linha} L300 46 L0 46Z`;
  const ultimo = pontos.at(-1) ?? [300, 40];
  const id = `serie-${cor}`;
  const mostrarRotulos = rotulos.length <= 7;
  return (
    <div
      className={cn(
        'mt-auto hidden pt-3 sm:block',
        cor === 'marca' ? 'text-menta' : 'text-primary',
      )}
    >
      <svg
        viewBox="0 0 300 46"
        preserveAspectRatio="none"
        className="block h-11 w-full overflow-visible"
        role="img"
        aria-label={`Por dia: ${valores.join(', ')}`}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${id})`} />
        <path
          d={linha}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={ultimo[0]} cy={ultimo[1]} r="3.5" fill="currentColor" />
      </svg>
      {mostrarRotulos ? (
        <div className="mt-0.5 flex justify-between text-[10.5px] text-muted-foreground">
          {rotulos.map((r, i) => (
            <span key={`${r}-${i}`}>{r}</span>
          ))}
        </div>
      ) : (
        <div className="mt-0.5 flex justify-between text-[10.5px] text-muted-foreground">
          <span>{rotulos[0]}</span>
          <span>hoje</span>
        </div>
      )}
    </div>
  );
}
