'use client';

import { FilterX, Inbox, Plus, RotateCw, SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Os jeitos de a fila do Radar não ter linhas, mais a espera.
 *
 * A fila vazia aqui não é um acidente: enquanto o coletor não existir, o normal é
 * ela estar vazia. Por isso o estado vazio de verdade não pede desculpas — ele
 * explica o que está acontecendo e oferece a única coisa que funciona hoje, que é
 * cadastrar um candidato à mão.
 */

/** Espera com o desenho final do cartão: título, linha de dados e as ações. */
export function EsqueletoDaFila() {
  const larguras = ['w-44', 'w-56', 'w-36', 'w-48', 'w-40', 'w-52'];

  return (
    <ul aria-busy="true" aria-live="polite" className="flex flex-col">
      <li className="sr-only">Carregando a fila de revisão.</li>
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="flex flex-col gap-3 border-b border-hairline py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className={`h-4 ${larguras[i % larguras.length]}`} />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-40" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-11 w-28 rounded-lg md:h-8" />
            <Skeleton className="h-11 w-28 rounded-lg md:h-8" />
            <Skeleton className="h-11 w-24 rounded-lg md:h-8" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Não há candidato nenhum na fila. Diz o motivo verdadeiro (a coleta não roda) e
 * aponta o caminho que existe hoje.
 */
export function FilaVazia({ aoCadastrar }: { aoCadastrar: (() => void) | null }) {
  return (
    <Moldura
      icone={<Inbox className="size-5" aria-hidden="true" />}
      titulo="Nenhum candidato esperando revisão"
      texto={
        aoCadastrar
          ? 'É o esperado por enquanto: o coletor automático ainda não roda, então nada entra sozinho. O que você achar na mão entra por aqui e passa pela mesma revisão.'
          : 'É o esperado por enquanto: o coletor automático ainda não roda, então nada entra sozinho. Quem cadastra candidato é o time comercial.'
      }
    >
      {aoCadastrar ? (
        <Button onClick={aoCadastrar} className="toque h-11 md:h-9">
          <Plus aria-hidden="true" />
          Cadastrar candidato
        </Button>
      ) : null}
    </Moldura>
  );
}

/** O recorte é que não devolveu nada. */
export function VazioPorFiltroDaFila({
  descricao,
  aoLimpar,
  soBusca = false,
}: {
  descricao: string;
  aoLimpar: () => void;
  soBusca?: boolean;
}) {
  return (
    <Moldura
      icone={<SearchX className="size-5" aria-hidden="true" />}
      titulo={soBusca ? 'Nenhum candidato com esse texto' : 'Nenhum candidato com esse recorte'}
      texto={descricao}
    >
      <Button variant="outline" onClick={aoLimpar} className="toque h-11 md:h-9">
        <FilterX aria-hidden="true" />
        Limpar o recorte
      </Button>
    </Moldura>
  );
}

/** Falhou: o que aconteceu e o que fazer, sem texto cru do Postgres. */
export function ErroDaFila({ causa, aoTentar }: { causa: string; aoTentar: () => void }) {
  return (
    <Moldura
      icone={<RotateCw className="size-5" aria-hidden="true" />}
      titulo="Não deu para carregar a fila"
      texto={`${causa} Confira a conexão e tente de novo. Se continuar, avise no grupo do time.`}
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
  texto: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icone}
      </span>
      <div className="space-y-1">
        <p className="font-heading font-medium">{titulo}</p>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">{texto}</p>
      </div>
      {children}
    </div>
  );
}
