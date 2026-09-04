'use client';

/**
 * O cabeçalho da tela de funis: qual funil, de quem, e procurando o quê (RF-FUN-01).
 *
 * Três controles e nada mais. A tela é usada de pé, na rua, com uma mão: cada
 * seletor a mais é um toque a mais entre a Heloísa e o cartão que ela quer achar.
 *
 *  * **Seletor de funil** — os três que existem no banco. Ativação aparece porque
 *    existe e o time pergunta por ele; ao escolhê-lo a tela explica que ele é
 *    alimentado por eventos da plataforma (PRD §6, v1) em vez de mostrar um quadro
 *    onde ninguém pode arrastar nada.
 *  * **Meus / Todos** — o filtro do RF-FUN-01. Fica ao lado da busca porque as duas
 *    respondem à mesma pergunta ("cadê o cartão?") e no celular precisam caber na
 *    mesma linha.
 *  * **Busca por nome** — dentro do funil, não na base inteira: quem procura na base
 *    usa a tela de Parceiros.
 */
import { Search, UserRound, Users, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { FunilDisponivel } from './consultas';

/** Aba de um funil no seletor. */
function AbaDeFunil({
  funil,
  ativo,
  aoEscolher,
}: {
  funil: FunilDisponivel;
  ativo: boolean;
  aoEscolher: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativo}
      onClick={aoEscolher}
      className={cn(
        'toque h-11 shrink-0 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors md:h-8',
        ativo
          ? 'bg-card text-foreground sombra-base'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {funil.nome}
      {!funil.noQuadro ? (
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">(v1)</span>
      ) : null}
    </button>
  );
}

export function SeletorDeFunil({
  funis,
  slugAtivo,
  aoEscolher,
  carregando = false,
}: {
  funis: FunilDisponivel[];
  slugAtivo: string;
  aoEscolher: (funil: FunilDisponivel) => void;
  carregando?: boolean;
}) {
  if (carregando) {
    return (
      <div
        aria-hidden="true"
        className="h-12 w-full max-w-md animate-pulse rounded-xl bg-muted md:h-10"
      />
    );
  }

  return (
    // No celular a trilha rola na horizontal em vez de quebrar em duas linhas: três
    // nomes longos não cabem em 390px e empilhar empurraria o quadro para baixo da dobra.
    <div
      role="tablist"
      aria-label="Funil"
      className="-mx-1 flex gap-1 overflow-x-auto rounded-xl bg-muted/50 p-1 md:mx-0 md:w-fit"
    >
      {funis.map((funil) => (
        <AbaDeFunil
          key={funil.id}
          funil={funil}
          ativo={funil.slug === slugAtivo}
          aoEscolher={() => aoEscolher(funil)}
        />
      ))}
    </div>
  );
}

export function FiltrosDoQuadro({
  q,
  apenasMeus,
  aoBuscar,
  aoTrocarDono,
}: {
  q: string;
  apenasMeus: boolean;
  aoBuscar: (q: string) => void;
  aoTrocarDono: (apenasMeus: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1 md:max-w-xs">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={q}
          onChange={(e) => aoBuscar(e.target.value)}
          placeholder="Procurar no funil"
          aria-label="Procurar parceiro dentro deste funil"
          className="h-11 pl-8 md:h-8"
        />
        {q ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Limpar a busca"
            onClick={() => aoBuscar('')}
            className="absolute top-1/2 right-1 -translate-y-1/2"
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {/* Dois estados, um botão: "Meus" e "Todos" são a mesma pergunta invertida, e
          `aria-pressed` deixa isso explícito para quem usa leitor de tela. */}
      <Button
        type="button"
        variant={apenasMeus ? 'secondary' : 'outline'}
        aria-pressed={apenasMeus}
        onClick={() => aoTrocarDono(!apenasMeus)}
        className="toque h-11 shrink-0 md:h-8"
      >
        {apenasMeus ? <UserRound aria-hidden="true" /> : <Users aria-hidden="true" />}
        {apenasMeus ? 'Meus' : 'Todos'}
      </Button>
    </div>
  );
}
