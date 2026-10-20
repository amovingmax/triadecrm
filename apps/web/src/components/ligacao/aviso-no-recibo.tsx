'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, CheckCheck, Clock, MessageCircle, SquareArrowOutUpRight } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

import {
  estadoDoAviso,
  RPC_AVISO_CANCELAR,
  RPC_AVISO_SITUACAO,
  situacaoDoAvisoSchema,
  type EstadoDoAviso,
  type SituacaoDoAviso,
} from './aviso-no-whatsapp';

async function lerSituacao(tentativaId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(RPC_AVISO_SITUACAO, { p_attempt_id: tentativaId });
  if (error) throw error;
  const lido = situacaoDoAvisoSchema.safeParse(data);
  // Recusa (sem permissão, tentativa sumida) ou formato novo: o recibo só não fala do aviso.
  return lido.success ? lido.data : null;
}

async function cancelar(tentativaId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(RPC_AVISO_CANCELAR, { p_attempt_id: tentativaId });
  if (error) throw error;
  return data as { ok: boolean; motivo?: string } | null;
}

const chaveDoAviso = (tentativaId: string) => ['ligacao', 'aviso', tentativaId] as const;

/**
 * A fila do aviso anda a cada minuto (pg_cron), e a entrega volta da Meta em
 * segundos: perguntar a cada 5 s enquanto ainda vai mudar é o que faz o selo
 * passar de "Na fila" a "Enviado", "Entregue" e "Lido" com a tela aberta.
 */
function useSituacaoDoAviso(tentativaId: string) {
  return useQuery({
    queryKey: chaveDoAviso(tentativaId),
    queryFn: () => lerSituacao(tentativaId),
    refetchInterval: (q) => {
      const s = q.state.data;
      return s && estadoDoAviso(s)?.andando ? 5_000 : false;
    },
  });
}

const HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza',
  hour: '2-digit',
  minute: '2-digit',
});

function abrirConversa(organizationId: string | null | undefined) {
  if (!organizationId) return;
  // Outra aba: a fila de ligações fica onde está.
  window.open(`/conversas?org=${organizationId}`, '_blank', 'noopener');
}

/**
 * O aviso no WhatsApp de quem não atendeu, no recibo da ligação.
 *
 * Pedido de 13/10/2026: "uma identidade visual mais chamativa [...] que deixe mais
 * perceptível que foi enviada a mensagem ao WhatsApp, e que não fuja do padrão do
 * CRM". Por isso ele é o cartão de aviso da casa, e não uma cor nova:
 *   - a FAIXA e o DISCO em menta, o único acento do produto, os mesmos do cartão
 *     "Nova mensagem" (`avisos/pilha-de-avisos`) — quem conhece um reconhece o outro;
 *   - o SELO em maiúsculas diz em que pé está (Na fila → Enviando → Enviado →
 *     Entregue → Lido), e anda sozinho com a tela aberta;
 *   - a MENSAGEM aparece no balão de saída da tela de Conversas, com o texto que
 *     sai de verdade;
 *   - sem aviso, o cartão fica cinza e diz por quê; com falha, fica vermelho.
 */
