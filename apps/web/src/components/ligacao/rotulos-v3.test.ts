import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { rotuloDaObjecao } from './roteiro-objecoes';
import { noSchema } from './tipos';

/**
 * Toda objeção do roteiro publicado tem rótulo na boca do cliente. Sem ele a gaveta
 * mostra a primeira frase da RESPOSTA ("Mando sim, com o passo a passo."), e quem está
 * com o telefone no ouvido não acha a objeção que acabou de ouvir.
 */
const CAMINHO =
  '../../../../../supabase/migrations/20260915100000_o_roteiro_ganha_os_tres_funis.sql';

describe('a gaveta do roteiro v3', () => {
  it('toda objeção tem rótulo próprio, e não o começo da resposta', () => {
    const sql = readFileSync(new URL(CAMINHO, import.meta.url), 'utf8');
    const bruto = /\$roteiro\$([\s\S]*?)\$roteiro\$/.exec(sql)?.[1] ?? '[]';
    const objecoes = (JSON.parse(bruto) as unknown[])
      .map((n) => noSchema.parse(n))
      .filter((n) => n.tipo === 'objecao');
    expect(objecoes.length).toBeGreaterThan(10);
    for (const no of objecoes) {
      const inicio = no.texto.trim().split(/(?<=[.?!])\s/)[0] ?? no.texto;
      expect(rotuloDaObjecao(no), no.id).not.toBe(
        inicio.length > 60 ? `${inicio.slice(0, 57)}…` : inicio,
      );
    }
  });
});
