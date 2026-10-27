'use client';

import { useId, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

import { pedir, procurarConversas } from './dados';
import { conversaAceitaConvite, telefoneLegivel } from './regras';
import type { ConversaParaConvite, GrupoCru } from './tipos';

/**
 * Mandar o convite numa conversa 1:1: é como a Meta quer que se convide. A
 * mensagem sai pela conversa escolhida ("Entre no grupo … do WhatsApp: <link>"),
 * com a mesma porteira de toda mensagem, então só vai para quem escreveu nas
 * últimas 24 h. As conversas fora da janela aparecem, mas apagadas.
 */
export function ConvidarNumaConversa({
  grupo,
  aberto,
  aoFechar,
}: {
  grupo: GrupoCru;
  aberto: boolean;
  aoFechar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(estado) => (estado ? null : aoFechar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mandar o convite</DialogTitle>
          <DialogDescription>
            O link vai como mensagem na conversa escolhida. Só para quem escreveu nas últimas 24 h.
          </DialogDescription>
        </DialogHeader>
        {aberto ? <Escolha grupo={grupo} aoFechar={aoFechar} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Escolha({ grupo, aoFechar }: { grupo: GrupoCru; aoFechar: () => void }) {
  const id = useId();
  const [busca, setBusca] = useState('');
  const termo = busca.trim();
  const conversas = useQuery({
    queryKey: ['grupos', 'convite', termo],
    queryFn: () => procurarConversas(termo),
    staleTime: 30_000,
  });

  const mandar = useMutation({
    mutationFn: (conversa: ConversaParaConvite) =>
      pedir('grupo_convidar', { p_grupo_id: grupo.id, p_conversation_id: conversa.id }),
    onSuccess: (_r, conversa) => {
      toast.success('Convite na fila.', {
        description: `Vai para ${conversa.peer_nome?.trim() || telefoneLegivel(conversa.peer_phone_e164)}.`,
      });
      aoFechar();
    },
    onError: (e: Error) => toast.error('O convite não foi.', { description: e.message }),
  });

  const agora = new Date();
  const linhas = conversas.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={`${id}-busca`} className="sr-only">
        Procurar a conversa
      </label>
      <Input
        id={`${id}-busca`}
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Nome ou número"
        className="h-11 md:h-9"
        autoComplete="off"
      />
      <ul className="max-h-72 overflow-y-auto rounded-xl border border-hairline">
        {conversas.isPending ? (
          <li className="px-3 py-3 text-xs text-muted-foreground">Procurando…</li>
        ) : conversas.isError ? (
          <li className="px-3 py-3 text-xs text-destructive-texto">{conversas.error.message}</li>
        ) : linhas.length === 0 ? (
          <li className="px-3 py-3 text-xs text-muted-foreground">Nenhuma conversa com isso.</li>
        ) : (
          linhas.map((c) => {
            const pode = conversaAceitaConvite(c, agora);
            const nome = c.peer_nome?.trim() || telefoneLegivel(c.peer_phone_e164);
            return (
              <li
                key={c.id}
                className="flex items-center gap-2 border-b border-hairline px-3 py-2 last:border-b-0"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{nome}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {pode ? telefoneLegivel(c.peer_phone_e164) : 'fora da janela de 24 h'}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant={pode ? 'default' : 'outline'}
                  disabled={!pode || mandar.isPending}
                  onClick={() => mandar.mutate(c)}
                  className="toque h-10 md:h-8"
                >
                  <Send aria-hidden="true" />
                  Mandar
                </Button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
