'use client';

import { useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, ListFilter, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { DetalheDaEntrega, DetalheDoArquivo } from './caminho-do-lead';
import { carregarCaminhoDoLead, CHAVE_DO_CAMINHO } from './dados';
import { BotaoPorNoAr } from './painel-canal-pro';
import { caminhoDoLead, type PassoDoCaminho } from './passos-do-caminho';

/** Os três passos da troca, com o nome curto da faixa. */
const PASSOS = [
  { id: 'entrega', curto: 'Leads no CRM' },
  { id: 'anuncios', curto: 'Anúncios no ar pelo CRM' },
  { id: 'arquivo', curto: 'Canal Pro lê o arquivo do CRM' },
] as const;

const GUARDADO = 'anuncios:troca-recolhida';
const semInscricao = () => () => {};
const lerRecolhida = () => {
  try {
    return sessionStorage.getItem(GUARDADO) === '1';
  } catch {
    return false;
  }
};

/**
 * A troca da Arbo pelo CRM (18/11/2026), no lugar do "Caminho até o primeiro
 * lead" de 5 passos. Mostra SÓ o passo atual, com a ação dele; os feitos viram um
 * ✓ na faixa. Os 7 anúncios da Arbo não são mais listados aqui (já estão na
 * lista, logo abaixo): "Ver na lista" filtra a lista. Os repetidos e o lead de
 * teste, que eram os passos 4 e 5, moram no "Precisa de você" e nos números.
 *
 * Quem decide cada passo continua sendo `passos-do-caminho.ts`, com o estado de
 * `public.anuncios_caminho_do_lead`. Com os três feitos, o bloco some.
 */
export function TrocaDaArbo({
  chave,
  noPortalSoPeloSistemaAtual,
  aoVerNaLista,
}: {
  chave: string | null;
  noPortalSoPeloSistemaAtual: number;
  aoVerNaLista: () => void;
}) {
  const consulta = useQuery({
    queryKey: CHAVE_DO_CAMINHO,
    queryFn: carregarCaminhoDoLead,
    refetchOnWindowFocus: true,
  });
  // Recolhida nesta aba? Lido do navegador; no servidor, aberta.
  const guardada = useSyncExternalStore(semInscricao, lerRecolhida, () => false);
  const [recolhida, setRecolhida] = useState<boolean | null>(null);
  const fechada = recolhida ?? guardada;
  function recolher(sim: boolean) {
    setRecolhida(sim);
    try {
      if (sim) sessionStorage.setItem(GUARDADO, '1');
      else sessionStorage.removeItem(GUARDADO);
    } catch {
      // Sem armazenamento (janela privada): só não lembra.
    }
  }

  if (consulta.isPending) return <Skeleton className="h-28 w-full rounded-xl" />;
  if (consulta.isError || !consulta.data) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        O passo da troca não carregou.
        <button
          type="button"
          onClick={() => void consulta.refetch()}
          className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
        >
          <RotateCw className="size-3.5" aria-hidden="true" />
          Tentar de novo
        </button>
      </p>
    );
  }

  const caminho = caminhoDoLead(consulta.data, new Date(), noPortalSoPeloSistemaAtual);
  const daTroca = PASSOS.map((p) => caminho.passos.find((x) => x.id === p.id) as PassoDoCaminho);
  const atual = daTroca.findIndex((p) => p.situacao === 'falta');
  if (atual < 0) return null;
  const passo = daTroca[atual]!;

  if (fechada) {
    return (
      <button
        type="button"
        onClick={() => recolher(false)}
        className="sombra-base flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-card px-4 py-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="font-medium">Troca da Arbo pelo CRM</span>
        <span className="text-muted-foreground">
          · passo {atual + 1} de {PASSOS.length}: {PASSOS[atual]!.curto}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
          Mostrar <ChevronDown className="size-4" aria-hidden="true" />
        </span>
      </button>
    );
  }

  return (
    <section
      aria-labelledby="troca-da-arbo"
      className="sombra-base flex flex-col gap-3.5 rounded-xl bg-card p-4 md:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Próximo passo
          </p>
          <h2 id="troca-da-arbo" className="font-heading text-lg font-semibold">
            Troca da Arbo pelo CRM
          </h2>
        </div>
        <Button variant="ghost" className="toque h-11 md:h-8" onClick={() => recolher(true)}>
          Ocultar
        </Button>
      </div>

      <ol className="flex flex-wrap gap-1.5" aria-label="Passos da troca">
        {PASSOS.map((p, i) => {
          const feito = daTroca[i]!.situacao !== 'falta';
          const agora = i === atual;
          return (
            <li
              key={p.id}
              aria-current={agora ? 'step' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-xs',
                agora
                  ? 'bg-primary/12 font-semibold text-foreground'
                  : feito
                    ? 'bg-muted text-cliente-texto'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'grid size-5 place-items-center rounded-full text-[11px] font-semibold',
                  agora
                    ? 'bg-primary text-primary-foreground'
                    : feito
                      ? 'bg-cliente-texto text-card'
                      : 'bg-card text-muted-foreground',
                )}
              >
                {feito && !agora ? <Check className="size-3" aria-hidden="true" /> : i + 1}
              </span>
              {p.curto}
              <span className="sr-only">{feito ? ' (feito)' : agora ? ' (agora)' : ''}</span>
            </li>
          );
        })}
      </ol>

      <div className="flex max-w-3xl flex-col gap-2.5 text-sm">
        <h3 className="text-[15px] font-medium">{passo.resumo}</h3>
        {passo.detalhe ? <p className="text-muted-foreground">{passo.detalhe}</p> : null}
        {passo.id === 'entrega' ? <DetalheDaEntrega passo={passo} /> : null}
        {passo.id === 'anuncios' ? (
          <div className="flex flex-col gap-2">
            {passo.cabem.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <BotaoPorNoAr
                  anuncios={passo.cabem}
                  aoPorTodos="Continuam no portal pela Arbo até o Canal Pro ler o arquivo do CRM (o próximo passo)."
                />
                <Button variant="outline" className="toque h-11 md:h-9" onClick={aoVerNaLista}>
                  <ListFilter aria-hidden="true" />
                  Ver {passo.cabem.length === 1 ? 'na lista' : `os ${passo.cabem.length} na lista`}
                </Button>
              </div>
            ) : null}
            {passo.esperamVaga.length > 0 ? (
              <p className="text-muted-foreground">
                Esperam vaga no plano:{' '}
                <span className="numerico">
                  {passo.esperamVaga.map((a) => a.codigo).join(' · ')}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
        {passo.id === 'arquivo' ? <DetalheDoArquivo passo={passo} chave={chave} /> : null}
      </div>
    </section>
  );
}
