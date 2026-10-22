/**
 * A outra empresa pergunta: "este e-mail entra aí?" (decisão do usuário, 22/10/2026).
 *
 * Quem chama é o SERVIDOR da outra empresa, sem sessão e sem cookie, para decidir se
 * mostra o botão de trocar (`lib/outras-empresas.ts`). Por isso a rota é pública no
 * proxy (`ehRotaPublica`), e quem a protege é a assinatura com `SEGREDO_ENTRE_EMPRESAS`
 * (`lib/pergunta-entre-empresas.ts`): sem ela, a rota não responde nada sobre ninguém.
 *
 * A resposta vem do banco desta empresa (`public.email_entra_no_crm`, mesma regra do
 * login) e diz de qual empresa veio, para quem perguntou conferir.
 *
 *   404  este site não tem o segredo: a troca automática está desligada aqui.
 *   400  corpo que não é uma pergunta.
 *   401  pergunta para outra empresa, vencida ou com assinatura errada.
 *   503  sem a chave de serviço ou o banco não respondeu: quem perguntou esconde o botão.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { EMPRESA } from '@/lib/empresa';
import { conferirPergunta } from '@/lib/pergunta-entre-empresas';
import { criarClienteAdmin, rpcDoServidor, temChaveDeServico } from '@/lib/supabase/servidor-admin';

const ROTA = '/api/empresas/acesso';
const SEM_CACHE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  const segredo = process.env.SEGREDO_ENTRE_EMPRESAS;
  if (!segredo) return NextResponse.json({ ok: false }, { status: 404, headers: SEM_CACHE });

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false, motivo: 'malformada' }, { status: 400, headers: SEM_CACHE });
  }

  const conferida = conferirPergunta(segredo, corpo, EMPRESA.slug, Math.floor(Date.now() / 1000));
  if (!conferida.ok) {
    console.warn(`[recusa] ${ROTA} motivo=${conferida.motivo}`);
    const status = conferida.motivo === 'malformada' ? 400 : 401;
    return NextResponse.json({ ok: false, motivo: conferida.motivo }, { status, headers: SEM_CACHE });
  }

  if (!temChaveDeServico()) {
    return NextResponse.json({ ok: false, motivo: 'nao_configurado' }, { status: 503, headers: SEM_CACHE });
  }
  const entra = await rpcDoServidor<boolean>(criarClienteAdmin(), ROTA, 'email_entra_no_crm', {
    p_email: conferida.pergunta.email,
  });
  if (entra === null) {
    return NextResponse.json({ ok: false, motivo: 'banco' }, { status: 503, headers: SEM_CACHE });
  }
  return NextResponse.json({ empresa: EMPRESA.slug, entra }, { headers: SEM_CACHE });
}
