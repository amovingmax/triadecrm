/**
 * O arquivo de um grupo de WhatsApp, passo 1: a autorização para subir
 * (27/10/2026). Mesmo desenho de `/api/midia-de-saida/autorizar`, e pela mesma
 * razão: a função da Vercel não recebe corpo acima de 4,5 MB, e o vídeo vai até
 * 16 MB, o documento até 50. O arquivo sobe DIRETO do navegador para o balde,
 * com uma autorização de uso único que só esta rota emite, para UM caminho
 * escolhido aqui, dentro da pasta do grupo (`grupos/<grupo_id>/`).
 *
 * Duas finalidades:
 *   * `mensagem`: foto, vídeo, áudio ou documento que vai para o grupo. Depois
 *     de subir, a tela chama `grupo_enviar` com o caminho.
 *   * `capa`: a foto do grupo, sempre `grupos/<grupo_id>/foto.jpg` (a nova
 *     sobrescreve a antiga). Depois, a tela chama `grupo_atualizar`.
 *
 * Quem pode: admin, gestor e SDR (`app.grupo_posso`), e o grupo tem de ser
 * alcançável PELA SESSÃO de quem pede e estar ativo no WhatsApp.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { roleFromClaims } from '@/lib/auth/role';
import {
  BALDE_DOS_GRUPOS,
  caminhoDaCapaDoGrupo,
  caminhoNoGrupo,
  conferirArquivoDoGrupo,
  conferirCapa,
  ehUuid,
  type TipoNoGrupo,
} from '@/lib/midia-dos-grupos';
import { registrarRecusa } from '@/lib/registro-do-servidor';
import { createClient } from '@/lib/supabase/server';
import { criarClienteAdmin, temChaveDeServico } from '@/lib/supabase/servidor-admin';

const ROTA = 'grupos/midia';
const PAPEIS_DOS_GRUPOS = new Set(['admin', 'gestor', 'sdr']);
const TIPOS: ReadonlySet<string> = new Set(['image', 'video', 'audio', 'document']);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: sessao } = await supabase.auth.getClaims();
  if (!sessao?.claims) {
    return NextResponse.json({ ok: false, motivo: 'sem_sessao' }, { status: 401 });
  }
  if (!PAPEIS_DOS_GRUPOS.has(roleFromClaims(sessao.claims))) {
    return NextResponse.json({ ok: false, motivo: 'sem_permissao' }, { status: 403 });
  }

  if (!temChaveDeServico()) {
    registrarRecusa(ROTA, 'nao_configurado');
    return NextResponse.json({ ok: false, motivo: 'nao_configurado' }, { status: 503 });
  }

  const pedido = (await request.json().catch(() => null)) as {
    grupo_id?: unknown;
    finalidade?: unknown;
    tipo?: unknown;
    mime?: unknown;
    tamanho?: unknown;
  } | null;
  const grupoId = pedido?.grupo_id;
  const capa = pedido?.finalidade === 'capa';
  if (!ehUuid(grupoId) || typeof pedido?.mime !== 'string') {
    return NextResponse.json({ ok: false, motivo: 'pedido_incompleto' }, { status: 400 });
  }

  let caminho: string;
  if (capa) {
    // A capa sai da tela já em JPEG quadrado; PNG é recusado aqui porque o
    // caminho é `.jpg` e a Meta quer JPEG.
    const conferida = conferirCapa(pedido.mime, Number(pedido.tamanho));
    if (!conferida.ok || conferida.extensao !== 'jpg') {
      return NextResponse.json(
        { ok: false, motivo: conferida.ok ? 'tipo_nao_aceito' : conferida.motivo },
        { status: 415 },
      );
    }
    caminho = caminhoDaCapaDoGrupo(grupoId);
  } else {
    const tipo = typeof pedido?.tipo === 'string' && TIPOS.has(pedido.tipo) ? pedido.tipo : null;
    if (tipo === null) {
      return NextResponse.json({ ok: false, motivo: 'pedido_incompleto' }, { status: 400 });
    }
    const conferido = conferirArquivoDoGrupo(
      tipo as TipoNoGrupo,
      pedido.mime,
      Number(pedido.tamanho),
    );
    if (!conferido.ok) {
      return NextResponse.json({ ok: false, motivo: conferido.motivo }, { status: 415 });
    }
    caminho = caminhoNoGrupo(grupoId, conferido.extensao);
  }

  // O grupo precisa ser alcançável PELA SESSÃO dela (RLS de `wa_grupos`).
  const { data: grupo, error: erroDoGrupo } = await supabase
    .from('wa_grupos')
    .select('id, estado')
    .eq('id', grupoId)
    .maybeSingle();
  if (erroDoGrupo) {
    registrarRecusa(ROTA, 'consulta_falhou');
    return NextResponse.json({ ok: false, motivo: 'consulta_falhou' }, { status: 500 });
  }
  if (!grupo) return NextResponse.json({ ok: false, motivo: 'grupo_invisivel' }, { status: 404 });
  if (grupo.estado !== 'ativo') {
    return NextResponse.json({ ok: false, motivo: 'grupo_nao_esta_ativo' }, { status: 409 });
  }

  const { data, error } = await criarClienteAdmin()
    .storage.from(BALDE_DOS_GRUPOS)
    .createSignedUploadUrl(caminho, { upsert: capa });
  if (error || !data) {
    registrarRecusa(ROTA, 'balde_recusou');
    return NextResponse.json(
      { ok: false, motivo: 'balde_recusou', detalhe: error?.message },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, caminho: data.path, token: data.token });
}
