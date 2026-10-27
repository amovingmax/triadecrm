/**
 * A URL assinada de um arquivo de grupo de WhatsApp (27/10/2026): o arquivo de
 * uma mensagem do grupo (`mensagem_id`) ou a capa do grupo (`grupo_id`).
 *
 * Mesma ordem de `/api/midia`, pela mesma razão: (1) tem sessão? (2) esta
 * pessoa enxerga esta linha, perguntado COM A SESSÃO DELA (RLS de
 * `wa_grupo_mensagens` e `wa_grupos`)? (3) só então a chave de serviço assina.
 * O pedido é por id, nunca por caminho: caminho vindo do cliente é caminho que
 * o cliente escolhe.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { BALDE_DOS_GRUPOS, ehUuid } from '@/lib/midia-dos-grupos';
import { registrarRecusa } from '@/lib/registro-do-servidor';
import { createClient } from '@/lib/supabase/server';
import { criarClienteAdmin, temChaveDeServico } from '@/lib/supabase/servidor-admin';

const ROTA = 'grupos/midia-url';

/** Cinco minutos, como em `/api/midia`. */
const SEGUNDOS_DA_URL = 300;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: sessao } = await supabase.auth.getClaims();
  if (!sessao?.claims) {
    return NextResponse.json({ ok: false, motivo: 'sem_sessao' }, { status: 401 });
  }

  if (!temChaveDeServico()) {
    registrarRecusa(ROTA, 'nao_configurado');
    return NextResponse.json({ ok: false, motivo: 'nao_configurado' }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => ({}))) as {
    mensagem_id?: unknown;
    grupo_id?: unknown;
  };

  let caminho = '';
  if (ehUuid(corpo.mensagem_id)) {
    const { data, error } = await supabase
      .from('wa_grupo_mensagens')
      .select('id, media_path, apagada_em')
      .eq('id', corpo.mensagem_id)
      .maybeSingle();
    if (error) {
      registrarRecusa(ROTA, 'consulta_falhou');
      return NextResponse.json({ ok: false, motivo: 'consulta_falhou' }, { status: 500 });
    }
    // Apagada no CRM é apagada para quem olha o CRM: o arquivo não volta por aqui.
    if (!data || data.apagada_em) {
      return NextResponse.json({ ok: false, motivo: 'mensagem_invisivel' }, { status: 404 });
    }
    caminho = typeof data.media_path === 'string' ? data.media_path : '';
  } else if (ehUuid(corpo.grupo_id)) {
    const { data, error } = await supabase
      .from('wa_grupos')
      .select('id, foto_path')
      .eq('id', corpo.grupo_id)
      .maybeSingle();
    if (error) {
      registrarRecusa(ROTA, 'consulta_falhou');
      return NextResponse.json({ ok: false, motivo: 'consulta_falhou' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, motivo: 'grupo_invisivel' }, { status: 404 });
    }
    caminho = typeof data.foto_path === 'string' ? data.foto_path : '';
  } else {
    return NextResponse.json({ ok: false, motivo: 'pedido_incompleto' }, { status: 400 });
  }

  if (caminho === '') {
    // O worker ainda não baixou o arquivo da Meta, ou o grupo não tem capa.
    return NextResponse.json({ ok: false, motivo: 'sem_arquivo' }, { status: 404 });
  }

  const { data, error } = await criarClienteAdmin()
    .storage.from(BALDE_DOS_GRUPOS)
    .createSignedUrl(caminho, SEGUNDOS_DA_URL);
  if (error || !data?.signedUrl) {
    registrarRecusa(ROTA, 'balde_recusou');
    return NextResponse.json({ ok: false, motivo: 'balde_recusou' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, url: data.signedUrl, expira_em: SEGUNDOS_DA_URL });
}
