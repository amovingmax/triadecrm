'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CalendarPlus, Unplug } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { ESCOPO_AGENDA_NO_CLIENTE, buscarEstadoDaAgenda, desconectarAgenda } from './google-dados';

/**
 * Conectar (e desconectar) a agenda Google da própria pessoa.
 *
 * ---------------------------------------------------------------------------
 * POR QUE CONECTAR É UM LOGIN DE NOVO
 * ---------------------------------------------------------------------------
 * O Supabase entrega o `provider_refresh_token` — a credencial que deixa o CRM
 * criar evento na agenda de alguém — apenas no retorno de um consentimento, e
 * só quando ele é pedido com `access_type=offline` e `prompt=consent`. Não há
 * como pedir "só mais essa permissão" sem passar pelo Google outra vez.
 *
 * Isso tem um efeito que a tela precisa avisar ANTES do clique: a pessoa vai ver
 * a tela do Google de novo e precisa escolher a MESMA conta. Escolher outra
 * troca a sessão do CRM inteiro. É por isso que o botão não diz só "Conectar":
 * diz com qual conta, e o texto embaixo explica o que vai acontecer.
 *
 * ---------------------------------------------------------------------------
 * O TOKEN PASSA PELO NAVEGADOR. UMA VEZ.
 * ---------------------------------------------------------------------------
 * Ele chega na sessão, é enviado para `/api/agenda/conectar` e vai direto para o
 * Vault. Não é guardado em lugar nenhum do lado do cliente — nem em estado, nem
 * em armazenamento local. É uma consequência de como o Supabase Auth devolve
 * tokens de provedor, não uma escolha de desenho.
 */
export function ConexaoDaAgendaGoogle({ className }: { className?: string }) {
  const clienteDeConsultas = useQueryClient();
  const [ocupado, setOcupado] = useState(false);

  const estado = useQuery({
    queryKey: ['agenda', 'google', 'estado'],
    queryFn: buscarEstadoDaAgenda,
  });

  // O consentimento volta pelo /auth/callback, que redireciona para cá com
  // `?agenda=conectando`. Só nesse instante a sessão carrega o refresh token.
  const guardarSeVoltouDoGoogle = useCallback(async () => {
    const parametros = new URLSearchParams(window.location.search);
    if (parametros.get('agenda') !== 'conectando') return;

    // Limpa a marca antes de qualquer await: um refresh no meio do processo não
    // pode disparar a gravação duas vezes.
    parametros.delete('agenda');
    const busca = parametros.toString();
    window.history.replaceState(null, '', window.location.pathname + (busca ? `?${busca}` : ''));

    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const refresh = data.session?.provider_refresh_token;

    if (!refresh) {
      toast.error('O Google não devolveu a permissão de longa duração.', {
        description:
          'Isso acontece quando a conta já tinha autorizado antes. Clique em Conectar de novo e confirme a permissão na tela do Google.',
      });
      return;
    }

    const resposta = await fetch('/api/agenda/conectar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh, email: data.session?.user.email }),
    });
    const corpo = (await resposta.json().catch(() => ({}))) as { ok?: boolean; motivo?: string };

    if (corpo.ok !== true) {
      toast.error('Não deu para guardar a conexão com a sua agenda.', {
        description:
          corpo.motivo === 'nao_configurado'
            ? 'A integração ainda não foi configurada no servidor. Fale com Luiz ou Matheus.'
            : 'Tente conectar de novo.',
      });
      return;
    }

    toast.success('Agenda conectada.', {
      description: 'As reuniões marcadas aqui podem virar evento no seu Google Agenda.',
    });
    void clienteDeConsultas.invalidateQueries({ queryKey: ['agenda'] });
  }, [clienteDeConsultas]);

  useEffect(() => {
    void guardarSeVoltouDoGoogle();
  }, [guardarSeVoltouDoGoogle]);

  async function conectar() {
    setOcupado(true);
    const supabase = createClient();

    const volta = new URL('/auth/callback', window.location.origin);
    volta.searchParams.set('next', `${window.location.pathname}?agenda=conectando`);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: volta.toString(),
        scopes: ESCOPO_AGENDA_NO_CLIENTE,
        // `offline` + `consent`: sem os dois, o Google devolve só um token de uma
        // hora, e o CRM não conseguiria criar evento amanhã.
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });

    if (error) {
      toast.error('Não foi possível abrir a permissão do Google.', {
        description: 'Verifique a conexão e tente de novo.',
      });
      setOcupado(false);
    }
  }

  async function desconectar() {
    setOcupado(true);
    try {
      const r = await desconectarAgenda();
      if (!r.ok) {
        toast.error('Não deu para desconectar.', { description: 'Tente de novo.' });
        return;
      }
      toast.success('Agenda desconectada.', {
        description:
          'A permissão foi apagada daqui. Para tirar o acesso também do lado do Google, vá em Conta Google → Segurança → Acesso de terceiros.',
      });
      void clienteDeConsultas.invalidateQueries({ queryKey: ['agenda'] });
    } finally {
      setOcupado(false);
    }
  }

  if (estado.isPending) {
    return <Skeleton className={cn('h-16 w-full max-w-prose rounded-lg', className)} />;
  }

  const conectada = estado.data?.conectada === true;

  return (
    <section
      aria-label="Conexão com o Google Agenda"
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-hairline bg-muted/40 p-4 sm:flex-row sm:items-start',
        className,
      )}
    >
      <span
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground"
        aria-hidden="true"
      >
        {conectada ? <CalendarCheck className="size-4" /> : <CalendarPlus className="size-4" />}
      </span>

      <div className="min-w-0 flex-1">
        <h2 className="font-heading text-sm font-medium">
          {conectada ? 'Google Agenda conectado' : 'Google Agenda não conectado'}
        </h2>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
          {conectada ? (
            <>
              Conta <span className="text-foreground">{estado.data?.email}</span>. As reuniões
              marcadas aqui podem virar evento com link do Meet, convite para o fornecedor e
              lembretes de 24 h e 1 h.
              {estado.data?.ultimoErro ? (
                <>
                  {' '}
                  <span className="text-destructive-texto">
                    O último envio falhou. Se repetir, desconecte e conecte de novo.
                  </span>
                </>
              ) : null}
            </>
          ) : (
            <>
              Sem isso, a reunião marcada vive só aqui dentro: ninguém recebe convite e não há link
              do Meet. Conectar abre a tela do Google —{' '}
              <span className="text-foreground">escolha a mesma conta com que você entrou</span>,
              porque escolher outra troca a sua sessão no CRM.
            </>
          )}
        </p>
      </div>

      <Button
        variant="outline"
        onClick={conectada ? desconectar : conectar}
        disabled={ocupado}
        className="toque h-11 shrink-0 md:h-9"
      >
        {conectada ? <Unplug aria-hidden="true" /> : <CalendarPlus aria-hidden="true" />}
        {ocupado ? 'Um instante...' : conectada ? 'Desconectar' : 'Conectar'}
      </Button>
    </section>
  );
}
