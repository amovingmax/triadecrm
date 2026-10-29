'use client';

import { useState } from 'react';
import { ChevronDown, Flame } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  carregarHistoricoDaAtitude,
  CHAVE_ATITUDES,
  chaveDoHistoricoDaAtitude,
  marcarAtitude,
  marcarObjecao,
  useAtitudes,
} from './atitude-dados';
import {
  ETIQUETAS_DO_TOQUE,
  ROTULO_ATITUDE,
  textoDaAtitude as textoDa,
  type AtitudeDaConversa,
  type EtiquetaDeAtitude,
  type EtiquetaDoToque,
  type Objecao,
} from './atitude-regra';
import { rotuloDoDia } from './formatos';

/**
 * A etiqueta de atitude do cliente (29/10/2026): na linha da lista e no topo
 * da conversa.
 *
 * As cores são as da escala térmica, porque é a mesma pergunta — o quanto essa
 * pessoa quer: brasa para Muito interessado, âmbar para Interessado, aço para
 * Esfriando. O resto fica no cinza do tema: Morno, Sem resposta, Sem
 * interesse e Não contatar não pedem pressa de ninguém. A palavra vai sempre
 * escrita: cor sozinha não sobrevive a daltonismo nem ao sol.
 */
const ESTILO: Record<EtiquetaDeAtitude, string> = {
  muito_interessado: 'bg-quente-fundo text-quente-texto font-semibold',
  interessado: 'bg-morno-fundo text-morno-texto',
  esfriando: 'bg-frio-fundo text-frio-texto',
  morno: 'bg-muted text-foreground',
  sem_resposta: 'bg-muted text-muted-foreground',
  sem_interesse: 'bg-muted text-muted-foreground',
  nao_contatar: 'bg-muted text-muted-foreground',
};

export function ChipDaAtitude({
  atitude,
  className,
}: {
  atitude: AtitudeDaConversa;
  className?: string;
}) {
  return (
    <span
      title={atitude.motivo ?? undefined}
      className={cn(
        'inline-flex h-4 max-w-full shrink-0 items-center gap-1 truncate rounded-full px-1.5 text-[10px] leading-none font-medium',
        ESTILO[atitude.etiqueta],
        className,
      )}
    >
      {atitude.etiqueta === 'muito_interessado' ? (
        <Flame className="size-2.5 shrink-0" aria-hidden="true" />
      ) : null}
      {textoDa(atitude)}
    </span>
  );
}

/**
 * Etiqueta e objeções numa linha da lista. Uma objeção pelo nome e o resto em
 * número: três pílulas comiam a largura do nome.
 */
