'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Handshake, Headset } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EscolhaDaTag } from '@/components/conversas/perfil-da-conversa';
import { rotuloDaParceria } from '@/components/conversas/perfil-regra';
import type { TipoDeParceria } from '@/components/conversas/tipos';

import {
  avisoDaConsultoria,
  avisoDaTag,
  carregarConsultoria,
  CHAVE_CONSULTORIA,
  HREF_CONSULTORIA,
  MARCA_E_PARCEIRO,
  marcarConsultoria,
  marcarParceirosComTag,
  recadoDaConsultoria,
} from './consultoria';

const NINGUEM: ReadonlyMap<string, TipoDeParceria | null> = new Map();

/**
 * Quem está na Consultoria e o clique que põe e tira (14/10/2026). As regras
 * estão em `consultoria.ts`. Sem diálogo: nada se perde, e o aviso traz
 * "Desfazer" e o caminho para a aba. Na Imova, desde 23/11/2026, pôr em
 * Parceiros pede a tag (`DialogoDaTag` + `marcarComTag`); tirar continua um clique.
 */
export function useConsultoria(ligada: boolean) {
  const clientes = useQueryClient();
  const consulta = useQuery({
    queryKey: CHAVE_CONSULTORIA,
    queryFn: carregarConsultoria,
    enabled: ligada,
  });
  const router = useRouter();

  // O "Desfazer" do aviso: o clique contrário, sem outro aviso de desfazer.
  const desfazer = useCallback(
    async (ids: readonly string[], sim: boolean) => {
      const r = await marcarConsultoria(ids, sim);
      if (!r.ok) {
        toast.error('Não deu para desfazer.', { description: recadoDaConsultoria(r.motivo) });
        return;
      }
      void clientes.invalidateQueries({ queryKey: CHAVE_CONSULTORIA });
      toast.success('Desfeito.');
    },
    [clientes],
  );

  const marcar = useCallback(
    async (ids: readonly string[], sim: boolean): Promise<boolean> => {
      const r = await marcarConsultoria(ids, sim);
      if (!r.ok) {
        const erro = MARCA_E_PARCEIRO
          ? sim
            ? 'Não virou Parceiro.'
            : 'Não voltou para Clientes.'
          : sim
            ? 'Não foi para a Consultoria.'
            : 'Não saiu da Consultoria.';
        toast.error(erro, {
          description: recadoDaConsultoria(r.motivo),
        });
        return false;
      }
      void clientes.invalidateQueries({ queryKey: CHAVE_CONSULTORIA });
      toast.success(avisoDaConsultoria(sim, ids.length, r.mudaram), {
        description: sim
          ? MARCA_E_PARCEIRO
            ? 'Aparece em Conversas → Parceiros, e a IA que atende não responde lá. A etapa do funil não muda.'
            : 'Aparece em Conversas → Consultoria. A etapa do funil não muda.'
          : 'Volta para a lista de Conversas, se tiver conversa.',
        action:
          r.mudaram > 0
            ? { label: 'Desfazer', onClick: () => void desfazer(ids, !sim) }
            : sim
              ? { label: 'Abrir', onClick: () => router.push(HREF_CONSULTORIA) }
              : undefined,
        duration: 8_000,
      });
      return true;
    },
    [clientes, router, desfazer],
  );

  // Imova (23/11/2026): pôr em Parceiros é sempre com a tag. O "Desfazer" só
  // aparece quando todos eram Clientes (aí desfazer é voltar todos para lá).
  const naConsultoria = consulta.data ?? NINGUEM;
  const marcarComTag = useCallback(
    async (ids: readonly string[], tipo: TipoDeParceria): Promise<boolean> => {
      const eramClientes = ids.every((id) => !naConsultoria.has(id));
      const r = await marcarParceirosComTag(ids, tipo);
      if (!r.ok) {
        toast.error('Não virou Parceiro.', { description: recadoDaConsultoria(r.motivo) });
        return false;
      }
      void clientes.invalidateQueries({ queryKey: CHAVE_CONSULTORIA });
      toast.success(avisoDaTag(tipo, ids.length, r.mudaram), {
        description:
          'Aparece em Conversas → Parceiros, e a IA que atende não responde lá. A etapa do funil não muda.',
        action:
          r.mudaram > 0 && eramClientes
            ? { label: 'Desfazer', onClick: () => void desfazer(ids, false) }
            : { label: 'Abrir', onClick: () => router.push(HREF_CONSULTORIA) },
        duration: 8_000,
      });
      return true;
    },
    [clientes, router, desfazer, naConsultoria],
  );

  return { naConsultoria, marcar, marcarComTag };
}

