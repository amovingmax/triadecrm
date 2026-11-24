'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Megaphone, Pause, Play, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { NotaRecolhida } from '@/components/ui/nota-recolhida';
import type { Catalogos } from '@/components/parceiros/tipos';

import { buscarTetoDeHoje, ErroDoEnvio, listarEnvios, type TetoDeHoje } from './dados';
import { formatarNumero, fraseDaRecusa, progresso, rotuloDaMensagem } from './formatos';
import { NovoEnvio } from './novo-envio';
import { Numeros, PainelDoEnvio, useMudarEnvio } from './painel-do-envio';
import { STATUS_DO_ENVIO, type Envio, type StatusDoEnvio } from './tipos';

/**
 * Disparos: envios em massa pelo WhatsApp (decisão do Rafael, 21/09/2026;
 * "Campanhas" e tela única desde a Fase 5; "Disparos", de volta ao menu, desde
 * 12/11/2026).
 *
 * A tela tem dois estados: a lista dos disparos, com o andamento de cada um e o
 * limite de hoje no topo, e a montagem de um novo, numa página só, com o
 * celular ao lado (protótipo B, 12/11/2026). O envio em si nunca acontece aqui:
 * criar grava a fila, e o relógio do banco manda no ritmo escolhido, pela
 * mesma porteira do botão da conversa.
 */
