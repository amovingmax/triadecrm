/**
 * Foto e vídeo, passo 2 de 2: o arquivo chegou, a mensagem entra na fila
 * (16/10/2026). O passo 1 e o porquê de serem dois estão em `../autorizar`.
 *
 * O que esta rota confere, e por quê:
 *   1. O caminho é DESTA conversa e tem a forma que o passo 1 deu — senão o
 *      caminho viraria a prova, e caminho quem escolhe é quem pede.
 *   2. O arquivo existe no balde, com o tipo e o tamanho que o WhatsApp aceita.
 *      A autorização do passo 1 vale para um caminho, não para um conteúdo.
 *   3. A linha em `messages` entra com a sessão de quem enviou, não com a chave
 *      de serviço: quem decide se ela pode escrever naquela conversa é a policy
 *      `messages_insert`, como para o texto e o áudio.
 *
 * Como no áudio, janela de 24 h, supressão e tetos não são decididos aqui:
 * `app.wa_proximos` reconfere tudo no instante da entrega.
 */
import { NextResponse, type NextRequest } from 'next/server';

import {
  BALDE_DAS_MIDIAS,
  conferirParaSubir,
  lerCaminho,
  nomeDoDocumento,
  TETO_DA_LEGENDA,
} from '@/lib/midia-de-saida';

/** Um uuid, e só: `responde_a` vai direto para a coluna. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    registrarRecusa('midia-de-saida/enviar', 'nao_configurado');
    return NextResponse.json({ ok: false, motivo: 'nao_configurado' }, { status: 503 });
  }

  const pedido = (await request.json().catch(() => null)) as {
    conversation_id?: unknown;
    caminho?: unknown;
    legenda?: unknown;
    nome?: unknown;
    responde_a?: unknown;
  } | null;
  const fioId = typeof pedido?.conversation_id === 'string' ? pedido.conversation_id.trim() : '';
  const caminho = typeof pedido?.caminho === 'string' ? pedido.caminho : '';
  const legenda = typeof pedido?.legenda === 'string' ? pedido.legenda.trim() : '';
  // O nome do documento (o que o contato vê) e a mensagem citada (27/10/2026).
  // A citação de outra conversa é recusada pelo banco (`app.messages_forma`).
  const nome = typeof pedido?.nome === 'string' ? nomeDoDocumento(pedido.nome) : null;
  const respondeA =
    typeof pedido?.responde_a === 'string' && UUID.test(pedido.responde_a)
      ? pedido.responde_a
      : null;
  if (fioId === '' || caminho === '') {
    return NextResponse.json({ ok: false, motivo: 'pedido_incompleto' }, { status: 400 });
  }
  if (legenda.length > TETO_DA_LEGENDA) {
    return NextResponse.json({ ok: false, motivo: 'legenda_longa' }, { status: 400 });
  }

  const lido = lerCaminho(caminho, fioId);
  if (!lido) {
    registrarRecusa('midia-de-saida/enviar', 'caminho_estranho');
    return NextResponse.json({ ok: false, motivo: 'pedido_incompleto' }, { status: 400 });
  }

  const { data: fio, error: erroDoFio } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', fioId)
    .maybeSingle();
  if (erroDoFio) {
    registrarRecusa('midia-de-saida/enviar', 'consulta_falhou');
    return NextResponse.json({ ok: false, motivo: 'consulta_falhou' }, { status: 500 });
  }
  if (!fio) return NextResponse.json({ ok: false, motivo: 'conversa_invisivel' }, { status: 404 });

  const admin = criarClienteAdmin();
  const balde = admin.storage.from(BALDE_DAS_MIDIAS);
  const { data: arquivo, error: erroDoArquivo } = await balde.info(caminho);
  if (erroDoArquivo || !arquivo) {
    return NextResponse.json({ ok: false, motivo: 'arquivo_nao_chegou' }, { status: 404 });
  }

  // O que chegou é o que o caminho promete? O tipo gravado pelo balde é o que o
  // navegador declarou no upload; a extensão é a que esta rota deu no passo 1.
  const mimeGravado = arquivo.contentType ?? lido.mime;
  const conferido = conferirParaSubir(lido.tipo, mimeGravado, arquivo.size ?? 0);
  if (!conferido.ok || conferido.mime !== lido.mime) {
    await balde.remove([caminho]);
    return NextResponse.json(
      { ok: false, motivo: conferido.ok ? 'tipo_nao_aceito' : conferido.motivo },
      { status: 415 },
    );
  }

  // A figurinha é uma `image` no banco, com `tipo_na_meta`, e não tem legenda
  // (a Meta não aceita). O documento leva o nome do arquivo.
  const figurinha = lido.tipo === 'sticker';
  const { data: mensagem, error: erroDaMensagem } = await supabase
    .from('messages')
    .insert({
      conversation_id: fioId,
      direction: 'out',
      type: figurinha ? 'image' : lido.tipo,
      status: 'queued',
      // A legenda é o corpo; o banco a assina com o primeiro nome (20261016100000).
      body: legenda === '' || figurinha ? null : legenda,
      media_path: caminho,
      media_mime: lido.mime,
      media_nome: lido.tipo === 'document' ? (nome ?? 'documento') : null,
      tipo_na_meta: figurinha ? 'sticker' : null,
      responde_a: respondeA,
      author_kind: 'human',
      sent_by: user.id,
      origin: 'crm',
    })
    .select('id')
    .single();

  if (erroDaMensagem) {
    // O arquivo sem mensagem é lixo no balde: sai junto com a recusa.
    await balde.remove([caminho]);
    registrarRecusa('midia-de-saida/enviar', 'mensagem_recusada');
    return NextResponse.json(
      { ok: false, motivo: 'mensagem_recusada', detalhe: erroDaMensagem.message },
      { status: 403 },
    );
  }

  return NextResponse.json({ ok: true, message_id: mensagem.id });
}
