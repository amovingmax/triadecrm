/**
 * O link rastreado dos envios em massa (migração 20260921110000).
 *
 * O botão de link de um modelo aponta para `/r/<código>`. Quem abre é o
 * PARCEIRO, sem sessão nenhuma: esta rota grava o primeiro clique e manda para
 * o destino do envio, com a campanha na URL (utm_*), para o pixel da Meta
 * saber de onde veio o cadastro.
 *
 * O destino vem do banco, nunca da URL: quem clica não escolhe para onde vai,
 * e um código estranho cai no destino padrão — não numa página de erro, que
 * para o parceiro seria "o link da Komune está quebrado".
 */
import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

const DESTINO_DE_EMERGENCIA = 'https://admin.komune.app.br/seja-parceiro';

export async function GET(_req: NextRequest, ctx: RouteContext<'/r/[codigo]'>) {
  const { codigo } = await ctx.params;
  let destino = DESTINO_DE_EMERGENCIA;
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc('envio_clique', { p_codigo: codigo });
    if (typeof data === 'string' && data.startsWith('https://')) destino = data;
  } catch {
    // Banco fora do ar não pode virar link quebrado para o parceiro.
  }
  return NextResponse.redirect(destino, 302);
}