export function TelaEnvios({ catalogos, criaModelo }: { catalogos: Catalogos; criaModelo: boolean }) {
  const [montando, setMontando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  const envios = useQuery({
    queryKey: ['envios', 'lista'],
    queryFn: listarEnvios,
    refetchInterval: (q) =>
      (q.state.data ?? []).some((e) => ['agendado', 'enviando'].includes(e.status)) ? 20_000 : false,
  });
  const teto = useQuery({
    queryKey: ['envios', 'teto'],
    queryFn: buscarTetoDeHoje,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  return (
    // A MESMA COLUNA E O MESMO TÍTULO DAS OUTRAS TELAS (29/09/2026).
    <div className="flex w-full flex-col gap-4">
      {/* No celular o botão desce para baixo do texto (16/11/2026): ao lado, ele
          espremia a frase numa coluna de 200px, em cinco linhas, e quebrava "Novo
          disparo" em duas. O "Voltar" sobe para cima do título, onde se procura a
          volta. De `sm` para cima, título à esquerda e botão à direita, como era. */}
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <h1 className="font-heading text-[32px] leading-tight font-normal tracking-[-0.02em]">
            {montando ? 'Novo disparo' : 'Disparos'}
          </h1>
          <p className="max-w-[90ch] text-sm text-muted-foreground">
            {montando
              ? 'Uma mensagem de WhatsApp para várias pessoas de uma vez.'
              : 'Uma mensagem para muitos parceiros: você escolhe para quem, o que e quantos, e o CRM manda no ritmo escolhido, com parada automática.'}
          </p>
        </div>
        {montando ? (
          <Button
            variant="ghost"
            className="toque h-11 max-sm:order-first max-sm:-mb-2 max-sm:-ml-2 md:h-9"
            onClick={() => setMontando(false)}
          >
            <ArrowLeft aria-hidden="true" />
            Voltar aos disparos
          </Button>
        ) : (
          <Button className="toque h-11 md:h-9" onClick={() => setMontando(true)}>
            <Plus aria-hidden="true" />
            Novo disparo
          </Button>
        )}
      </header>

      {!montando && teto.data ? <CotaDeHoje cota={teto.data} /> : null}

      {montando ? (
        <NovoEnvio
          catalogos={catalogos}
          criaModelo={criaModelo}
          aoCriar={(id) => {
            setMontando(false);
            setAberto(id);
          }}
        />
      ) : envios.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : envios.isError ? (
        <p className="text-sm text-destructive">
          {envios.error instanceof ErroDoEnvio ? fraseDaRecusa(envios.error.motivo) : 'Não deu para ler os disparos.'}
        </p>
      ) : (envios.data ?? []).length === 0 ? (
        <div className="sombra-base flex flex-col items-center gap-3 rounded-xl bg-card px-6 py-14 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
            <Megaphone className="size-5" aria-hidden="true" strokeWidth={1.75} />
          </span>
          <div className="space-y-1">
            <p className="font-medium">Nenhum disparo ainda.</p>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              Escolha para quem, a mensagem e quantos, e o CRM cuida do resto. Quem responder cai nas
              Conversas.
            </p>
          </div>
          <Button className="toque h-11 md:h-9" onClick={() => setMontando(true)}>
            <Plus aria-hidden="true" />
            Montar o primeiro disparo
          </Button>
        </div>
      ) : (
        // UM DISPARO POR LINHA, em qualquer largura (24/11/2026). Em duas colunas,
        // o cartão de meia largura do tablet espremia os cinco números até o rótulo
        // quebrar letra por letra.
        <section aria-labelledby="lista-de-disparos" className="flex flex-col gap-3">
          <h2
            id="lista-de-disparos"
            className="text-xs font-bold tracking-[0.07em] text-muted-foreground uppercase"
          >
            Disparos
          </h2>
          <ul className="flex flex-col gap-3">
            {(envios.data ?? []).map((e) => (
              <li key={e.id} className="min-w-0">
                <CartaoDoEnvio envio={e} aoAbrir={() => setAberto(e.id)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <PainelDoEnvio id={aberto} aoFechar={() => setAberto(null)} />
    </div>
  );
}

const QUALIDADE_EM_PT: Record<string, string> = {
  GREEN: 'verde',
  YELLOW: 'amarela',
  RED: 'vermelha',
  UNKNOWN: 'desconhecida',
};

/**
 * O limite de hoje, à vista antes de montar qualquer coisa: quanto a Meta dá ao
 * número, quanto já foi usado (toda conversa que a empresa abriu hoje, de
 * qualquer tela) e quanto sobra. É a resposta a "quantos ainda posso mandar?".
 *
 * O número que sobra fica grande e a conta de onde ele sai fica recolhida em
 * "Como o limite é contado" (24/11/2026): aberta, ela ocupava meia tela do
 * celular com uma explicação que se lê uma vez.
 */
function CotaDeHoje({ cota }: { cota: TetoDeHoje }) {
  const usado = cota.teto > 0 ? Math.min(cota.usados / cota.teto, 1) : 1;
  return (
    <section
      aria-labelledby="cota-de-hoje"
      className="sombra-base flex flex-col gap-2 rounded-xl bg-card p-4 md:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="cota-de-hoje" className="font-heading text-[17px] font-bold tracking-[-0.01em]">
          Limite de hoje
        </h2>
        <span className="text-[13px] text-muted-foreground">
          <span className="numerico">{formatarNumero(cota.usados)}</span> de{' '}
          <span className="numerico">{formatarNumero(cota.teto)}</span> usadas
        </span>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="numerico font-heading text-[30px] leading-tight font-bold">
          {formatarNumero(cota.sobra)}
        </span>
        <span className="text-sm text-muted-foreground">
          {cota.sobra === 1 ? 'mensagem ainda cabe hoje' : 'mensagens ainda cabem hoje'}
        </span>
      </p>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={cota.teto}
        aria-valuenow={cota.usados}
        aria-label="Usado do limite de hoje"
      >
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${usado * 100}%` }} />
      </div>
      <NotaRecolhida titulo="Como o limite é contado" className="border-t-0 pt-1 text-sm">
        <p className="pl-[18px] text-[13px]">
          {cota.quemManda === 'meta'
            ? `O limite é o que a Meta dá ao número${cota.qualidade ? `, com a nota ${QUALIDADE_EM_PT[cota.qualidade] ?? cota.qualidade.toLowerCase()}` : ''} (nota amarela corta pela metade).`
            : 'O limite é o do próprio CRM (o aquecimento de um número novo, ou o teto configurado), abaixo do que a Meta dá ao número.'}{' '}
          {cota.naFila > 0 ? (
            <>
              <span className="numerico">{formatarNumero(cota.naFila)}</span> já estão na fila dos
              disparos em curso.{' '}
            </>
          ) : null}
          Conta toda conversa que a empresa começa hoje, de qualquer tela.
        </p>
      </NotaRecolhida>
    </section>
  );
}

// A situação ao lado do título. Enviando é o único estado com tinta e com a
// bolinha de "está andando"; concluído é só o contorno, para não competir com o
// que ainda pede atenção (parado pela proteção, em brasa).
const COR_DO_STATUS: Record<StatusDoEnvio, string> = {
  agendado: 'bg-muted text-foreground',
  enviando: 'bg-primary/12 text-primary',
  pausado: 'bg-muted text-muted-foreground',
  parado: 'bg-destructive/10 text-destructive-texto',
  concluido: 'border border-border text-foreground',
  cancelado: 'bg-muted text-muted-foreground',
};

function CartaoDoEnvio({ envio, aoAbrir }: { envio: Envio; aoAbrir: () => void }) {
  const p = progresso(envio.contagem);
  const mudar = useMudarEnvio();
  const andando = ['agendado', 'enviando'].includes(envio.status);
  const parado = ['pausado', 'parado'].includes(envio.status);
  const total = envio.contagem.total;
  const detalhe = [
    rotuloDaMensagem(envio.modelo),
    `${formatarNumero(total)} ${total === 1 ? 'pessoa' : 'pessoas'}`,
    `ritmo de ${formatarNumero(envio.por_hora)} por hora`,
    envio.criado_por,
  ].filter(Boolean);

  return (
    // O cartão inteiro continua abrindo o painel, como quando era um botão só; os
    // botões de dentro fazem a própria ação. Pelo teclado, "Ver quem recebeu" é a
    // mesma porta.
    <article
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a')) return;
        aoAbrir();
      }}
      className="@container sombra-base flex cursor-pointer flex-col gap-3 rounded-xl bg-card p-4 transition-shadow hover:sombra-base-forte"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* Até duas linhas: cortado em uma, "Retomar o contato: 3 dias sem r…" não
              dizia qual dos disparos de retomada era. */}
          <h3 className="line-clamp-2 text-[15.5px] leading-[1.35] font-semibold" title={envio.nome}>
            {envio.nome}
          </h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{detalhe.join(' · ')}</p>
        </div>
        <span
          className={cn(
            'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap',
            COR_DO_STATUS[envio.status],
          )}
        >
          {envio.status === 'enviando' ? (
            <span className="size-[7px] rounded-full bg-current" aria-hidden="true" />
          ) : null}
          {STATUS_DO_ENVIO[envio.status]}
        </span>
      </div>
      {/* O andamento: em laranja quando acabou, na cor da ação enquanto anda. */}
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`${Math.round(p * 100)}% decidido`}>
        <div
          className={cn(
            'h-full rounded-full transition-all',
            envio.status === 'concluido' ? 'bg-menta' : 'bg-primary',
          )}
          style={{ width: `${p * 100}%` }}
        />
      </div>
      <Numeros c={envio.contagem} compacto />
      {envio.status === 'parado' && envio.motivo_parada ? (
        <p className="text-xs text-destructive">{envio.motivo_parada}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {andando ? (
          <Button
            variant="outline"
            className="toque h-11 md:h-10"
            disabled={mudar.isPending}
            onClick={() => mudar.mutate({ id: envio.id, acao: 'pausar' })}
          >
            <Pause aria-hidden="true" />
            Pausar
          </Button>
        ) : null}
        {parado ? (
          <Button
            variant="outline"
            className="toque h-11 md:h-10"
            disabled={mudar.isPending}
            onClick={() => mudar.mutate({ id: envio.id, acao: 'retomar' })}
          >
            <Play aria-hidden="true" />
            Retomar
          </Button>
        ) : null}
        <Button
          variant="ghost"
          // Sozinho na linha, o texto alinha com o resto do cartão.
          className={cn('toque h-11 px-3 md:h-10', !andando && !parado && '-ml-3')}
          onClick={aoAbrir}
          aria-label={`Ver quem recebeu o disparo ${envio.nome}`}
        >
          Ver quem recebeu
          {!andando && !parado ? <ChevronRight aria-hidden="true" /> : null}
        </Button>
      </div>
    </article>
  );
}
