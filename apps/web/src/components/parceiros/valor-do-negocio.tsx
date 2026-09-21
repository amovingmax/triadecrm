'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatarValor } from '@/components/funis/cartao-formatos';

/**
 * O valor da oportunidade, editável na ficha (Fase 2). É aqui que o cartão do
 * funil leva, então é aqui que se põe o valor — um campo, um botão.
 */
export function ValorDoNegocio({
  negocioId,
  valor,
  podeEditar,
}: {
  negocioId: string;
  valor: number | null;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(valor === null ? '' : String(valor).replace('.', ','));
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const limpo = texto.trim().replace(/\./g, '').replace(',', '.');
    const numero = limpo === '' ? null : Number(limpo);
    if (numero !== null && (!Number.isFinite(numero) || numero < 0)) {
      toast.error('Valor inválido.', { description: 'Use só números, como 1500 ou 1.500,50.' });
      return;
    }
    setSalvando(true);
    const { data, error } = await createClient().rpc('definir_valor_do_negocio', {
      p_deal_id: negocioId,
      p_valor: numero ?? undefined,
    });
    setSalvando(false);
    const r = data as { ok?: boolean } | null;
    if (error || !r?.ok) {
      toast.error('O valor não foi salvo.');
      return;
    }
    setEditando(false);
    router.refresh();
  }

  if (!editando) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="numerico">{formatarValor(valor) ?? 'sem valor'}</span>
        {podeEditar ? (
          <Button variant="ghost" size="sm" className="toque h-11 px-2 md:h-6" onClick={() => setEditando(true)}>
            {valor === null ? 'Pôr valor' : 'Mudar'}
          </Button>
        ) : null}
      </span>
    );
  }

  return (
    <form
      className="inline-flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      <label htmlFor={`valor-${negocioId}`} className="sr-only">
        Valor da oportunidade em reais
      </label>
      <Input
        id={`valor-${negocioId}`}
        autoFocus
        inputMode="decimal"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="1.500"
        className="numerico h-11 w-32 md:h-7"
      />
      <Button type="submit" size="sm" className="toque h-11 md:h-7" disabled={salvando}>
        {salvando ? 'Salvando…' : 'Salvar'}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="toque h-11 md:h-7" onClick={() => setEditando(false)}>
        Cancelar
      </Button>
    </form>
  );
}
