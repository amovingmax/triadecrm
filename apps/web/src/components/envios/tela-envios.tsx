'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Catalogos } from '@/components/parceiros/tipos';

import { ErroDoEnvio, listarEnvios } from './dados';
import { fraseDaRecusa, progresso } from './formatos';
import { NovoEnvio } from './novo-envio';
import { Numeros, PainelDoEnvio } from './painel-do-envio';
import { STATUS_DO_ENVIO, type Envio, type StatusDoEnvio } from './tipos';

/**
 * Envios em massa pelo WhatsApp (decisão do Rafael, 21/09/2026).
 *
 * A tela tem dois estados: a lista dos envios, com o andamento de cada um, e o
 * assistente de um envio novo. O envio em si nunca acontece aqui: criar grava
 * a fila, e o relógio do banco manda uma por vez, pela mesma porteira do botão
 * da conversa.
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
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Envios em massa</h1>
          <p className="text-sm text-muted-foreground">
            Uma mensagem para muita gente, no ritmo de uma pessoa: aos poucos, assinada, e com parada
            automática se começarem a bloquear.
          </p>
        </div>
        {!montando ? (
          <Button className="toque h-11 md:h-9" onClick={() => setMontando(true)}>
            <Plus aria-hidden="true" />
            Novo envio
          </Button>
        ) : null}
      </header>

      {montando ? (
        <div className="rounded-2xl border border-hairline bg-background p-4 md:p-5">
          <NovoEnvio
            catalogos={catalogos}
            aoCancelar={() => setMontando(false)}
            aoCriar={(id) => {
              setMontando(false);
              setAberto(id);
            }}
          />
        </div>
      ) : envios.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : envios.isError ? (
        <p className="text-sm text-destructive">
          {envios.error instanceof ErroDoEnvio ? fraseDaRecusa(envios.error.motivo) : 'Não deu para ler os envios.'}
        </p>
      ) : (envios.data ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-hairline py-14 text-center">
          <Megaphone className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Nenhum envio ainda. Escolha um público, uma mensagem e o ritmo, e o CRM cuida do resto.
          </p>
          <Button className="toque h-11 md:h-9" onClick={() => setMontando(true)}>
            <Plus aria-hidden="true" />
            Montar o primeiro envio
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
      className="w-full space-y-3 rounded-2xl border border-hairline bg-card p-4 text-left transition-colors hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{envio.nome}</p>
          <p className="truncate text-xs text-muted-foreground">
            {envio.modelo ?? 'Texto livre'} · {envio.por_hora}/h · {envio.criado_por ?? '—'}
          </p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', COR_DO_STATUS[envio.status])}>
          {STATUS_DO_ENVIO[envio.status]}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`${Math.round(p * 100)}% decidido`}>
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${p * 100}%` }} />
      </div>
      <Numeros c={envio.contagem} compacto />
      {envio.status === 'parado' && envio.motivo_parada ? (
        <p className="text-xs text-destructive">{envio.motivo_parada}</p>
      ) : null}
    </button>
  );
}
