/**
 * Guarda o consentimento da agenda Google que acabou de voltar do Google.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA ROTA EXISTE, EM VEZ DE O CALLBACK RESOLVER
 * ---------------------------------------------------------------------------
 * O Supabase devolve `provider_refresh_token` UMA VEZ, no objeto de sessão, e
 * não o guarda em lugar nenhum: da próxima vez que a sessão for lida ele já não
 * está lá. Ou o pegamos no instante do consentimento, ou ele se perde e a pessoa
 * precisa consentir de novo.
 *
 * O navegador tem esse token em mãos por um instante (está na sessão). Ele o
 * manda para cá, e daqui ele vai direto para o Vault. É o único momento em que
 * uma credencial de agenda passa pelo cliente, e é uma consequência de como o
 * Supabase Auth funciona, não uma escolha.
 *
 * O que esta rota NÃO faz, e é o que a torna segura: ela não confia no `user_id`
 * que o corpo mandar. Ela lê a sessão dos cookies, com o cliente que respeita a
 * RLS, e guarda o token para AQUELA pessoa. Um corpo forjado com o id de outra
 * pessoa grava na conta de quem enviou, que é o pior que ele consegue fazer.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { ESCOPO_AGENDA } from '@/lib/google/agenda';
import { registrarRecusa } from '@/lib/registro-do-servidor';
import { createClient } from '@/lib/supabase/server';
import {
  criarClienteAdmin,
  rpcDoServidor,
  temChaveDeServico,
} from '@/lib/supabase/servidor-admin';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, motivo: 'sem_sessao' }, { status: 401 });
  }

  if (!temChaveDeServico()) {
    registrarRecusa('agenda/conectar', 'nao_configurado');
    return NextResponse.json({ ok: false, motivo: 'nao_configurado' }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => ({}))) as {
    refresh_token?: unknown;
    email?: unknown;
  };

  const refreshToken = typeof corpo.refresh_token === 'string' ? corpo.refresh_token.trim() : '';
  if (!refreshToken) {
    // Acontece de verdade, e não é erro de quem clicou: o Google só devolve
    // refresh token com `access_type=offline` E `prompt=consent`. Quem já
    // consentiu antes e reconecta sem forçar o consentimento recebe só o access
    // token, e a ligação não pode ser guardada.
    registrarRecusa('agenda/conectar', 'sem_refresh_token');
    return NextResponse.json({ ok: false, motivo: 'sem_refresh_token' }, { status: 400 });
  }

  const email =
    (typeof corpo.email === 'string' && corpo.email.trim()) || user.email || '';
  if (!email) {
    registrarRecusa('agenda/conectar', 'sem_email');
    return NextResponse.json({ ok: false, motivo: 'sem_email' }, { status: 400 });
  }

  const admin = criarClienteAdmin();
  const data = await rpcDoServidor(admin, 'agenda/conectar', 'agenda_google_guardar', {
    p_user_id: user.id,
    p_refresh_token: refreshToken,
    p_email_google: email,
    p_escopos: [ESCOPO_AGENDA],
  });

  // `rpcDoServidor` já registrou o erro no log com o código do Postgres; aqui o
  // nulo só precisa virar recusa nomeada.
  if (data === null) {
    registrarRecusa('agenda/conectar', 'falha_ao_guardar');
    return NextResponse.json({ ok: false, motivo: 'falha_ao_guardar' }, { status: 500 });
  }

  const r = data as { ok?: boolean; motivo?: string; email?: string };
  if (r.ok !== true) {
    return NextResponse.json({ ok: false, motivo: r.motivo ?? 'desconhecido' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, email: r.email });
}
