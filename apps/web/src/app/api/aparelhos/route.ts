/**
 * O app registra este aparelho para os avisos de quem está logado NESTA empresa
 * (`lib/avisos-no-celular.ts`). Só com sessão: o aparelho fica com a pessoa da sessão,
 * nunca com alguém que o pedido diga.
 *
 *   204  registrado (ou passado para quem está logado agora).
 *   400  corpo sem endereço de push válido.
 *   401  sem sessão: o app tenta de novo na próxima tela logada.
 *   503  o banco recusou.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { levarAparelhoAsOutrasEmpresas } from '@/lib/aparelho-entre-empresas';
import { plataformaValida, tokenValido } from '@/lib/avisos-no-celular';
import { EMPRESA } from '@/lib/empresa';
import { createClient } from '@/lib/supabase/server';

const SEM_CACHE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  const corpo = (await request.json().catch(() => null)) as {
    token?: unknown;
    plataforma?: unknown;
  } | null;
  if (!tokenValido(corpo?.token) || !plataformaValida(corpo?.plataforma)) {
    return NextResponse.json(
      { ok: false, motivo: 'malformado' },
      { status: 400, headers: SEM_CACHE },
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return NextResponse.json(
      { ok: false, motivo: 'sem_sessao' },
      { status: 401, headers: SEM_CACHE },
    );
  }

  const { error } = await supabase.rpc(
    'aparelho_registrar' as never,
    {
      p_token: corpo.token,
      p_plataforma: corpo.plataforma,
      p_empresa: EMPRESA.slug,
      p_empresa_nome: EMPRESA.nome,
    } as never,
  );
  if (error) {
    console.error(`[erro] /api/aparelhos aparelho_registrar: ${error.message}`);
    return NextResponse.json({ ok: false, motivo: 'banco' }, { status: 503, headers: SEM_CACHE });
  }
  // E nas outras empresas em que a pessoa entra: os avisos chegam qualquer que seja a
  // empresa aberta no app (`lib/aparelho-entre-empresas.ts`).
  const email = typeof data.claims.email === 'string' ? data.claims.email : null;
  if (email) await levarAparelhoAsOutrasEmpresas(email, 'registrar', corpo.token, corpo.plataforma);
  return new NextResponse(null, { status: 204, headers: SEM_CACHE });
}
