'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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

import { contarFiltros, type Catalogos, type FiltrosParceiros } from './tipos';

/** Valor do "sem filtro" no Radix Select, que não aceita item com valor vazio. */
const TODOS = 'todos';

/**
 * Busca e filtros da lista.
 *
 * A busca é uma caixa só: nome, telefone em qualquer formato, @instagram, CNPJ ou
 * bairro caem no mesmo campo, porque em campo ninguém escolhe o tipo do que copiou
 * do WhatsApp antes de colar (RF-BAS-12). O texto é enviado com atraso de 300ms para
 * não disparar uma consulta por tecla.
 *
 * Os quatro filtros de lista saem dos catálogos do banco (nada é escrito à mão aqui).
 */
export function BarraFiltros({
  filtros,
  catalogos,
  aoMudar,
  aoLimpar,
}: {
  filtros: FiltrosParceiros;
  catalogos: Catalogos;
  aoMudar: (parcial: Partial<FiltrosParceiros>) => void;
  aoLimpar: () => void;
}) {
  const idBusca = useId();
  const ativos = contarFiltros(filtros);

  return (
    <div className="flex flex-col gap-2">
      <CampoBusca id={idBusca} valor={filtros.q} aoMudar={(q) => aoMudar({ q })} />

      {/* No celular a fila de filtros rola na horizontal; nada quebra a largura da tela. */}
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0 md:pb-0">
        <FiltroLista
          rotulo="Categoria"
          valor={filtros.categoriaId}
          aoMudar={(v) => aoMudar({ categoriaId: v, pagina: 1 })}
          opcoes={catalogos.categorias.map((c) => ({ valor: c.id, rotulo: c.nome }))}
        />
        <FiltroLista
          rotulo="Cidade"
          valor={filtros.cidadeId}
          aoMudar={(v) => aoMudar({ cidadeId: v, pagina: 1 })}
          opcoes={catalogos.cidades.map((c) => ({
            valor: c.id,
            rotulo: c.nome,
            grupo: c.grandeNatal ? 'Grande Natal' : 'Interior',
          }))}
        />
        <FiltroLista
          rotulo="Etapa"
          valor={filtros.etapaId}
          aoMudar={(v) => aoMudar({ etapaId: v, pagina: 1 })}
          opcoes={catalogos.etapas.map((e) => ({ valor: e.id, rotulo: e.nome, grupo: e.funil }))}
        />
        <FiltroLista
          rotulo="Responsável"
          valor={filtros.responsavelId}
          aoMudar={(v) => aoMudar({ responsavelId: v, pagina: 1 })}
          opcoes={catalogos.pessoas.map((p) => ({ valor: p.id, rotulo: p.nome }))}
        />

        {ativos > 0 || filtros.q.trim() ? (
          <Button
            variant="ghost"
            onClick={aoLimpar}
            className="toque h-11 shrink-0 text-muted-foreground md:h-8"
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

  // Espelha uma mudança vinda de fora (o botão "Limpar", por exemplo) sem
  // atropelar o que a pessoa está digitando.
  useEffect(() => {
    if (valor !== ultimoEnviado.current) {
      ultimoEnviado.current = valor;
      setTexto(valor);
    }
  }, [valor]);

  // 300ms: rápido o bastante para parecer instantâneo, lento o bastante para não
  // mandar uma consulta por tecla no 4G da rua.
  useEffect(() => {
    if (texto === ultimoEnviado.current) return;
    const relogio = window.setTimeout(() => {
      ultimoEnviado.current = texto;
      aoMudar(texto);
    }, 300);
    return () => window.clearTimeout(relogio);
  }, [texto, aoMudar]);

  // Duas coisas ficam permanentes em volta do campo, e nenhuma delas no placeholder,
  // que some na primeira tecla: o RÓTULO em cima (quem volta da ficha com a busca já
  // preenchida precisa saber o que aquele texto é) e a lista de formatos aceitos
  // embaixo (RF-BAS-12), ligada ao campo por aria-describedby. Sem placeholder, para
  // não escrever "buscar" duas vezes no mesmo palmo de tela.
  return (
    // Largura máxima no desktop: um campo de 1.500px de largura para digitar um nome
    // não ajuda ninguém a mirar, e ainda descola a busca da fila de filtros embaixo.
    <div className="md:max-w-xl">
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
        Nome, telefone, @instagram, CNPJ ou bairro.
      </p>
    </div>
  );
}

type Opcao<T> = { valor: T; rotulo: string; grupo?: string };

/**
 * Um filtro de lista. Genérico em `T` para servir tanto aos catálogos com id
 * numérico (categoria, cidade, etapa) quanto ao responsável, que é um uuid.
 */
function FiltroLista<T extends string | number>({
  rotulo,
  valor,
  opcoes,
  aoMudar,
}: {
  rotulo: string;
  valor: T | null;
  opcoes: Opcao<T>[];
  aoMudar: (v: T | null) => void;
}) {
  const numerico = typeof opcoes[0]?.valor === 'number';
  const selecionado = valor === null ? TODOS : String(valor);

  // Agrupa mantendo a ordem em que o catálogo veio do banco.
  const grupos = new Map<string, Opcao<T>[]>();
  for (const o of opcoes) {
    const chave = o.grupo ?? '';
    const lista = grupos.get(chave);
    if (lista) lista.push(o);
    else grupos.set(chave, [o]);
  }

  return (
    <Select
      value={selecionado}
      onValueChange={(v) => aoMudar(v === TODOS ? null : ((numerico ? Number(v) : v) as T))}
    >
      <SelectTrigger
        aria-label={rotulo}
        className={cn(
          'toque h-11 shrink-0 md:h-8',
          valor !== null && 'border-foreground/40 font-medium',
        )}
      >
        <SelectValue placeholder={rotulo}>
          {valor === null ? rotulo : opcoes.find((o) => o.valor === valor)?.rotulo}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-80">
        <SelectGroup>
          <SelectItem value={TODOS}>{rotulo}: tudo</SelectItem>
        </SelectGroup>
        {[...grupos.entries()].map(([nomeDoGrupo, itens]) => (
          <SelectGroup key={nomeDoGrupo || rotulo}>
            {nomeDoGrupo ? <SelectLabel>{nomeDoGrupo}</SelectLabel> : null}
            {itens.map((o) => (
              <SelectItem key={String(o.valor)} value={String(o.valor)}>
                {o.rotulo}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
