'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  CANAIS_EM_ORDEM,
  contarFiltros,
  JANELAS_EM_ORDEM,
  ROTULO_CANAL,
  ROTULO_JANELA,
  type FiltrosConversas,
} from './tipos';

/** Valor do "sem filtro" no Radix Select, que não aceita item com valor vazio. */
const TODOS = 'todos';

/**
 * Busca e os três recortes da tela: responsável, canal e há quanto tempo ninguém fala.
 *
 * A barra fica ACIMA das duas colunas, e não dentro da lista da esquerda: no desktop a
 * lista tem 20rem, onde três gatilhos de select não cabem lado a lado sem truncar o
 * próprio rótulo, e no celular ela seria a segunda barra rolável de uma tela que já
 * tem a barra inferior da casca.
 *
 * A busca é local (a base inteira já está em memória, ver `dados.ts`), então não há
 * atraso de rede a esconder; mesmo assim ela mantém os 300 ms dos outros módulos, para
 * a lista não reordenar embaixo do dedo a cada tecla.
 */
export function FiltrosDaConversa({
  filtros,
  pessoas,
  aoMudar,
  aoLimpar,
}: {
  filtros: FiltrosConversas;
  pessoas: { id: string; nome: string }[];
  aoMudar: (parcial: Partial<FiltrosConversas>) => void;
  aoLimpar: () => void;
}) {
  const idBusca = useId();
  const ativos = contarFiltros(filtros);
  const limpavel = ativos > 0 || filtros.q.trim() !== '';

  const mudarBusca = useCallback((q: string) => aoMudar({ q }), [aoMudar]);

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
      <CampoBusca id={idBusca} valor={filtros.q} aoMudar={mudarBusca} />

      <div className="flex min-w-0 flex-col gap-2 md:flex-1 md:flex-row md:items-center md:gap-2">
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [mask-image:linear-gradient(to_right,black_calc(100%_-_1.5rem),transparent)] md:mx-0 md:flex-wrap md:px-0 md:pb-0 md:[mask-image:none]">
          <Filtro
            rotulo="Responsável"
            todos="Todos os responsáveis"
            aria="Filtrar por responsável"
            valor={filtros.responsavelId}
            opcoes={pessoas.map((p) => ({ valor: p.id, rotulo: p.nome }))}
            aoMudar={(v) => aoMudar({ responsavelId: v })}
          />
          <Filtro
            rotulo="Canal"
            todos="Todos os canais"
            aria="Filtrar por canal da interação"
            valor={filtros.canal}
            opcoes={CANAIS_EM_ORDEM.map((c) => ({ valor: c, rotulo: ROTULO_CANAL[c] }))}
            aoMudar={(v) => aoMudar({ canal: v })}
          />
          <Filtro
            rotulo={ROTULO_JANELA.qualquer}
            todos="Qualquer tempo sem contato"
            aria="Filtrar por dias sem contato"
            valor={filtros.janela === 'qualquer' ? null : filtros.janela}
            opcoes={JANELAS_EM_ORDEM.map((j) => ({ valor: j, rotulo: ROTULO_JANELA[j] }))}
            aoMudar={(v) => aoMudar({ janela: v ?? 'qualquer' })}
          />
        </div>

        {limpavel ? (
          <Button
            variant="ghost"
            onClick={aoLimpar}
            className="toque h-11 w-fit shrink-0 text-muted-foreground md:h-8"
          >
            <X aria-hidden="true" />
            Limpar
            {ativos > 0 ? <span className="numerico">({ativos})</span> : null}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CampoBusca({
  id,
  valor,
  aoMudar,
}: {
  id: string;
  valor: string;
  aoMudar: (v: string) => void;
}) {
  const [texto, setTexto] = useState(valor);
  const ultimoEnviado = useRef(valor);

  useEffect(() => {
    if (valor !== ultimoEnviado.current) {
      ultimoEnviado.current = valor;
      setTexto(valor);
    }
  }, [valor]);

  useEffect(() => {
    if (texto === ultimoEnviado.current) return;
    const relogio = window.setTimeout(() => {
      ultimoEnviado.current = texto;
      aoMudar(texto);
    }, 300);
    return () => window.clearTimeout(relogio);
  }, [texto, aoMudar]);

  return (
    <div className="md:w-full md:max-w-xs md:shrink-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-foreground">
        Buscar parceiro
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={id}
          type="search"
          inputMode="search"
          autoComplete="off"
          enterKeyHint="search"
          aria-describedby={`${id}-dica`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="h-11 pl-9 md:h-9"
        />
        {texto ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setTexto('')}
            className="absolute top-1/2 right-1.5 size-11 -translate-y-1/2 md:size-7"
          >
            <X aria-hidden="true" />
            <span className="sr-only">Limpar a busca</span>
          </Button>
        ) : null}
      </div>
      <p id={`${id}-dica`} className="mt-1 text-xs text-muted-foreground">
        Nome, categoria ou bairro.
      </p>
    </div>
  );
}

function Filtro<T extends string>({
  rotulo,
  todos,
  aria,
  valor,
  opcoes,
  aoMudar,
}: {
  /** O que o gatilho mostra quando nada está escolhido. */
  rotulo: string;
  /** A primeira opção da lista, que desliga o filtro. */
  todos: string;
  aria: string;
  valor: T | null;
  opcoes: { valor: T; rotulo: string }[];
  aoMudar: (v: T | null) => void;
}) {
  return (
    <Select
      value={valor === null ? TODOS : valor}
      onValueChange={(v) => aoMudar(v === TODOS ? null : (v as T))}
    >
      <SelectTrigger
        aria-label={aria}
        className={cn('toque h-11 shrink-0 md:h-8', valor !== null && 'border-foreground/40 font-medium')}
      >
        <SelectValue placeholder={rotulo}>
          {valor === null ? rotulo : opcoes.find((o) => o.valor === valor)?.rotulo}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>{todos}</SelectItem>
        {opcoes.map((o) => (
          <SelectItem key={o.valor} value={o.valor}>
            {o.rotulo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
