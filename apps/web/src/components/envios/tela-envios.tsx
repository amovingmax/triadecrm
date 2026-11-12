'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Megaphone, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Catalogos } from '@/components/parceiros/tipos';

import { buscarTetoDeHoje, ErroDoEnvio, listarEnvios, type TetoDeHoje } from './dados';
import { formatarNumero, fraseDaRecusa, progresso, rotuloDaMensagem } from './formatos';
import { NovoEnvio } from './novo-envio';
import { Numeros, PainelDoEnvio } from './painel-do-envio';
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
    <div className="flex w-full flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
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
          <Button variant="ghost" className="toque h-11 md:h-9" onClick={() => setMontando(false)}>
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
        <ul className="grid gap-3 md:grid-cols-2">
          {(envios.data ?? []).map((e) => (
            <li key={e.id} className="min-w-0">
              <CartaoDoEnvio envio={e} aoAbrir={() => setAberto(e.id)} />
            </li>
          ))}
        </ul>
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
 */
function CotaDeHoje({ cota }: { cota: TetoDeHoje }) {
  const usado = cota.teto > 0 ? Math.min(cota.usados / cota.teto, 1) : 1;
  return (
    <section
      aria-labelledby="cota-de-hoje"
      className="sombra-base flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl bg-card p-4 md:p-5"
    >
      <div className="min-w-0 flex-1 space-y-2">
        <h2 id="cota-de-hoje" className="text-sm font-semibold">
          Limite de hoje
        </h2>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="numerico text-2xl font-semibold">{formatarNumero(cota.sobra)}</span>
          <span className="text-sm text-muted-foreground">
            {cota.sobra === 1 ? 'mensagem ainda cabe' : 'mensagens ainda cabem'} ·{' '}
            <span className="numerico">{formatarNumero(cota.usados)}</span> de{' '}
            <span className="numerico">{formatarNumero(cota.teto)}</span> usadas
          </span>
        </p>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={cota.teto}
          aria-valuenow={cota.usados}
          aria-label="Usado do limite de hoje"
        >
          <div className="h-full rounded-full bg-menta transition-all" style={{ width: `${usado * 100}%` }} />
        </div>
      </div>
      <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
        {cota.quemManda === 'meta'
          ? `O limite é o que a Meta dá ao número${cota.qualidade ? `, com a nota ${QUALIDADE_EM_PT[cota.qualidade] ?? cota.qualidade.toLowerCase()}` : ''} (nota amarela corta pela metade).`
          : 'O limite é o do próprio CRM (o aquecimento de um número novo, ou o teto configurado), abaixo do que a Meta dá ao número.'}{' '}
        {cota.naFila > 0 ? (
          <>
            <span className="numerico">{formatarNumero(cota.naFila)}</span> já estão na fila dos disparos
            em curso.{' '}
          </>
        ) : null}
        Conta toda conversa que a empresa começa hoje, de qualquer tela.
      </p>
    </section>
  );
}

const COR_DO_STATUS: Record<StatusDoEnvio, string> = {
  agendado: 'bg-muted text-foreground',
  enviando: 'bg-primary text-primary-foreground',
  pausado: 'bg-muted text-muted-foreground',
  parado: 'bg-destructive/15 text-destructive',
  concluido: 'bg-primary/10 text-foreground',
  cancelado: 'bg-muted text-muted-foreground',
};

function CartaoDoEnvio({ envio, aoAbrir }: { envio: Envio; aoAbrir: () => void }) {
  const p = progresso(envio.contagem);
  return (
    <button
      type="button"
      onClick={aoAbrir}
      className="sombra-base w-full space-y-3 rounded-xl bg-card p-5 text-left transition-shadow hover:sombra-base-forte"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{envio.nome}</p>
          <p className="truncate text-xs text-muted-foreground">
            {rotuloDaMensagem(envio.modelo)} · {envio.por_hora}/h · {envio.criado_por ?? '—'}
          </p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', COR_DO_STATUS[envio.status])}>
          {STATUS_DO_ENVIO[envio.status]}
        </span>
      </div>
      {/* O andamento em MENTA: é o acento do sistema dizendo "quanto já andou". */}
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`${Math.round(p * 100)}% decidido`}>
        <div className="h-full rounded-full bg-menta transition-all" style={{ width: `${p * 100}%` }} />
      </div>
      <Numeros c={envio.contagem} compacto />
      {envio.status === 'parado' && envio.motivo_parada ? (
        <p className="text-xs text-destructive">{envio.motivo_parada}</p>
      ) : null}
    </button>
  );
}