/**
 * O diálogo de pôr a tag (Imova, 23/11/2026): um contato (o botão da linha) ou
 * vários (a barra dos marcados). Sem tag não há Parceiro.
 */
export function DialogoDaTag({
  pedido,
  aoFechar,
  aoConfirmar,
}: {
  /** `null` fechado. `nome` quando é um só. */
  pedido: { ids: readonly string[]; nome: string | null } | null;
  aoFechar: () => void;
  aoConfirmar: (ids: readonly string[], tipo: TipoDeParceria) => Promise<boolean>;
}) {
  return (
    <Dialog open={pedido !== null} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[calc(100svh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-md">
        {pedido ? (
          <FormularioDaTag
            key={pedido.ids.join(',')}
            pedido={pedido}
            aoFechar={aoFechar}
            aoConfirmar={aoConfirmar}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FormularioDaTag({
  pedido,
  aoFechar,
  aoConfirmar,
}: {
  pedido: { ids: readonly string[]; nome: string | null };
  aoFechar: () => void;
  aoConfirmar: (ids: readonly string[], tipo: TipoDeParceria) => Promise<boolean>;
}) {
  const [tipo, setTipo] = useState<TipoDeParceria | null>(null);
  const [enviando, setEnviando] = useState(false);
  const quantos = pedido.ids.length;
  const titulo =
    quantos === 1
      ? `Mudar ${pedido.nome ?? 'o contato'} para Parceiro`
      : `Mudar ${quantos} contatos para Parceiro`;

  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!tipo || enviando) return;
        setEnviando(true);
        const ok = await aoConfirmar(pedido.ids, tipo);
        setEnviando(false);
        if (ok) aoFechar();
      }}
    >
      <DialogHeader>
        <DialogTitle className="font-heading text-lg leading-tight">{titulo}</DialogTitle>
        <DialogDescription>
          {quantos === 1
            ? 'A conversa sai de Clientes e passa a ficar em Parceiros, com a tag que você escolher. A IA que atende não responde Parceiros.'
            : 'Todos recebem a mesma tag. Quem já era Parceiro fica com a tag nova. A IA que atende não responde Parceiros.'}
        </DialogDescription>
      </DialogHeader>

      <EscolhaDaTag valor={tipo} aoMudar={setTipo} />

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          className="toque h-11 md:h-9"
          onClick={aoFechar}
          disabled={enviando}
        >
          Cancelar
        </Button>
        <Button type="submit" className="toque h-11 md:h-9" disabled={!tipo || enviando}>
          <Handshake aria-hidden="true" />
          Mudar para Parceiro
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * O botão da linha: um fone quando o parceiro não está na Consultoria; a
 * pílula "Consultoria" quando está — e o mesmo clique o tira de lá.
 */
export function BotaoConsultoria({
  nome,
  marcado,
  tag = null,
  aoMudar,
  className,
}: {
  nome: string;
  marcado: boolean;
  /** A tag do Parceiro (Imova): a pílula mostra "Inquilino" em vez de "Parceiro". */
  tag?: TipoDeParceria | null;
  aoMudar: (sim: boolean) => void;
  className?: string;
}) {
  const rotulo = MARCA_E_PARCEIRO
    ? marcado
      ? `${nome} é Parceiro (${rotuloDaParceria(tag)}). Voltar para Clientes`
      : `Mudar ${nome} para Parceiro, em Conversas`
    : marcado
      ? `${nome} está na Consultoria. Tirar de lá`
      : `Mandar ${nome} para a Consultoria, em Conversas`;
  return (
    <button
      type="button"
      onClick={() => aoMudar(!marcado)}
      title={rotulo}
      aria-label={rotulo}
      aria-pressed={marcado}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1 rounded-lg text-xs font-medium',
        'transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        marcado
          ? 'h-6 border border-hairline bg-muted px-2 text-foreground hover:bg-muted/70'
          : 'size-7 text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      {marcado ? (
        <>
          <Check className="size-3" aria-hidden="true" />
          {MARCA_E_PARCEIRO ? rotuloDaParceria(tag) : 'Consultoria'}
        </>
      ) : MARCA_E_PARCEIRO ? (
        <Handshake className="size-4" aria-hidden="true" />
      ) : (
        <Headset className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
