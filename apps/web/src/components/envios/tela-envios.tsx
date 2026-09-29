'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Catalogos } from '@/components/parceiros/tipos';

import { ErroDoEnvio, listarEnvios } from './dados';
import { fraseDaRecusa, progresso, rotuloDaMensagem } from './formatos';
import { NovoEnvio } from './novo-envio';
import { Numeros, PainelDoEnvio } from './painel-do-envio';
import { STATUS_DO_ENVIO, type Envio, type StatusDoEnvio } from './tipos';

/**
 * Campanhas: envios em massa pelo WhatsApp (decisão do Rafael, 21/09/2026;
 * "Campanhas" e tela única desde a Fase 5).
 *
 * A tela tem dois estados: a lista das campanhas, com o andamento de cada uma,
 * e a montagem de uma nova, numa página só. O envio em si nunca acontece aqui:
 * criar grava a fila, e o relógio do banco manda uma por vez, pela mesma
 * porteira do botão da conversa.
 */
export function TelaEnvios({ catalogos }: { catalogos: Catalogos }) {
  const [montando, setMontando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  const envios = useQuery({
    queryKey: ['envios', 'lista'],
    queryFn: listarEnvios,
    refetchInterval: (q) =>
      (q.state.data ?? []).some((e) => ['agendado', 'enviando'].includes(e.status)) ? 20_000 : false,
  });

  return (
    // A MESMA COLUNA E O MESMO TÍTULO DAS OUTRAS TELAS (29/09/2026). Campanhas
    // era a única com casca própria — `max-w-6xl` centralizado e padding de novo,
    // por dentro do padding da casca — e com título de 24px em negrito: trocar
    // de tela para cá fazia o título pular 112px para a direita e mudar de peso.
    <div className="flex w-full flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-[32px] leading-tight font-normal tracking-[-0.02em]">
            {montando ? 'Nova campanha' : 'Campanhas'}
          </h1>
          {!montando ? (
            <p className="max-w-[90ch] text-sm text-muted-foreground">
              Um cumprimento para muitos parceiros, aos poucos e com parada automática.
            </p>
          ) : null}
        </div>
        {!montando ? (
          <Button className="toque h-11 md:h-9" onClick={() => setMontando(true)}>
            <Plus aria-hidden="true" />
            Nova campanha
          </Button>
        ) : null}
      </header>

      {montando ? (
        <NovoEnvio
          catalogos={catalogos}
          aoCancelar={() => setMontando(false)}
          aoCriar={(id) => {
            setMontando(false);
            setAberto(id);
          }}
        />
      ) : envios.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : envios.isError ? (
        <p className="text-sm text-destructive">
          {envios.error instanceof ErroDoEnvio ? fraseDaRecusa(envios.error.motivo) : 'Não deu para ler as campanhas.'}
        </p>
      ) : (envios.data ?? []).length === 0 ? (
        <div className="sombra-base flex flex-col items-center gap-3 rounded-xl bg-card px-6 py-14 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
            <Megaphone className="size-5" aria-hidden="true" strokeWidth={1.75} />
          </span>
          <div className="space-y-1">
            <p className="font-medium">Nenhuma campanha ainda.</p>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              Escolha para quem e a mensagem, e o CRM cuida do resto. Quem responder cai nas
              Conversas.
            </p>
          </div>
          <Button className="toque h-11 md:h-9" onClick={() => setMontando(true)}>
            <Plus aria-hidden="true" />
            Montar a primeira campanha
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {(envios.data ?? []).map((e) => (
            <li key={e.id}>
              <CartaoDoEnvio envio={e} aoAbrir={() => setAberto(e.id)} />
            </li>
          ))}
        </ul>
      )}

      <PainelDoEnvio id={aberto} aoFechar={() => setAberto(null)} />
    </div>
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
      {/* O andamento em MENTA, como a barra dos tetos nas Cadências: é o acento
          do sistema dizendo "quanto já andou". */}
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
