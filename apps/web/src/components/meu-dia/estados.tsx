'use client';

import Link from 'next/link';
import { CheckCheck, PhoneOutgoing, RotateCw, SquareKanban } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Os três jeitos de a fila não ter linhas para mostrar, mais a espera.
 *
 * "Não tem nada para hoje" e "não deu para carregar" são situações opostas e a saída
 * de cada uma é diferente: a primeira é uma boa notícia e pede a próxima ação útil; a
 * segunda é uma falha e pede o que tentar. Nenhuma delas é uma tela em branco.
 */

/** Espera no formato final: a mesma altura de linha e a mesma barra à esquerda. */
export function EsqueletoDaFila() {
  const larguras = ['w-44', 'w-56', 'w-36', 'w-48', 'w-40', 'w-52'];

  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando a fila do dia.</span>
      <Skeleton className="mb-3 h-4 w-24" />
      <ul>
        {Array.from({ length: 6 }, (_, i) => (
          <li
            key={i}
            className="relative flex min-h-[76px] items-start gap-3 border-b border-hairline py-3 pr-3 pl-4 last:border-b-0"
          >
            <Skeleton className="absolute top-3 left-0 h-12 w-[3px] rounded-none" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className={`h-4 ${larguras[i % larguras.length]}`} />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-3 w-10" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A fila zerou. É a única tela do produto em que não ter nada é o resultado certo,
 * então ela comemora e já oferece o passo seguinte — em vez de um vazio triste que
 * deixa a pessoa sem saber se quebrou.
 *
 * Com uma ressalva que hoje é a regra, não a exceção: os 100 negócios da lista-semente
 * entraram sem responsável ("a triagem distribui depois"), e a fila só enxerga o que
 * tem dono. Comemorar aí seria mentir por omissão — quando há negócio aberto sem
 * responsável, a tela diz o número e manda para o funil, que é onde se assume.
 */
export function FilaVazia({
  nome,
  semResponsavel,
}: {
  nome: string;
  /** Negócios abertos sem dono na base inteira. `null` quando a contagem falhou. */
  semResponsavel: number | null;
}) {
  const haTrabalhoSemDono = semResponsavel !== null && semResponsavel > 0;

  return (
    <Moldura
      icone={
        haTrabalhoSemDono ? (
          <SquareKanban className="size-5" aria-hidden="true" />
        ) : (
          <CheckCheck className="size-5" aria-hidden="true" />
        )
      }
      titulo={
        haTrabalhoSemDono
          ? 'A sua fila está vazia.'
          : nome
            ? `Fila zerada, ${nome}.`
            : 'Fila zerada.'
      }
      texto={
        haTrabalhoSemDono ? (
          <>
            Nada vencido e nada marcado para você. Mas a base tem{' '}
            <span className="numerico">{semResponsavel}</span>
            {semResponsavel === 1
              ? ' negócio aberto ainda sem responsável'
              : ' negócios abertos ainda sem responsável'}
            : assuma um no funil e ele passa a aparecer aqui.
          </>
        ) : (
          'Nada vencido, nada marcado para hoje e nenhum negócio seu sem próximo passo. Dá para puxar trabalho novo.'
        )
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild className="toque h-11 md:h-9">
          <Link href={haTrabalhoSemDono ? '/funis' : '/registrar'}>
            {haTrabalhoSemDono ? (
              <SquareKanban aria-hidden="true" />
            ) : (
              <PhoneOutgoing aria-hidden="true" />
            )}
            {haTrabalhoSemDono ? 'Abrir o funil' : 'Registrar um contato'}
          </Link>
        </Button>
        <Button asChild variant="outline" className="toque h-11 md:h-9">
          <Link href={haTrabalhoSemDono ? '/registrar' : '/funis'}>
            {haTrabalhoSemDono ? (
              <PhoneOutgoing aria-hidden="true" />
            ) : (
              <SquareKanban aria-hidden="true" />
            )}
            {haTrabalhoSemDono ? 'Registrar um contato' : 'Abrir o funil'}
          </Link>
        </Button>
      </div>
    </Moldura>
  );
}

/**
 * Existe fila, mas tudo o que sobrou tem data à frente: hoje está limpo. Vale o
 * mesmo alívio, em tom menor, e sem esconder o que vem depois.
 */
export function NadaParaHoje({ quantosDepois }: { quantosDepois: number }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-hairline bg-card px-4 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <CheckCheck className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="font-medium">Hoje está limpo.</p>
        <p className="text-sm text-muted-foreground">
          Nada vencido e nada marcado para hoje. Há{' '}
          <span className="numerico">{quantosDepois}</span>
          {quantosDepois === 1
            ? ' compromisso com data à frente, logo abaixo.'
            : ' compromissos com data à frente, logo abaixo.'}
        </p>
      </div>
    </div>
  );
}

/** Falhou: diz em português o que houve e o que fazer, nunca o texto cru do Postgres. */
export function ErroDaFila({ causa, aoTentar }: { causa: string; aoTentar: () => void }) {
  return (
    <Moldura
      icone={<RotateCw className="size-5" aria-hidden="true" />}
      titulo="Não deu para carregar a sua fila"
      texto={`${causa} Tente de novo; se continuar, avise no grupo do time.`}
    >
      <Button variant="outline" onClick={aoTentar} className="toque h-11 md:h-9">
        <RotateCw aria-hidden="true" />
        Tentar de novo
      </Button>
    </Moldura>
  );
}

function Moldura({
  icone,
  titulo,
  texto,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  /** Nó, e não string: o número de negócios sem dono precisa da IBM Plex Mono. */
  texto: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icone}
      </span>
      <div className="space-y-1">
        <p className="font-heading font-medium">{titulo}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{texto}</p>
      </div>
      {children}
    </div>
  );
}
