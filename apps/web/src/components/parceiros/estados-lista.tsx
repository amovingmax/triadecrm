'use client';

import { FilterX, Plus, RotateCw, SearchX, Users, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Os três jeitos de a lista não ter linhas, mais a espera.
 *
 * "Não achei nada" e "a base está vazia" são situações diferentes e pedem saídas
 * diferentes: uma se resolve limpando o filtro, a outra cadastrando o primeiro
 * parceiro. Misturar as duas manda a pessoa para o lugar errado.
 */

/**
 * Espera: o mesmo desenho da tabela final (mesma altura de linha, mesmas larguras
 * de coluna), não um giro no meio da tela. O olho já se posiciona onde o conteúdo
 * vai aparecer, e a troca não empurra nada.
 */
export function EsqueletoLista() {
  const larguras = ['w-40', 'w-56', 'w-32', 'w-48', 'w-36', 'w-52', 'w-44', 'w-60'];

  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando parceiros.</span>

      {/* Celular: cartões */}
      <ul className="md:hidden">
        {Array.from({ length: 8 }, (_, i) => (
          <li
            key={i}
            className="relative flex min-h-16 items-center gap-3 border-b border-border/70 py-2.5 pl-4"
          >
            <Skeleton className="absolute left-0 h-10 w-[3px] rounded-none" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className={`h-4 ${larguras[i % larguras.length]}`} />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-4 w-8" />
          </li>
        ))}
      </ul>

      {/* Desktop: a forma da tabela */}
      <div className="hidden md:block">
        <div className="flex h-9 items-center gap-3 border-b border-border px-3">
          {['w-20', 'w-16', 'w-24', 'w-16', 'w-20', 'w-20', 'w-14', 'w-20'].map((l, i) => (
            <Skeleton key={i} className={`h-3 ${l}`} />
          ))}
        </div>
        {Array.from({ length: 12 }, (_, linha) => (
          <div key={linha} className="flex h-9 items-center gap-3 border-b border-border/70 px-3">
            <Skeleton className="h-4 w-[3px] rounded-none" />
            <Skeleton className={`h-3.5 ${larguras[linha % larguras.length]}`} />
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 w-8" />
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A base ainda não tem ninguém: o convite é cadastrar, e o caminho é curto.
 * `aoCadastrar` nulo = papel que só lê; aí o texto não promete o que a pessoa não pode fazer.
 */
export function VazioDeVerdade({ aoCadastrar }: { aoCadastrar: (() => void) | null }) {
  return (
    <Moldura
      icone={<Users className="size-5" aria-hidden="true" />}
      titulo="Nenhum parceiro ainda"
      texto={
        aoCadastrar
          ? 'Cadastre o primeiro em 4 campos.'
          : 'A base ainda está vazia. Quem cadastra é o time comercial.'
      }
    >
      {aoCadastrar ? (
        <Button onClick={aoCadastrar} className="toque h-11 md:h-9">
          <Plus aria-hidden="true" />
          Novo parceiro
        </Button>
      ) : null}
    </Moldura>
  );
}

/**
 * O recorte é que não devolveu nada: a saída é afrouxar o recorte.
 *
 * `soBusca` separa os dois casos: quando só há texto digitado, oferecer "Limpar
 * filtros" manda a pessoa procurar um filtro que ela nunca ligou.
 */
export function VazioPorFiltro({
  aoLimpar,
  descricao,
  soBusca = false,
}: {
  aoLimpar: () => void;
  descricao: string;
  soBusca?: boolean;
}) {
  return (
    <Moldura
      icone={<SearchX className="size-5" aria-hidden="true" />}
      titulo={soBusca ? 'Ninguém com esse nome ou número' : 'Nenhum parceiro com esses filtros'}
      texto={descricao}
    >
      <Button variant="outline" onClick={aoLimpar} className="toque h-11 md:h-9">
        {soBusca ? <X aria-hidden="true" /> : <FilterX aria-hidden="true" />}
        {soBusca ? 'Limpar a busca' : 'Limpar filtros'}
      </Button>
    </Moldura>
  );
}

/** Falhou: diz o que aconteceu e o que fazer, sem jargão de stack trace. */
export function ErroDaLista({ causa, aoTentar }: { causa: string; aoTentar: () => void }) {
  return (
    <Moldura
      icone={<RotateCw className="size-5" aria-hidden="true" />}
      titulo="Não deu para carregar os parceiros"
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
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{texto}</p>
      </div>
      {children}
    </div>
  );
}