export function AvisoNoWhatsapp({ tentativaId }: { tentativaId: string }) {
  const cliente = useQueryClient();
  const situacao = useSituacaoDoAviso(tentativaId);
  const naoAvisar = useMutation({
    mutationFn: () => cancelar(tentativaId),
    onSuccess: (r) => {
      if (!r?.ok) toast.error('O aviso já tinha saído, não deu para cancelar.');
      void cliente.invalidateQueries({ queryKey: chaveDoAviso(tentativaId) });
    },
    onError: () => toast.error('Não deu para cancelar o aviso. Tente de novo.'),
  });

  const s = situacao.data;
  const estado = s
    ? estadoDoAviso(s, s.enviada_em ? HORA.format(new Date(s.enviada_em)) : null)
    : null;
  if (!s || !estado) return null;

  const destaque = estado.tom === 'destaque';

  return (
    <section
      aria-label="Aviso no WhatsApp"
      aria-live="polite"
      className={cn(
        'relative overflow-hidden rounded-2xl border border-hairline bg-card text-card-foreground',
        'animate-in duration-300 fade-in-0 slide-in-from-bottom-1',
      )}
    >
      {destaque ? (
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-menta" />
      ) : null}

      <div className="flex items-start gap-3 py-3.5 pr-4 pl-5">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full',
            destaque && 'bg-menta text-menta-tinta',
            estado.tom === 'falha' && 'bg-destructive/10 text-destructive-texto',
            estado.tom === 'neutro' && 'bg-muted text-muted-foreground',
          )}
        >
          <MessageCircle className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[15px] leading-snug font-semibold">{estado.titulo}</p>
            <SeloDoAviso estado={estado} entrega={s.entrega ?? null} situacao={s.situacao} />
          </div>
          <p className="text-sm leading-snug text-muted-foreground">{estado.detalhe}</p>
        </div>
      </div>

      {estado.balao && s.texto ? (
        // O balão de saída da tela de Conversas (`mensagem-do-fio`): o mesmo verde
        // sólido e o canto reto do lado de quem fala.
        <div className="flex justify-end pr-4 pb-3.5 pl-5">
          <p
            className={cn(
              'max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground md:max-w-120',
              s.situacao === 'pendente' && 'opacity-80',
            )}
          >
            {s.texto}
          </p>
        </div>
      ) : null}

      {estado.podeCancelar || estado.naConversa ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline py-2.5 pr-3 pl-5">
          {estado.podeCancelar ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="toque h-11 md:h-9"
              disabled={naoAvisar.isPending}
              onClick={() => naoAvisar.mutate()}
            >
              Não avisar
            </Button>
          ) : null}
          {estado.naConversa ? (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="toque h-11 md:h-9"
              onClick={() => abrirConversa(s.organization_id)}
            >
              <SquareArrowOutUpRight aria-hidden="true" />
              Ver na conversa
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** O selo em maiúsculas, no desenho da marca "Nova" (`avisos/marca-de-nova`). */
function SeloDoAviso({
  estado,
  entrega,
  situacao,
}: {
  estado: EstadoDoAviso;
  entrega: SituacaoDoAviso['entrega'] | null;
  situacao: SituacaoDoAviso['situacao'];
}) {
  const icone =
    estado.tom === 'falha' ? (
      <Ban className="size-3" aria-hidden="true" />
    ) : situacao === 'pendente' || entrega === 'queued' ? (
      // O ponto pulsando é só para o que ainda vai sair: é ele que diz "está andando".
      <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-menta-tinta" />
    ) : entrega === 'delivered' || entrega === 'read' ? (
      <CheckCheck className="size-3" aria-hidden="true" />
    ) : situacao === 'enviada' ? (
      <Check className="size-3" aria-hidden="true" />
    ) : (
      <Clock className="size-3" aria-hidden="true" />
    );
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full py-px pr-2 pl-1.5 text-[10px] leading-4 font-semibold tracking-[0.04em] uppercase',
        estado.tom === 'destaque' && 'bg-menta text-menta-tinta',
        estado.tom === 'falha' && 'bg-destructive/10 text-destructive-texto',
        estado.tom === 'neutro' && 'bg-muted text-muted-foreground',
      )}
    >
      {icone}
      {estado.selo}
    </span>
  );
}

/**
 * Quem liga raramente fica no recibo até o aviso sair: ele some em 5 s e a fila
 * anda a cada minuto. Este acompanhante, sem tela, fica de olho no aviso depois que
 * o recibo foi embora e avisa no canto quando a mensagem sai — "Aviso enviado no
 * WhatsApp", o mesmo tipo de confirmação de "Mensagem na fila do WhatsApp" em
 * Conversas. Desiste em silêncio se o aviso for cancelado, não for sair, ou ficar
 * esperando o horário do WhatsApp (ligação depois das 17h45).
 */
