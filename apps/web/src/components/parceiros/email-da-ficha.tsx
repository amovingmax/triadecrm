'use client';

import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * O e-mail da ficha (17/11/2026), com o botão de copiar e o que o cliente respondeu ao
 * convite de ofertas por e-mail.
 *
 * O e-mail chega de dois jeitos: a equipe digita em "Editar", ou o cliente escreve na
 * conversa e o banco leva para a ficha (`messages_zzz_email_na_ficha`). A resposta às
 * ofertas vem de `public.ofertas_por_email` (a linha mais nova vale), que a IA preenche
 * quando o cliente aceita ou recusa o convite.
 */

export type RespostaAsOfertas = { aceita: boolean; em: string } | null;

export function chaveDasOfertas(organizationId: string) {
  return ['ofertas-por-email', organizationId] as const;
}

async function carregarOfertas(organizationId: string): Promise<RespostaAsOfertas> {
  const { data, error } = await createClient()
    .from('ofertas_por_email')
    .select('aceita, ocorrido_em')
    .eq('organization_id', organizationId)
    .order('ocorrido_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { aceita: data.aceita, em: data.ocorrido_em } : null;
}

/** "aceita ofertas" ou "não quer ofertas"; nada quando ele nunca respondeu. */
export function rotuloDasOfertas(resposta: RespostaAsOfertas): string | null {
  if (resposta === null) return null;
  return resposta.aceita ? 'aceita ofertas' : 'não quer ofertas';
}

export function EmailDaFicha({
  organizationId,
  email,
  className,
  linkClassName = 'hover:underline',
}: {
  organizationId: string;
  email: string | null;
  className?: string;
  /** O jeito do endereço (na ficha, sublinhado como os outros links). */
  linkClassName?: string;
}) {
  const ofertas = useQuery({
    queryKey: chaveDasOfertas(organizationId),
    queryFn: () => carregarOfertas(organizationId),
    staleTime: 60_000,
  });
  const rotulo = rotuloDasOfertas(ofertas.data ?? null);

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success('E-mail copiado.');
    } catch {
      toast.error('O navegador não deixou copiar.', {
        description: 'Selecione o e-mail na tela e copie à mão.',
      });
    }
  }

  return (
    <span
      className={cn(
        'inline-flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1',
        className,
      )}
    >
      {email ? (
        <>
          <a href={`mailto:${email}`} className={cn('min-w-0 break-all', linkClassName)}>
            {email}
          </a>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void copiar(email)}
            className="toque size-11 shrink-0 text-muted-foreground md:size-7"
            aria-label="Copiar o e-mail"
            title="Copiar o e-mail"
          >
            <Copy aria-hidden="true" />
          </Button>
        </>
      ) : (
        <span className="text-muted-foreground">não informado</span>
      )}
      {rotulo ? (
        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-none',
            ofertas.data?.aceita
              ? 'border-primary/40 text-primary'
              : 'border-hairline text-muted-foreground',
          )}
          title={
            ofertas.data?.aceita
              ? 'Aceitou receber ofertas e novidades por e-mail.'
              : 'Disse que não quer receber ofertas por e-mail. O WhatsApp continua normal.'
          }
        >
          {rotulo}
        </span>
      ) : null}
    </span>
  );
}
