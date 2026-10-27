/**
 * A foto do perfil da empresa no WhatsApp: a autorização para subir
 * (27/10/2026). Só admin, como `wa_perfil_salvar`.
 *
 * O arquivo sobe direto do navegador para o balde `mensagens`, em
 * `perfil/<uuid>.jpg`, com a autorização de uso único que esta rota emite. A
 * tela manda a foto já quadrada e em JPEG; PNG também é aceito, porque a Meta
 * aceita os dois. Depois de subir, a tela chama `wa_perfil_salvar` com
 * `foto_path`, e o worker-wa leva a foto à Meta.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { roleFromClaims } from '@/lib/auth/role';
import { BALDE_DOS_GRUPOS, caminhoDaFotoDoPerfil, conferirCapa } from '@/lib/midia-dos-grupos';
import { registrarRecusa } from '@/lib/registro-do-servidor';
import { createClient } from '@/lib/supabase/server';
import { criarClienteAdmin, temChaveDeServico } from '@/lib/supabase/servidor-admin';

const ROTA = 'whatsapp/perfil-foto';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: sessao } = await supabase.auth.getClaims();
  if (!sessao?.claims) {
    return NextResponse.json({ ok: false, motivo: 'sem_sessao' }, { status: 401 });
  }
  if (roleFromClaims(sessao.claims) !== 'admin') {
    return NextResponse.json({ ok: false, motivo: 'sem_permissao' }, { status: 403 });
  }

  if (!temChaveDeServico()) {
    registrarRecusa(ROTA, 'nao_configurado');
    return NextResponse.json({ ok: false, motivo: 'nao_configurado' }, { status: 503 });
  }

  const pedido = (await request.json().catch(() => null)) as {
    mime?: unknown;
    tamanho?: unknown;
  } | null;
  if (typeof pedido?.mime !== 'string') {
    return NextResponse.json({ ok: false, motivo: 'pedido_incompleto' }, { status: 400 });
  }
  const conferida = conferirCapa(pedido.mime, Number(pedido.tamanho));
  if (!conferida.ok) {
    return NextResponse.json({ ok: false, motivo: conferida.motivo }, { status: 415 });
  }

  const { data, error } = await criarClienteAdmin()
    .storage.from(BALDE_DOS_GRUPOS)
    .createSignedUploadUrl(caminhoDaFotoDoPerfil(conferida.extensao));
  if (error || !data) {
    registrarRecusa(ROTA, 'balde_recusou');
    return NextResponse.json(
      { ok: false, motivo: 'balde_recusou', detalhe: error?.message },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, caminho: data.path, token: data.token });
}
