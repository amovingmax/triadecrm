'use client';

/**
 * O cabeçalho da tela de funis: qual funil, de quem, e procurando o quê (RF-FUN-01).
 *
 * Três controles e nada mais. A tela é usada de pé, na rua, com uma mão: cada
 * seletor a mais é um toque a mais entre a Heloísa e o cartão que ela quer achar.
 *
 *  * **Seletor de funil** — os dois de captação: fornecedor e produtor. A aba de
 *    Ativação saiu em 07/10/2026; ela não abria quadro, só uma régua de contagens.
 *  * **Meus / Todos** — o filtro do RF-FUN-01. Fica ao lado da busca porque as duas
 *    respondem à mesma pergunta ("cadê o cartão?") e no celular precisam caber na
 *    mesma linha.
 *  * **Busca por nome** — dentro do funil, não na base inteira: quem procura na base
 *    usa a tela de Parceiros.
 *  * **Canal** (28/09/2026, ADR-16) — o canal do ÚLTIMO TOQUE. É o "me mostra só
 *    quem veio por WhatsApp" que o Rafael pediu, e é FILTRO, não funil separado: o
 *    fornecedor que ignorou o WhatsApp e atendeu o telefone é um lead, não dois
 *    (R13 §3.1).
 */
import { Search, UserRound, Users, X } from 'lucide-react';

import type { Channel } from '@komune/schema';

import { CANAIS_EM_ORDEM, ROTULO_CANAL } from '@/lib/canais';
import { SeletorDeAba } from '@/components/ui/abas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { FunilDisponivel } from './consultas';

/** Aba de um funil no seletor. */

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
    // No celular a trilha rola na horizontal em vez de quebrar em duas linhas: dois
    // nomes longos não cabem em 390px e empilhar empurraria o quadro para baixo da dobra.
    <SeletorDeAba
      rotulo="Funil"
      rolavel
      ativo={slugAtivo}
      aoTrocar={(slug) => {
        const escolhido = funis.find((f) => f.slug === slug);
        if (escolhido) aoEscolher(escolhido);
      }}
      itens={funis.map((funil) => ({ id: funil.slug, rotulo: funil.nome }))}
    />
  );
}

export function FiltrosDoQuadro({
  q,
  apenasMeus,
  canal,
  aoBuscar,
  aoTrocarDono,
  aoTrocarCanal,
}: {
  q: string;
  apenasMeus: boolean;
  canal: Channel | null;
  aoBuscar: (q: string) => void;
  aoTrocarDono: (apenasMeus: boolean) => void;
  aoTrocarCanal: (canal: Channel | null) => void;
}) {
  return (
    // No celular a busca ganha a linha de cima inteira, e "Todos" e o canal dividem
    // a de baixo (16/11/2026). Os três numa linha só deixavam a busca com 95px a
    // 375px: o "Procurar no funil" virava "Procu" e o nome digitado mostrava cinco
    // letras. A partir de `sm` volta a ser uma linha só, como era.
    <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
      <div className="relative min-w-0 basis-full sm:flex-1 sm:basis-auto md:max-w-xs">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        {/* `pr-11` para o texto não correr por baixo do X, e o X nativo do
            `type="search"` escondido: com o acolchoado ele aparecia ao lado do
            nosso, e a busca ficava com dois "limpar" (16/11/2026). */}
        <Input
          type="search"
          value={q}
          onChange={(e) => aoBuscar(e.target.value)}
          placeholder="Procurar no funil"
          aria-label="Procurar parceiro dentro deste funil"
          className="h-11 pr-11 pl-8 md:h-8 md:pr-2.5 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {q ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Limpar a busca"
            onClick={() => aoBuscar('')}
            className="absolute top-1/2 right-0 size-11 -translate-y-1/2 md:right-1 md:size-7"
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

      {/* O canal do ÚLTIMO TOQUE, e não "por onde ele entrou": um fornecedor
          tocado por telefone que responde no WhatsApp migra de `phone` para
          `whatsapp`. Está escrito no `title` porque é a diferença que faria
          alguém ler o número errado. */}
      <select
        value={canal ?? ''}
        aria-label="Filtrar o funil pelo canal do último toque"
        title="O canal do último toque com o negócio, não o canal em que ele entrou."
        onChange={(e) => aoTrocarCanal((e.target.value || null) as Channel | null)}
        className="toque h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:flex-none sm:shrink-0 md:h-8 md:text-sm"
      >
        <option value="">Todos os canais</option>
        {CANAIS_EM_ORDEM.map((c) => (
          <option key={c} value={c}>
            {ROTULO_CANAL[c]}
          </option>
        ))}
      </select>
    </div>
  );
}
