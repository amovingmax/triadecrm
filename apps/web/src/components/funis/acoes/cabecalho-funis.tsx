'use client';

/**
 * O cabeçalho da tela de funis: qual funil, de quem, e procurando o quê (RF-FUN-01).
 *
 * Três controles e nada mais. A tela é usada de pé, na rua, com uma mão: cada
 * seletor a mais é um toque a mais entre a Heloísa e o cartão que ela quer achar.
 *
 *  * **Seletor de funil** — os dois de captação: fornecedor e produtor. A aba de
 *    Ativação saiu em 07/10/2026; ela não abria quadro, só uma régua de contagens.
 *  * **Responsável: todos / meus** — o filtro do RF-FUN-01. Fica ao lado da busca
 *    porque as duas respondem à mesma pergunta ("cadê o cartão?"). No celular vai,
 *    com o canal, para a folha de filtros (protótipo responsivo, 24/11/2026).
 *  * **Busca por nome** — dentro do funil, não na base inteira: quem procura na base
 *    usa a tela de Parceiros.
 *  * **Canal** (28/09/2026, ADR-16) — o canal do ÚLTIMO TOQUE. É o "me mostra só
 *    quem veio por WhatsApp" que o Rafael pediu, e é FILTRO, não funil separado: o
 *    fornecedor que ignorou o WhatsApp e atendeu o telefone é um lead, não dois
 *    (R13 §3.1).
 */
import { useState } from 'react';
import { Filter, Search, UserRound, Users, X } from 'lucide-react';

import type { Channel } from '@komune/schema';

import { CANAIS_EM_ORDEM, ROTULO_CANAL } from '@/lib/canais';
import { cn } from '@/lib/utils';
import { SeletorDeAba } from '@/components/ui/abas';
import { BotaoFiltros } from '@/components/ui/botao-filtros';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FolhaFiltros, GrupoDeFiltro } from '@/components/ui/folha-filtros';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

/** Valor do "sem filtro" no Radix Select, que não aceita item com valor vazio. */
const TODOS = 'todos';

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
  const [folhaAberta, setFolhaAberta] = useState(false);
  const ligados = (apenasMeus ? 1 : 0) + (canal ? 1 : 0);

  return (
    // Protótipo responsivo (24/11/2026): a busca fica com a largura e os dois
    // filtros viram botões do mesmo desenho dos outros filtros do CRM. No celular
    // eles moram na folha de filtros, atrás de um botão só com o número dos
    // ligados; do tablet para cima ficam à vista, ao lado da busca. Antes o canal
    // era a caixa nativa do navegador, com outra altura, outro canto e outra letra.
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
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
          className="h-11 bg-card pr-11 pl-10 md:h-10 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {q ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Limpar a busca"
            onClick={() => aoBuscar('')}
            className="absolute top-1/2 right-0 size-11 -translate-y-1/2 md:right-1 md:size-8"
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {/* Do tablet para cima: os dois filtros à vista. */}
      <div className="hidden shrink-0 items-center gap-2 md:flex">
        {/* "Meus" e "Todos" são a mesma pergunta invertida (RF-FUN-01): o filtro é
            o responsável, com as duas respostas que o quadro sabe dar. */}
        <Select
          value={apenasMeus ? 'meus' : TODOS}
          onValueChange={(v) => aoTrocarDono(v === 'meus')}
        >
          <SelectTrigger
            aria-label="Filtrar o funil pelo responsável"
            className={cn(BOTAO_DE_FILTRO, apenasMeus && 'border-foreground/50')}
          >
            {apenasMeus ? <UserRound aria-hidden="true" /> : <Users aria-hidden="true" />}
            <SelectValue>Responsável: {apenasMeus ? 'meus' : 'todos'}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectItem value={TODOS}>Todos os negócios</SelectItem>
            <SelectItem value="meus">Só os meus</SelectItem>
          </SelectContent>
        </Select>

        {/* O canal do ÚLTIMO TOQUE, e não "por onde ele entrou": um fornecedor
            tocado por telefone que responde no WhatsApp migra de `phone` para
            `whatsapp`. Está escrito no `title` e no rótulo da lista porque é a
            diferença que faria alguém ler o número errado. */}
        <Select
          value={canal ?? TODOS}
          onValueChange={(v) => aoTrocarCanal(v === TODOS ? null : (v as Channel))}
        >
          <SelectTrigger
            aria-label="Filtrar o funil pelo canal do último toque"
            title="O canal do último toque com o negócio, não o canal em que ele entrou."
            className={cn(BOTAO_DE_FILTRO, canal && 'border-foreground/50')}
          >
            <Filter aria-hidden="true" />
            <SelectValue>Canal: {canal ? ROTULO_CANAL[canal] : 'todos'}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              <SelectLabel>Canal do último toque</SelectLabel>
              <SelectItem value={TODOS}>Todos os canais</SelectItem>
              {CANAIS_EM_ORDEM.map((c) => (
                <SelectItem key={c} value={c}>
                  {ROTULO_CANAL[c]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {/* No celular: um botão só, e os dois filtros na folha. */}
      <BotaoFiltros ligados={ligados} onClick={() => setFolhaAberta(true)} className="md:hidden" />

      <FolhaFiltros
        aberta={folhaAberta}
        aoMudar={setFolhaAberta}
        rodape={
          <>
            {ligados > 0 ? (
              <Button
                variant="outline"
                className="toque h-11"
                onClick={() => {
                  aoTrocarDono(false);
                  aoTrocarCanal(null);
                }}
              >
                Limpar
              </Button>
            ) : null}
            <Button className="toque h-11" onClick={() => setFolhaAberta(false)}>
              Pronto
            </Button>
          </>
        }
      >
        <GrupoDeFiltro titulo="Responsável">
          <Chip ativo={!apenasMeus} onClick={() => aoTrocarDono(false)}>
            Todos os negócios
          </Chip>
          <Chip ativo={apenasMeus} onClick={() => aoTrocarDono(true)}>
            Só os meus
          </Chip>
        </GrupoDeFiltro>
        <GrupoDeFiltro titulo="Canal do último toque">
          <Chip ativo={canal === null} onClick={() => aoTrocarCanal(null)}>
            Todos os canais
          </Chip>
          {CANAIS_EM_ORDEM.map((c) => (
            <Chip key={c} ativo={canal === c} onClick={() => aoTrocarCanal(c)}>
              {ROTULO_CANAL[c]}
            </Chip>
          ))}
          <p className="basis-full pt-1 text-xs text-muted-foreground">
            O canal do último toque com o negócio, não o canal em que ele entrou.
          </p>
        </GrupoDeFiltro>
      </FolhaFiltros>
    </div>
  );
}

/** O botão de filtro do CRM: a mesma altura da busca, o mesmo canto e a mesma letra. */
const BOTAO_DE_FILTRO =
  'toque h-11 shrink-0 gap-2 bg-card px-3 font-medium md:h-10 [&_svg]:text-muted-foreground';