function AcompanharAviso({
  tentativaId,
  nome,
  desde,
  aoTerminar,
}: {
  tentativaId: string;
  nome: string;
  /** Quando o recibo foi embora (ms). */
  desde: number;
  aoTerminar: (tentativaId: string) => void;
}) {
  const situacao = useSituacaoDoAviso(tentativaId);
  // Só avisa a SAÍDA que aconteceu depois do recibo: o que já tinha saído com o
  // recibo na tela, o cartão já mostrou.
  const viuNaFila = useRef(false);
  const s = situacao.data;

  useEffect(() => {
    if (situacao.isPending) return;
    if (s?.situacao === 'pendente') viuNaFila.current = true;
    if (s?.situacao === 'enviada' && !viuNaFila.current) {
      aoTerminar(tentativaId);
      return;
    }
    if (s?.situacao === 'enviada') {
      if (s.entrega === 'failed') {
        toast.error('O aviso no WhatsApp não saiu', { description: nome });
      } else {
        toast.success('Aviso enviado no WhatsApp', {
          description: nome,
          icon: <MessageCircle className="size-4" aria-hidden="true" />,
          action: s.organization_id
            ? { label: 'Ver', onClick: () => abrirConversa(s.organization_id) }
            : undefined,
        });
      }
      aoTerminar(tentativaId);
      return;
    }
    // Fila parada fora do horário: o aviso sai amanhã, e a tela não fica perguntando.
    if (s?.situacao !== 'pendente' || Date.now() - desde > 10 * 60_000) {
      aoTerminar(tentativaId);
    }
  }, [s, situacao.isPending, nome, tentativaId, desde, aoTerminar]);

  return null;
}

// ---------------------------------------------------------------------------
// Os avisos que saíram do recibo e ainda vão sair
// ---------------------------------------------------------------------------
// Um registro de módulo, e não estado da tela da chamada: aquela tela é desmontada
// quando se sai do lote (e a ligação da ficha volta para a ficha logo depois do
// recibo). O acompanhante mora na casca (`AppShell`), que fica de pé em todas as telas.

type Acompanhado = { tentativaId: string; nome: string; desde: number };

let acompanhados: readonly Acompanhado[] = [];
const ouvintes = new Set<() => void>();

function avisar() {
  for (const ouvir of ouvintes) ouvir();
}

/** Chamado quando o recibo vai embora com um aviso que pode ainda estar na fila. */
export function acompanharAviso(tentativaId: string, nome: string) {
  if (acompanhados.some((a) => a.tentativaId === tentativaId)) return;
  acompanhados = [...acompanhados, { tentativaId, nome, desde: Date.now() }];
  avisar();
}

function largar(tentativaId: string) {
  acompanhados = acompanhados.filter((a) => a.tentativaId !== tentativaId);
  avisar();
}

function assinar(ouvir: () => void) {
  ouvintes.add(ouvir);
  return () => {
    ouvintes.delete(ouvir);
  };
}

const NINGUEM: readonly Acompanhado[] = [];

/**
 * Na casca do app: um acompanhante sem tela para cada aviso em andamento. Usa o
 * cache de consultas da área autenticada, o mesmo do recibo da ligação: a mesma
 * tentativa não é perguntada duas vezes a cada 5 s.
 */
export function AcompanhanteDeAvisos() {
  const lista = useSyncExternalStore(
    assinar,
    () => acompanhados,
    () => NINGUEM,
  );
  const aoTerminar = useCallback((tentativaId: string) => largar(tentativaId), []);
  if (lista.length === 0) return null;
  return (
    <>
      {lista.map((a) => (
        <AcompanharAviso
          key={a.tentativaId}
          tentativaId={a.tentativaId}
          nome={a.nome}
          desde={a.desde}
          aoTerminar={aoTerminar}
        />
      ))}
    </>
  );
}
