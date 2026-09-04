'use client';

/**
 * O andamento da fila de um lote, em quatro números (R13 §3.1 e §7.7).
 *
 * ---------------------------------------------------------------------------
 * Por que estes quatro, e nesta ordem
 * ---------------------------------------------------------------------------
 * `Faltam · Feitos · Atenderam · Reuniões` é o funil da ligação inteiro em uma linha,
 * e cada número responde a uma pergunta diferente:
 *
 *  * **Faltam** — quanto trabalho sobrou. É o único que a pessoa olha durante o turno,
 *    e é o que faz ela fazer mais uma.
 *  * **Feitos** — quantos já foram tabulados. Sem ele, "faltam 7" não diz se o lote é
 *    pequeno ou se o dia foi bom.
 *  * **Atenderam** — quantos viraram conversa (`call_attempts.resultado =
 *    atendida_humano`). É a taxa que muda quando se muda o HORÁRIO da ligação.
 *  * **Reuniões** — o desfecho `lig_reuniao_marcada`. É a taxa que muda quando se muda
 *    o ROTEIRO. Separar as duas é o que permite descobrir qual das duas coisas
 *    consertar.
 *
 * Todos em IBM Plex Mono (`numerico`): números empilhados em quatro colunas só
 * comparam de relance se alinharem na vertical, e é assim que dois lotes lado a lado
 * viram uma comparação em vez de uma leitura.
 */
import { cn } from '@/lib/utils';

export type NumerosDaFila = {
  total: number;
  faltam: number;
  feitos: number;
  atenderam: number;
  reunioes: number;
  /** Meta de ligações do lote (R13 §8.2); `null` quando o lote não definiu uma. */
  meta: number | null;
};

/**
 * A barra: quanto do lote já foi tabulado.
 *
 * Um traço só, e não uma pilha de três: o que a pessoa precisa ver de relance é
 * quanto falta. As proporções finas (atendeu, marcou) estão nos números logo abaixo,
 * onde dá para lê-las sem comparar larguras de faixa.
 */
export function BarraDaFila({ feitos, total }: { feitos: number; total: number }) {
  const porcento = total > 0 ? Math.round((feitos / total) * 100) : 0;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={feitos}
      aria-valuetext={`${feitos} de ${total} contatos tabulados`}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full rounded-full bg-foreground/70 transition-[width] duration-300"
        style={{ width: `${porcento}%` }}
      />
    </div>
  );
}

function Numero({
  valor,
  rotulo,
  nota,
  destaque = false,
}: {
  valor: number;
  rotulo: string;
  nota?: string;
  destaque?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p
        className={cn(
          'numerico font-heading text-2xl leading-none font-semibold',
          destaque ? 'text-foreground' : 'text-foreground/80',
        )}
      >
        {valor}
      </p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{rotulo}</p>
      {nota ? <p className="truncate text-xs text-muted-foreground/80">{nota}</p> : null}
    </div>
  );
}

export function NumerosDoLote({
  numeros,
  className,
}: {
  numeros: NumerosDaFila;
  className?: string;
}) {
  const taxaDeAtendimento =
    numeros.feitos > 0 ? Math.round((numeros.atenderam / numeros.feitos) * 100) : null;

  return (
    // Duas colunas no celular: "Atenderam" e "Reuniões" não cabem em quatro colunas
    // dentro de 390px sem espremer o número, que é o que a pessoa veio ler.
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-4', className)}>
      <Numero
        valor={numeros.faltam}
        rotulo="Faltam"
        destaque
        nota={numeros.meta !== null ? `meta ${numeros.meta}` : undefined}
      />
      <Numero valor={numeros.feitos} rotulo="Feitos" nota={`de ${numeros.total}`} />
      <Numero
        valor={numeros.atenderam}
        rotulo="Atenderam"
        nota={taxaDeAtendimento !== null ? `${taxaDeAtendimento}% dos feitos` : undefined}
      />
      <Numero valor={numeros.reunioes} rotulo="Reuniões" />
    </div>
  );
}
