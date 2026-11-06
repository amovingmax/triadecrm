'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FlaskConical, Send } from 'lucide-react';
import { toast } from 'sonner';

import { EMPRESA } from '@/lib/empresa';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { carregarEstado, chaveDoEstado } from './dados';

/**
 * TESTE NO COMPUTADOR: escrever como o cliente, na conversa do treino.
 *
 * Na tela, tudo o que se escreve sai como mensagem da equipe, e isso para a IA
 * (gente assumiu). Esta caixa grava a mensagem como RECEBIDA, pela rota
 * `/auth/dev/cliente`, e a IA responde como responderia ao WhatsApp de verdade.
 *
 * Só existe em `next dev` (no build de produção `NODE_ENV` é 'production' e a
 * caixa nem é desenhada; a rota, lá, responde 404) e só na conversa do treino.
 */
const NO_COMPUTADOR = process.env.NODE_ENV === 'development' && EMPRESA.modulos.iaQueAtende;

export function ClienteDeTeste({ fioId, className }: { fioId: string; className?: string }) {
  const [texto, setTexto] = useState('');
  const { data } = useQuery({
    queryKey: chaveDoEstado(fioId),
    queryFn: () => carregarEstado(fioId),
    enabled: NO_COMPUTADOR,
    staleTime: 15_000,
  });

  const enviar = useMutation({
    mutationFn: async (mensagem: string) => {
      const r = await fetch('/auth/dev/cliente', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversa: fioId, texto: mensagem }),
      });
      const corpo = (await r.json().catch(() => ({}))) as { erro?: string };
      if (!r.ok) throw new Error(corpo.erro ?? 'Não deu para gravar a mensagem.');
    },
    onSuccess: () => {
      setTexto('');
      toast.success('Mensagem do cliente gravada', {
        description: 'A IA responde em uns 20 a 30 segundos.',
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não deu para gravar a mensagem.'),
  });

  if (!NO_COMPUTADOR || !data?.treino) return null;

  const mandar = () => {
    const t = texto.trim();
    if (t !== '' && !enviar.isPending) enviar.mutate(t);
  };

  return (
    <div
      className={cn(
        'rounded-lg border border-dashed border-amber-500/70 bg-amber-50/60 px-2.5 py-2 dark:bg-amber-950/30',
        className,
      )}
    >
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-200">
        <FlaskConical className="size-3.5" aria-hidden />
        Teste no computador: escreva aqui como se fosse o cliente
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          mandar();
        }}
      >
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ex.: Oi, vi a placa de vocês. Têm casa para alugar?"
          aria-label="Mensagem do cliente (teste)"
          maxLength={2000}
          className="h-9 bg-background"
        />
        <Button type="submit" size="sm" className="h-9 shrink-0" disabled={texto.trim() === '' || enviar.isPending}>
          <Send className="size-4" aria-hidden />
          Enviar como cliente
        </Button>
      </form>
    </div>
  );
}
