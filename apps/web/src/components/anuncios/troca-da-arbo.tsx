'use client';

import { useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Check, ChevronDown, ListFilter, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { DetalheDaEntrega, DetalheDoArquivo } from './caminho-do-lead';
import { carregarCaminhoDoLead, CHAVE_DO_CAMINHO } from './dados';
import { BotaoPorNoAr } from './painel-canal-pro';
import { caminhoDoLead, type PassoDoCaminho, type PinoAntesDeColar } from './passos-do-caminho';

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

/** Onde a troca está: o painel Pendências conta com ela e mostra a linha. */
export type Troca =
  | { estado: 'carregando' }
  | { estado: 'erro'; tentarDeNovo: () => void }
  | { estado: 'feita' }
  | {
      estado: 'passo';
      /** O índice do passo atual (0 a 2). */
      atual: number;
      daTroca: PassoDoCaminho[];
      /** O robô do Grupo OLX já leu o arquivo do CRM alguma vez. */
      lido: boolean;
    };

/**
 * A troca da Arbo pelo CRM (18/11/2026), no lugar do "Caminho até o primeiro
 * lead" de 5 passos. Quem decide cada passo continua sendo
 * `passos-do-caminho.ts`, com o estado de `public.anuncios_caminho_do_lead`.
 * Com os três feitos, a troca sai do painel Pendências.
 */
export function useTrocaDaArbo(noPortalSoPeloSistemaAtual: number, pino: PinoAntesDeColar): Troca {
  const consulta = useQuery({
    queryKey: CHAVE_DO_CAMINHO,
    queryFn: carregarCaminhoDoLead,
    refetchOnWindowFocus: true,
  });
  if (consulta.isPending) return { estado: 'carregando' };
  if (consulta.isError || !consulta.data) {
    return { estado: 'erro', tentarDeNovo: () => void consulta.refetch() };
  }
  const caminho = caminhoDoLead(consulta.data, new Date(), noPortalSoPeloSistemaAtual, pino);
  const daTroca = PASSOS.map((p) => caminho.passos.find((x) => x.id === p.id) as PassoDoCaminho);
  const atual = daTroca.findIndex((p) => p.situacao === 'falta');
  if (atual < 0) return { estado: 'feita' };
  return {
    estado: 'passo',
    atual,
    daTroca,
    lido: consulta.data.arquivo.leituraDoRobo !== null,
  };
}

/**
 * A linha da troca dentro do painel Pendências (24/11/2026): SÓ o passo atual,
 * com a ação dele; os feitos viram um ✓ na faixa. Os anúncios da Arbo não são
 * listados aqui (já estão na lista, logo abaixo): "Ver na lista" filtra a lista.
 * "Ocultar" recolhe a linha nesta aba do navegador.
 */
export function LinhaDaTroca({
  troca,
  chave,
  aoVerNaLista,
}: {
  troca: Exclude<Troca, { estado: 'carregando' | 'feita' }>;
  chave: string | null;
  aoVerNaLista: () => void;
}) {
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

  if (troca.estado === 'erro') {
    return (
      <li className="flex flex-wrap items-center gap-2 py-3 text-sm text-muted-foreground">
        O passo da troca não carregou.
        <button
          type="button"
          onClick={troca.tentarDeNovo}
          className="inline-flex min-h-10 items-center gap-1 text-foreground underline underline-offset-4"
        >
          <RotateCw className="size-3.5" aria-hidden="true" />
          Tentar de novo
        </button>
      </li>
    );
  }

  const { atual, daTroca, lido } = troca;
  const passo = daTroca[atual]!;

  if (fechada) {
    return (
      <li className="py-1.5">
        <button
          type="button"
          onClick={() => recolher(false)}
          className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="font-medium">Troca da Arbo pelo CRM</span>
          <span className="text-muted-foreground">
            · passo {atual + 1} de {PASSOS.length}: {PASSOS[atual]!.curto}
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
            Mostrar <ChevronDown className="size-4" aria-hidden="true" />
          </span>
        </button>
      </li>
    );
  }

  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 py-3 lg:grid-cols-[2.5rem_minmax(0,1fr)_auto] lg:items-start">
      <span className="row-span-2 grid size-10 place-items-center rounded-lg bg-primary/12 text-primary lg:row-span-1">
        <ArrowUpRight className="size-4" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Próximo passo
          </p>
          <h3 className="text-[15px] font-semibold">Troca da Arbo pelo CRM</h3>
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
                  'inline-flex h-7 items-center gap-1.5 rounded-full pr-2.5 pl-1 text-xs',
                  agora
                    ? 'bg-primary/12 font-semibold text-primary'
                    : feito
                      ? 'bg-cliente-fundo font-medium text-cliente-texto'
                      : 'bg-muted font-medium text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'grid size-5 place-items-center rounded-full text-[11px] font-bold',
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
        <div className="flex max-w-3xl flex-col gap-2 text-[13px]">
          <p>
            <span className="font-medium">{passo.resumo}.</span>
            {passo.detalhe ? <span className="text-muted-foreground"> {passo.detalhe}</span> : null}
          </p>
          {passo.id === 'entrega' ? <DetalheDaEntrega passo={passo} /> : null}
          {passo.id === 'anuncios' && passo.esperamVaga.length > 0 ? (
            <p className="text-muted-foreground">
              Esperam vaga no plano:{' '}
              <span className="numerico">{passo.esperamVaga.map((a) => a.codigo).join(' · ')}</span>
            </p>
          ) : null}
          {passo.id === 'anuncios' && passo.depoisDaTroca.length > 0 ? (
            <p className="text-muted-foreground">
              Ficam para depois da troca (não estão no portal hoje):{' '}
              <span className="numerico">
                {passo.depoisDaTroca.map((a) => a.codigo).join(' · ')}
              </span>
            </p>
          ) : null}
          {passo.id === 'arquivo' ? <DetalheDoArquivo passo={passo} chave={chave} /> : null}
        </div>
      </div>
      <div className="col-start-2 mt-1.5 flex flex-wrap gap-2 lg:col-start-3 lg:mt-0 lg:justify-end">
        {passo.id === 'anuncios' && passo.cabem.length > 0 ? (
          <>
            <BotaoPorNoAr
              anuncios={passo.cabem}
              aoPorTodos={
                lido
                  ? 'Entram no portal na próxima leitura do Grupo OLX.'
                  : 'Continuam no portal pela Arbo até o Canal Pro ler o arquivo do CRM (o próximo passo).'
              }
            />
            <Button variant="outline" className="toque h-11 md:h-9" onClick={aoVerNaLista}>
              <ListFilter aria-hidden="true" />
              Ver {passo.cabem.length === 1 ? 'na lista' : `os ${passo.cabem.length} na lista`}
            </Button>
          </>
        ) : null}
        <Button variant="ghost" className="toque h-11 md:h-9" onClick={() => recolher(true)}>
          Ocultar
        </Button>
      </div>
    </li>
  );
}
