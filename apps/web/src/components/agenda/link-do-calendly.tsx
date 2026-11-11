'use client';

import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import {
  erroAoGravarOLink,
  lerConfiguracaoDoLink,
  PERGUNTAS_DO_CALENDLY,
  validarLinkDoCalendly,
  type ConfiguracaoDoLink,
} from './link-do-calendly-regra';

/**
 * "Link do Calendly" (11/11/2026), só para admin e só na Imova (módulo
 * `agendaComImovel`), ao lado de "Quem atende o que chega pelo Calendly", no pé da
 * Agenda.
 *
 * É o link que o botão "Enviar link da agenda" (Conversas) e a IA mandam ao cliente,
 * com o nome, o tipo, o telefone e o imóvel já preenchidos. Lê
 * `app_settings['calendly'].link` (a configuração do Calendly, que todo mundo da
 * equipe lê) e grava por `public.calendly_link_configurar`, que confere o papel, só
 * aceita `https://calendly.com/...` e não mexe no resto (`dono_email`,
 * `google_agenda_id`). Leitura falhando, o campo não aparece, como o de "Quem atende".
 */
const CHAVE = ['agenda', 'calendly', 'link'] as const;

async function buscar(): Promise<ConfiguracaoDoLink | null> {
  const { data, error } = await createClient()
    .from('app_settings')
    .select('value')
    .eq('key', 'calendly')
    .maybeSingle();
  return error ? null : lerConfiguracaoDoLink(data?.value ?? null);
}

export function LinkDoCalendly() {
  const id = useId();
  const cliente = useQueryClient();
  const consulta = useQuery({ queryKey: CHAVE, queryFn: buscar, staleTime: 5 * 60_000 });
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const gravacao = useMutation({
    mutationFn: async (
      link: string,
    ): Promise<{ ok: true; link: string } | { ok: false; recado: string }> => {
      const { data, error } = await createClient().rpc('calendly_link_configurar', {
        p_link: link,
      });
      if (error) return { ok: false, recado: erroAoGravarOLink(error.code) };
      const r = (data ?? {}) as { ok?: boolean; motivo?: string; link?: string };
      return r.ok === true
        ? { ok: true, link: r.link ?? link }
        : { ok: false, recado: erroAoGravarOLink(undefined, r.motivo) };
    },
    onSuccess: (r) => {
      if (!r.ok) {
        setErro(r.recado);
        return;
      }
      cliente.setQueryData<ConfiguracaoDoLink | null>(CHAVE, (antes) => ({
        linkVisita: antes?.linkVisita ?? null,
        linkReuniao: antes?.linkReuniao ?? null,
        link: r.link,
      }));
      setEditando(false);
      setErro(null);
      toast.success('Link do Calendly gravado. É ele que vai para o cliente a partir de agora.');
    },
    onError: () => setErro(erroAoGravarOLink(undefined)),
  });

  const config = consulta.data;
  if (!config) return null;

  function salvar() {
    const r = validarLinkDoCalendly(texto);
    if (!r.ok) {
      setErro(r.recado);
      return;
    }
    gravacao.mutate(r.link);
  }

  const mostrarCampo = editando || !config.link;

  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-5"
    >
      <h2
        id={`${id}-titulo`}
        className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]"
      >
        <Link2 className="size-4 text-muted-foreground" aria-hidden="true" />
        Link do Calendly
      </h2>

      {mostrarCampo ? (
        <div className="flex max-w-md flex-col gap-1.5">
          <label htmlFor={`${id}-link`} className="sr-only">
            Link do evento no Calendly
          </label>
          <div className="flex gap-2">
            <Input
              id={`${id}-link`}
              type="url"
              inputMode="url"
              autoComplete="off"
              value={texto}
              maxLength={300}
              onChange={(e) => {
                setTexto(e.target.value);
                setErro(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') salvar();
              }}
              placeholder="https://calendly.com/sua-conta/evento"
              aria-invalid={erro !== null}
              className="h-11 md:h-9"
            />
            <Button
              variant="outline"
              size="lg"
              className="toque h-11 shrink-0 md:h-9"
              disabled={gravacao.isPending}
              onClick={salvar}
            >
              {gravacao.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Salvar
            </Button>
          </div>
          {erro ? (
            <p role="alert" className="text-xs text-destructive-texto">
              {erro}
            </p>
          ) : null}
          {config.link ? null : (
            <p className="text-xs text-muted-foreground">
              Nenhum link cadastrado. Sem ele, o botão &ldquo;Enviar link da agenda&rdquo; e a IA
              não mandam o link ao cliente.
            </p>
          )}
        </div>
      ) : (
        <div className="flex max-w-md items-center justify-between gap-3">
          <a
            href={config.link ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 truncate text-sm underline-offset-4 hover:underline"
          >
            {config.link}
          </a>
          <Button
            variant="ghost"
            size="sm"
            className="toque h-11 shrink-0 md:h-8"
            onClick={() => {
              setTexto(config.link ?? '');
              setEditando(true);
            }}
            aria-label="Trocar o link do Calendly"
          >
            <Pencil aria-hidden="true" />
            Trocar
          </Button>
        </div>
      )}

      <p className="max-w-prose text-xs text-muted-foreground">
        É o link que o botão &ldquo;Enviar link da agenda&rdquo;, em Conversas, e a IA mandam ao
        cliente, já com o nome, o tipo, o telefone e, na visita, o código e o endereço do imóvel.
        {config.linkVisita || config.linkReuniao
          ? ' Há evento próprio para visita ou reunião, e ele vale no lugar deste no tipo dele.'
          : ''}
      </p>

      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium">No Calendly, as perguntas devem estar nesta ordem:</p>
        <ol className="list-decimal pl-5 text-xs text-muted-foreground">
          {PERGUNTAS_DO_CALENDLY.map((pergunta) => (
            <li key={pergunta}>{pergunta}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}
