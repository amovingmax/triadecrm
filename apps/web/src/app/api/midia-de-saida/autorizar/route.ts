/**
 * Foto e vídeo, passo 1 de 2: a autorização para subir o arquivo (16/10/2026).
 *
 * ===========================================================================
 * POR QUE O ARQUIVO NÃO PASSA POR AQUI, COMO O ÁUDIO PASSA
 * ===========================================================================
 * A função da Vercel não recebe corpo acima de 4,5 MB, e o vídeo do WhatsApp
 * vai até 16 MB. Então o arquivo sobe DIRETO do navegador para o balde, com uma
 * autorização de uso único (`createSignedUploadUrl`) que só esta rota emite —
 * depois de a sessão de quem envia provar que alcança a conversa.
 *
 * O balde continua sem política de escrita para `authenticated` (migração
 * `20260905000201`): a autorização vale para UM caminho, escolhido aqui, dentro
 * da pasta da conversa. O navegador não escolhe onde escreve.
 *
 * O passo 2 (`/api/midia-de-saida/enviar`) confere que o arquivo chegou e grava
 * a mensagem com a sessão de quem enviou.
 */
import { NextResponse, type NextRequest } from 'next/server';

import {
  BALDE_DAS_MIDIAS,
  caminhoDaMidia,
  conferirParaSubir,
  type TipoDeMidia,
} from '@/lib/midia-de-saida';
import { registrarRecusa } from '@/lib/registro-do-servidor';
import { createClient } from '@/lib/supabase/server';
import { criarClienteAdmin, temChaveDeServico } from '@/lib/supabase/servidor-admin';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, motivo: 'sem_sessao' }, { status: 401 });

  if (!temChaveDeServico()) {
    registrarRecusa('midia-de-saida/autorizar', 'nao_configurado');
    return NextResponse.json({ ok: false, motivo: 'nao_configurado' }, { status: 503 });
  }

  const pedido = (await request.json().catch(() => null)) as {
    conversation_id?: unknown;
    tipo?: unknown;
    mime?: unknown;
    tamanho?: unknown;
  } | null;
  const fioId = typeof pedido?.conversation_id === 'string' ? pedido.conversation_id.trim() : '';
  const tipo =
    pedido?.tipo === 'image' || pedido?.tipo === 'video' ? (pedido.tipo as TipoDeMidia) : null;
  if (fioId === '' || tipo === null || typeof pedido?.mime !== 'string') {
    return NextResponse.json({ ok: false, motivo: 'pedido_incompleto' }, { status: 400 });
  }

  const conferido = conferirParaSubir(tipo, pedido.mime, Number(pedido.tamanho));
  if (!conferido.ok) {
    return NextResponse.json({ ok: false, motivo: conferido.motivo }, { status: 415 });
  }

  // A conversa precisa ser alcançável PELA SESSÃO DELA.
  const { data: fio, error: erroDoFio } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', fioId)
    .maybeSingle();
  if (erroDoFio) {
    registrarRecusa('midia-de-saida/autorizar', 'consulta_falhou');
    return NextResponse.json({ ok: false, motivo: 'consulta_falhou' }, { status: 500 });
  }
  if (!fio) return NextResponse.json({ ok: false, motivo: 'conversa_invisivel' }, { status: 404 });

  const caminho = caminhoDaMidia(fioId, conferido.extensao);
  const { data, error } = await criarClienteAdmin()
    .storage.from(BALDE_DAS_MIDIAS)
    .createSignedUploadUrl(caminho);
  if (error || !data) {
    registrarRecusa('midia-de-saida/autorizar', 'balde_recusou');
    return NextResponse.json(
      { ok: false, motivo: 'balde_recusou', detalhe: error?.message },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, caminho: data.path, token: data.token });
}
