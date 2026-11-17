'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ListChecks, RefreshCw, Users } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

import { mensagemDoErro } from '../consultas';
import type { PessoaDoSeletor } from '../tela-meu-dia';
import { AgendaDeHoje } from './agenda';
import { buscarPainel, PERIODOS, type PeriodoDoPainel } from './dados';
import { resumoDoCabecalho, ROTULO_DO_PERIODO } from './formatos';
import { CartaoDaIa, ImoveisEmAlta, PrecisaDeVoce } from './lateral';
import { LeadsNovos } from './leads';
import { NumerosDoTopo } from './numeros';

/**
 * O PAINEL DO DIA (17/11/2026): a aba inicial nova da Imova.
 *
 * Pedido do usuário: "Muitas informações hoje são inúteis. Preciso de uma aba
 * inicial mais amigável e que seja mais interessante". Escolhido com ele, por
 * protótipo: no alto os três números (leads novos, visitas marcadas, negócios
 * fechados); à esquerda a agenda de hoje com a foto do imóvel e os leads novos;
 * à direita o que a IA fez, um "Precisa de você" com até 5 itens e os imóveis em
 * alta. A lista completa de antes continua em `/meu-dia?aba=fazer` ("Ver todas").
 *
 * Uma leitura só (`public.meu_dia_painel`). O período (hoje, 7 dias, mês) muda os
 * números, a IA e os leads; a pessoa do seletor muda a agenda e as pendências.
 */
export function PainelDoDia({
  nome,
  saudacao,
  data,
  usuarioId,
  hoje,
  pessoas,
  pessoaInicial,
}: {
  nome: string | null;
  saudacao: string;
  data: string;
  usuarioId: string;
  hoje: string;
  pessoas: readonly PessoaDoSeletor[];
  pessoaInicial: string;
}) {
  const [periodo, setPeriodo] = useState<PeriodoDoPainel>('hoje');
  const [pessoa, setPessoa] = useState<string>(pessoaInicial);
  const agora = useAgora();
  const doProprio = pessoa === usuarioId;

  // A pessoa mora na URL, como no Meu dia de antes: voltar da conversa devolve o dia certo.
  useEffect(() => {
    const busca = new URLSearchParams(window.location.search);
    if (doProprio) busca.delete('pessoa');
    else busca.set('pessoa', pessoa);
    const texto = busca.toString();
    const destino = `${window.location.pathname}${texto ? `?${texto}` : ''}`;
    if (destino !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', destino);
    }
  }, [pessoa, doProprio]);

  const painel = useQuery({
    queryKey: ['meu-dia', 'painel', periodo, pessoa],
    queryFn: () => buscarPainel(periodo, doProprio ? undefined : pessoa),
    refetchInterval: 60_000,
    placeholderData: (anterior) => anterior,
  });
  const dados = painel.data;
  const visitasHoje = dados?.agenda.filter((v) => !v.feito).length ?? 0;
  const resumo = dados ? resumoDoCabecalho(visitasHoje, dados.ia, periodo) : [];
  const nomeDaPessoa = pessoas.find((p) => p.id === pessoa)?.nome ?? null;

  return (
    <div className="flex w-full flex-col gap-4 sm:gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-[26px] leading-tight font-semibold tracking-[-0.01em] sm:text-[30px]">
            {saudacao}
            {nome ? `, ${nome}` : ''}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground sm:text-[14.5px]">
            <span>{data}</span>
            {resumo.map((parte) => (
              <span key={parte} className="flex items-center gap-2">
                <span aria-hidden="true" className="size-1 rounded-full bg-muted-foreground/60" />
                {parte}
              </span>
            ))}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:flex-wrap">
          <div
            role="group"
            aria-label="Período dos números"
            className="inline-flex rounded-[10px] bg-muted p-[3px]"
          >
            {PERIODOS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={periodo === p}
                onClick={() => setPeriodo(p)}
                className={cn(
                  'toque h-9 rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition-colors sm:h-8',
                  periodo === p && 'sombra-base bg-card text-foreground',
                )}
              >
                {ROTULO_DO_PERIODO[p]}
              </button>
            ))}
          </div>
          {pessoas.length > 1 ? (
            <Select value={pessoa} onValueChange={setPessoa}>
              <SelectTrigger
                className="toque h-10 min-w-28 bg-card sm:h-9 sm:min-w-36"
                aria-label="De quem é a agenda"
              >
                <span className="flex min-w-0 items-center gap-2 text-foreground">
                  <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent>
                {pessoas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.id === usuarioId ? 'Você' : p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Link
            href="/meu-dia?aba=fazer"
            className="toque inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-border bg-card px-2.5 text-[13px] font-medium text-foreground hover:bg-muted/60 sm:h-9 sm:px-3"
            title="A lista completa de pendências, feitos e próximos dias"
          >
            <ListChecks className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Lista completa</span>
          </Link>
        </div>
      </header>

      {painel.isError && !dados ? (
        <div className="sombra-base flex flex-col items-start gap-3 rounded-xl bg-card p-5">
          <p className="text-sm">{mensagemDoErro(painel.error)}</p>
          <Button variant="outline" onClick={() => void painel.refetch()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Tentar de novo
          </Button>
        </div>
      ) : !dados ? (
        <Esqueleto />
      ) : (
        <>
          {dados.numeros ? (
            <NumerosDoTopo numeros={dados.numeros} periodo={periodo} hoje={hoje} />
          ) : null}

          <div className="grid items-start gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
              <AgendaDeHoje agenda={dados.agenda} agora={agora} deOutraPessoa={!doProprio} />
              {/* No celular, o que precisa da pessoa sobe para logo depois da agenda. */}
              <div className="lg:hidden">
                <PrecisaDeVoce
                  total={dados.precisa.total}
                  itens={dados.precisa.itens}
                  agora={agora}
                />
              </div>
              {dados.leads && dados.numeros ? (
                <LeadsNovos
                  leads={dados.leads}
                  total={dados.numeros.leads.agora}
                  periodo={periodo}
                  agora={agora}
                />
              ) : null}
            </div>
            <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
              {dados.ia ? <CartaoDaIa ia={dados.ia} periodo={periodo} agora={agora} /> : null}
              <div className="hidden lg:block">
                <PrecisaDeVoce
                  total={dados.precisa.total}
                  itens={dados.precisa.itens}
                  agora={agora}
                />
              </div>
              {dados.imoveis ? <ImoveisEmAlta imoveis={dados.imoveis} /> : null}
            </div>
          </div>

          {!doProprio ? (
            <p className="text-xs text-muted-foreground">
              A agenda e o &quot;Precisa de você&quot; são de {nomeDaPessoa ?? 'outra pessoa'}; os
              números, a IA e os leads são da Imova inteira.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** O relógio da tela: os "há 25 min" e "em 1 h 20" andam sozinhos, a cada minuto. */
function useAgora(): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return agora;
}

function Esqueleto() {
  return (
    <div aria-busy="true" aria-label="Carregando o painel" className="flex flex-col gap-4 sm:gap-5">
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl sm:h-40" />
        ))}
      </div>
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 sm:gap-5">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-60 rounded-xl" />
        </div>
        <div className="flex flex-col gap-4 sm:gap-5">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
