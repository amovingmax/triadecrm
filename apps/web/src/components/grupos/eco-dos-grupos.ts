'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { RealtimeChannel } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';
import { ESPERA_DA_RAJADA_MS } from '@/components/conversas/ritmo-do-eco';

import { CHAVE_DOS_GRUPOS, chaveDasAcoes, chaveDoFio } from './dados';
import { grupoDoEvento } from './regras';

/**
 * O eco dos grupos: a aba se atualiza sozinha quando alguém escreve no grupo,
 * quando a Meta termina de criar um, ou quando um pedido muda o grupo.
 *
 * O mesmo desenho do eco das Conversas (`conversas/eco-do-banco.ts`), menor:
 * `wa_grupos` e `wa_grupo_mensagens` estão na publicação do Realtime; o evento
 * só diz "mudou algo neste grupo", e quem busca é o TanStack Query; rajada vira
 * uma busca só; aba escondida guarda e resolve quando a pessoa volta.
 *
 * `wa_acoes` NÃO está na publicação. Quando um pedido termina, quase sempre o
 * grupo muda junto (o link novo, o estado, o erro), e o evento do grupo já
 * recarrega a fila de pedidos dele. O resto é a sondagem curta da própria tela
 * enquanto há pedido na fila (`temPedidoNaFila`).
 *
 * Sem socket, a tela passa a perguntar a cada 20 s (quem decide é ela, pelo
 * estado devolvido aqui).
 */
export type EstadoDoEcoDosGrupos = 'ligando' | 'ao_vivo' | 'sem_eco';

export function useEcoDosGrupos(): EstadoDoEcoDosGrupos {
  const clientes = useQueryClient();
  const [estado, setEstado] = useState<EstadoDoEcoDosGrupos>('ligando');

  const pendente = useRef<{ lista: boolean; grupos: Set<string> }>({
    lista: false,
    grupos: new Set(),
  });
  const relogio = useRef<number | null>(null);

  const resolver = useCallback(() => {
    if (relogio.current !== null) {
      window.clearTimeout(relogio.current);
      relogio.current = null;
    }
    const agora = pendente.current;
    pendente.current = { lista: false, grupos: new Set() };
    if (agora.lista) void clientes.invalidateQueries({ queryKey: CHAVE_DOS_GRUPOS });
    for (const grupoId of agora.grupos) {
      void clientes.invalidateQueries({ queryKey: chaveDoFio(grupoId) });
      void clientes.invalidateQueries({ queryKey: chaveDasAcoes(grupoId) });
    }
  }, [clientes]);

  const agendar = useCallback(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (relogio.current !== null) return;
    relogio.current = window.setTimeout(resolver, ESPERA_DA_RAJADA_MS);
  }, [resolver]);

  useEffect(() => {
    const supabase = createClient();
    let canal: RealtimeChannel | null = null;
    let desmontou = false;

    const ligar = async () => {
      // A sessão primeiro: sem o token, o socket assina como anônimo e a RLS
      // não entrega evento nenhum (ver `eco-do-banco.ts`).
      await supabase.auth.getSession();
      if (desmontou) return;
      const novo = supabase.channel(`grupos-ao-vivo-${crypto.randomUUID().slice(0, 8)}`);
      for (const tabela of ['wa_grupos', 'wa_grupo_mensagens'] as const) {
        novo.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: tabela },
          (payload: { new?: unknown; old?: unknown }) => {
            const grupoId =
              grupoDoEvento(tabela, payload.new) ?? grupoDoEvento(tabela, payload.old);
            // A lista mostra a última atividade e o "por ler": muda com quase tudo.
            pendente.current.lista = true;
            if (grupoId !== null) pendente.current.grupos.add(grupoId);
            agendar();
          },
        );
      }
      novo.subscribe((status) => {
        if (!desmontou) setEstado(status === 'SUBSCRIBED' ? 'ao_vivo' : 'sem_eco');
      });
      canal = novo;
    };
    void ligar();

    return () => {
      desmontou = true;
      if (canal !== null) void supabase.removeChannel(canal);
      if (relogio.current !== null) window.clearTimeout(relogio.current);
      relogio.current = null;
    };
  }, [agendar]);

  useEffect(() => {
    const aoVoltar = () => {
      if (!document.hidden) resolver();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [resolver]);

  return estado;
}
