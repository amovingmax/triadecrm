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
    // No celular a trilha rola na horizontal em vez de quebrar em duas linhas: três
    // nomes longos não cabem em 390px e empilhar empurraria o quadro para baixo da dobra.
    <SeletorDeAba
      rotulo="Funil"
      rolavel
      ativo={slugAtivo}
      aoTrocar={(slug) => {
        const escolhido = funis.find((f) => f.slug === slug);
        if (escolhido) aoEscolher(escolhido);
      }}
      itens={funis.map((funil) => ({
        id: funil.slug,
        rotulo: funil.nome,
        sufixo: funil.noQuadro ? undefined : '(v1)',
      }))}
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

      {/* O canal do ÚLTIMO TOQUE, e não "por onde ele entrou": um fornecedor
          tocado por telefone que responde no WhatsApp migra de `phone` para
          `whatsapp`. Está escrito no `title` porque é a diferença que faria
          alguém ler o número errado. */}
      <select
        value={canal ?? ''}
        aria-label="Filtrar o funil pelo canal do último toque"
        title="O canal do último toque com o negócio, não o canal em que ele entrou."
        onChange={(e) => aoTrocarCanal((e.target.value || null) as Channel | null)}
        className="toque h-11 shrink-0 rounded-lg border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:h-8"
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
