'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

export type AvisoDaPessoa = {
  tipo: string;
  nome: string;
  descricao: string;
  ligado: boolean;
};

/**
 * Uma chave por tipo de aviso no celular. A troca aparece na hora e volta atrás se o
 * banco recusar (`public.avisos_definir`).
 */
export function ChavesDeAvisos({ iniciais }: { iniciais: AvisoDaPessoa[] }) {
  const [avisos, setAvisos] = useState(iniciais);
  const [salvando, setSalvando] = useState<string | null>(null);

  async function trocar(tipo: string, ligado: boolean) {
    setSalvando(tipo);
    setAvisos((lista) => lista.map((a) => (a.tipo === tipo ? { ...a, ligado } : a)));
    const { error } = await createClient().rpc(
      'avisos_definir' as never,
      { p_tipo: tipo, p_ligado: ligado } as never,
    );
    setSalvando(null);
    if (error) {
      setAvisos((lista) => lista.map((a) => (a.tipo === tipo ? { ...a, ligado: !ligado } : a)));
      toast.error('A troca não foi salva.', { description: 'Tente de novo em alguns segundos.' });
    }
  }

  return (
    <ul className="mt-6 divide-y divide-hairline rounded-2xl border border-border bg-card">
      {avisos.map((aviso) => (
        <li key={aviso.tipo} className="flex items-center gap-4 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{aviso.nome}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
              {aviso.descricao}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={aviso.ligado}
            aria-label={aviso.nome}
            disabled={salvando === aviso.tipo}
            onClick={() => void trocar(aviso.tipo, !aviso.ligado)}
            className={cn(
              'toque relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60',
              aviso.ligado ? 'bg-foreground' : 'bg-foreground/15',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'inline-block size-5 rounded-full bg-background shadow transition-transform',
                aviso.ligado ? 'translate-x-6' : 'translate-x-1',
              )}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}