export function AtitudeNaLista({
  atitude,
  objecoes,
}: {
  atitude: AtitudeDaConversa | undefined;
  objecoes: readonly Objecao[];
}) {
  if (!atitude) return null;
  const nomes = atitude.objecoes
    .map((id) => objecoes.find((o) => o.id === id)?.nome)
    .filter((n): n is string => Boolean(n));
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      <ChipDaAtitude atitude={atitude} />
      {nomes.length > 0 ? (
        <span
          className="inline-flex h-4 max-w-32 shrink-0 items-center truncate rounded-full border border-hairline px-1.5 text-[10px] leading-none text-muted-foreground"
          title={`Objeção: ${nomes.join(', ')}`}
        >
          objeção: {nomes[0]!.toLowerCase()}
          {nomes.length > 1 ? ` +${nomes.length - 1}` : ''}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A etiqueta no topo da conversa, e o que se faz com ela: o porquê, o toque de
 * quem atende, as objeções e as últimas mudanças. Nada daqui manda mensagem.
 */
export function AtitudeDaConversaNoTopo({
  conversaId,
  podeEscrever,
  naFolha = false,
}: {
  conversaId: string;
  podeEscrever: boolean;
  /** Na folha do celular, o gatilho tem o tamanho dos outros selos dela. */
  naFolha?: boolean;
}) {
  const { ligada, objecoes, porConversa } = useAtitudes();
  const atitude = porConversa.get(conversaId);
  const [aberto, setAberto] = useState(false);
  const clientes = useQueryClient();

  const historico = useQuery({
    queryKey: chaveDoHistoricoDaAtitude(conversaId),
    queryFn: () => carregarHistoricoDaAtitude(conversaId),
    enabled: aberto,
  });

  const depois = () => {
    void clientes.invalidateQueries({ queryKey: CHAVE_ATITUDES });
  };
  const marcar = useMutation({
    mutationFn: (etiqueta: EtiquetaDoToque | null) => marcarAtitude(conversaId, etiqueta),
    onSuccess: depois,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não deu para gravar.'),
  });
  const objetar = useMutation({
    mutationFn: ({ id, aberta }: { id: number; aberta: boolean }) =>
      marcarObjecao(conversaId, id, aberta),
    onSuccess: depois,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não deu para gravar.'),
  });

  if (!ligada) return null;

  const abertas = atitude?.objecoes ?? [];
  const nomesAbertos = abertas
    .map((id) => objecoes.find((o) => o.id === id)?.nome)
    .filter((n): n is string => Boolean(n));
  const tamanho = naFolha ? 'h-9 px-3 text-sm' : 'h-5 px-2 text-[11px]';

  const gatilho = (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full leading-none font-medium',
        tamanho,
        atitude ? ESTILO[atitude.etiqueta] : 'border border-dashed border-hairline text-muted-foreground',
      )}
    >
      {atitude?.etiqueta === 'muito_interessado' ? (
        <Flame className="size-3 shrink-0" aria-hidden="true" />
      ) : null}
      {atitude ? textoDa(atitude) : 'Sem etiqueta ainda'}
      {nomesAbertos.length > 0 ? ` · objeção: ${nomesAbertos.join(', ').toLowerCase()}` : ''}
      {podeEscrever ? <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" /> : null}
    </span>
  );

  if (!podeEscrever) {
    return <span title={atitude?.motivo ?? undefined}>{gatilho}</span>;
  }

  return (
    <DropdownMenu open={aberto} onOpenChange={setAberto}>
      <DropdownMenuTrigger
        className="toque rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`Atitude do cliente: ${atitude ? textoDa(atitude) : 'sem etiqueta'}. Mudar`}
      >
        {gatilho}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70svh] w-72 overflow-y-auto">
        {atitude?.motivo ? (
          <p className="px-2 pt-1.5 pb-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Por quê: </span>
            {atitude.motivo}
          </p>
        ) : null}

        <DropdownMenuLabel className="text-xs text-muted-foreground">Interesse</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={atitude?.marcada ?? ''}
          onValueChange={(v) => marcar.mutate(v as EtiquetaDoToque)}
        >
          {ETIQUETAS_DO_TOQUE.map((e) => (
            <DropdownMenuRadioItem key={e} value={e} disabled={marcar.isPending}>
              {ROTULO_ATITUDE[e]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {atitude?.marcada ? (
          <DropdownMenuItem
            className="text-xs text-muted-foreground"
            disabled={marcar.isPending}
            onSelect={() => marcar.mutate(null)}
          >
            Deixar a regra decidir
          </DropdownMenuItem>
        ) : null}

        {objecoes.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Objeções</DropdownMenuLabel>
            {objecoes.map((o) => (
              <DropdownMenuCheckboxItem
                key={o.id}
                checked={abertas.includes(o.id)}
                disabled={objetar.isPending}
                onSelect={(ev) => ev.preventDefault()}
                onCheckedChange={(v) => objetar.mutate({ id: o.id, aberta: v === true })}
              >
                {o.nome}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Últimas mudanças</DropdownMenuLabel>
        {historico.isPending ? (
          <p className="px-2 pb-2 text-xs text-muted-foreground">Carregando...</p>
        ) : (historico.data ?? []).length === 0 ? (
          <p className="px-2 pb-2 text-xs text-muted-foreground">Nenhuma ainda.</p>
        ) : (
          <ol className="flex flex-col gap-1.5 px-2 pb-2">
            {(historico.data ?? []).map((h) => (
              <li key={h.id} className="text-xs">
                <span className="numerico text-muted-foreground">{quando(h.em)} · </span>
                {h.tipo === 'etiqueta' && h.para && h.para in ROTULO_ATITUDE ? (
                  <span className="font-medium">
                    {ROTULO_ATITUDE[h.para as EtiquetaDeAtitude]}:{' '}
                  </span>
                ) : null}
                <span className="text-muted-foreground">{h.motivo}</span>
              </li>
            ))}
          </ol>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * "Recentes · Mais interessados", no alto da lista. Desligada a atitude, não
 * existe: a lista da KOMUNE fica como era.
 */
export function OrdemDaLista({
  ligada,
  ordem,
  aoMudar,
  className,
}: {
  ligada: boolean;
  ordem: 'recentes' | 'interesse';
  aoMudar: (ordem: 'recentes' | 'interesse') => void;
  className?: string;
}) {
  if (!ligada) return null;
  const opcoes = [
    { id: 'recentes', rotulo: 'Recentes' },
    { id: 'interesse', rotulo: 'Mais interessados' },
  ] as const;
  return (
    <div role="group" aria-label="Ordem da lista" className={cn('flex items-center gap-1.5', className)}>
      <span className="text-[11px] text-muted-foreground">Ordem:</span>
      {opcoes.map((o) => {
        const ativa = o.id === ordem;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={ativa}
            onClick={() => aoMudar(o.id)}
            className={cn(
              'toque inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors md:h-6',
              'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              ativa
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {o.id === 'interesse' ? <Flame className="size-3" aria-hidden="true" /> : null}
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

function quando(iso: string): string {
  const dia = rotuloDoDia(iso);
  return `${dia.palavra}${dia.numero ?? ''}`;
}
