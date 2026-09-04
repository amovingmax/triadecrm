'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Search, TriangleAlert, X } from 'lucide-react';

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
  ROTULO_SITUACAO,
  temRecorteNaFila,
  type FiltroSituacao,
  type FiltrosDaFila,
  type OpcaoCategoriaRadar,
  type OpcaoSimples,
} from './tipos';

/** Valor do "sem filtro" no Radix Select, que não aceita item com valor vazio. */
const TODAS = 'todas';

const SITUACOES: FiltroSituacao[] = ['novo', 'aprovado', 'mesclado', 'recusado', 'todos'];

/**
 * Recorte da fila: situação, fonte, categoria, busca e o atalho para os candidatos
 * que a higiene de entrada marcou.
 *
 * A situação é o filtro mais usado e por isso não é uma pílula igual às outras: ela
 * define QUAL fila se está olhando, e vem primeiro.
 */
export function BarraDaFila({
  filtros,
  fontes,
  categorias,
  marcados,
  aoMudar,
  aoLimpar,
}: {
  filtros: FiltrosDaFila;
  fontes: OpcaoSimples[];
  categorias: OpcaoCategoriaRadar[];
  /** Quantos candidatos novos vieram marcados pela higiene; `null` enquanto carrega. */
  marcados: number | null;
  aoMudar: (parcial: Partial<FiltrosDaFila>) => void;
  aoLimpar: () => void;
}) {
  const idBusca = useId();

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
      <CampoBusca id={idBusca} valor={filtros.q} aoMudar={(q) => aoMudar({ q })} />

      <div className="flex min-w-0 flex-col gap-2 md:flex-1 md:flex-row md:items-center md:gap-2">
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [mask-image:linear-gradient(to_right,black_calc(100%_-_1.5rem),transparent)] md:mx-0 md:flex-wrap md:px-0 md:pb-0 md:[mask-image:none]">
          <Select
            value={filtros.situacao}
            onValueChange={(v) => aoMudar({ situacao: v as FiltroSituacao, pagina: 1 })}
          >
            <SelectTrigger className="toque h-11 w-fit shrink-0 md:h-8" aria-label="Situação">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SITUACOES.map((s) => (
                <SelectItem key={s} value={s}>
                  {ROTULO_SITUACAO[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <FiltroLista
            rotulo="Fonte"
            valor={filtros.fonteId}
            aoMudar={(v) => aoMudar({ fonteId: v, pagina: 1 })}
            opcoes={fontes.map((f) => ({ valor: f.id, rotulo: f.nome }))}
          />
          <FiltroLista
            rotulo="Categoria"
            valor={filtros.categoriaId}
            aoMudar={(v) => aoMudar({ categoriaId: v, pagina: 1 })}
            opcoes={categorias.map((c) => ({ valor: c.id, rotulo: c.nome }))}
          />

          <Button
            variant="outline"
            aria-pressed={filtros.soMarcados}
            onClick={() => aoMudar({ soMarcados: !filtros.soMarcados, pagina: 1 })}
            className={cn(
              'toque h-11 w-fit shrink-0 md:h-8',
              filtros.soMarcados && 'bg-muted text-foreground',
            )}
          >
            <TriangleAlert aria-hidden="true" />
            Só os marcados
            {marcados !== null ? <span className="numerico">({marcados})</span> : null}
          </Button>
        </div>

        {temRecorteNaFila(filtros) ? (
          <Button
            variant="ghost"
            onClick={aoLimpar}
            className="toque h-11 w-fit shrink-0 text-muted-foreground md:h-8"
          >
            <X aria-hidden="true" />
            Limpar
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
    <div className="md:w-full md:max-w-sm md:shrink-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-foreground">
        Buscar candidato
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
        Nome, telefone, @instagram ou CNPJ.
      </p>
    </div>
  );
}

type Opcao = { valor: number; rotulo: string };

function FiltroLista({
  rotulo,
  valor,
  opcoes,
  aoMudar,
}: {
  rotulo: string;
  valor: number | null;
  opcoes: Opcao[];
  aoMudar: (v: number | null) => void;
}) {
  const selecionado = valor === null ? TODAS : String(valor);

  return (
    <Select value={selecionado} onValueChange={(v) => aoMudar(v === TODAS ? null : Number(v))}>
      <SelectTrigger
        className={cn(
          'toque h-11 w-fit shrink-0 md:h-8',
          valor !== null && 'bg-muted text-foreground',
        )}
        aria-label={rotulo}
      >
        <SelectValue placeholder={rotulo}>
          {valor === null ? rotulo : (opcoes.find((o) => o.valor === valor)?.rotulo ?? rotulo)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={TODAS}>{rotulo}: todas</SelectItem>
        {opcoes.map((o) => (
          <SelectItem key={o.valor} value={String(o.valor)}>
            {o.rotulo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
