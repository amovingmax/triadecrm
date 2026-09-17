/**
 * O áudio gravado na tela entra na fila do WhatsApp.
 *
 * ===========================================================================
 * POR QUE PASSA PELO SERVIDOR
 * ===========================================================================
 * O balde `mensagens` é privado e não tem política de escrita para
 * `authenticated` (migração `20260905000201`) — de propósito: um balde onde o
 * navegador escreve é um balde onde qualquer sessão escreve o que quiser, com o
 * nome que quiser. Então o arquivo sobe aqui, com a chave de serviço, **depois**
 * de a sessão de quem gravou provar que alcança aquela conversa.
 *
 * A linha em `messages` é inserida com a sessão DELA, não com a chave de
 * serviço: quem decide se ela pode escrever naquela conversa é a policy
 * `messages_insert`, a mesma da caixa de texto. Inserir como serviço aqui seria
 * abrir uma segunda porta para o que a RLS já governa.
 *
 * ===========================================================================
 * O QUE ESTA ROTA NÃO DECIDE
 * ===========================================================================
 * Janela de 24 h, supressão, teto do dia e janela de horário. Nada disso é
 * conferido aqui — quem conferere é `app.wa_proximos`, no instante da entrega, e
 * é assim que tem de ser: entre gravar e entregar passam segundos ou horas, e a
 * resposta certa é a do momento em que a mensagem sai, não a de agora.
 *
 * A tela esconde o botão fora da janela porque é falta de educação oferecer o
 * que vai falhar — mas a decisão continua sendo do banco.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { registrarRecusa } from '@/lib/registro-do-servidor';
import { createClient } from '@/lib/supabase/server';
import { criarClienteAdmin, temChaveDeServico } from '@/lib/supabase/servidor-admin';

const BALDE = 'mensagens';

/** O teto da Cloud API para áudio (R04 §2.1). Acima disso nem sobe. */
const TETO_BYTES = 16 * 1024 * 1024;

/**
 * O que o navegador sabe gravar. `webm` é o do Chrome e vira `ogg` no worker;
 * `mp4` é o do Safari e sobe como está. O resto não nasce de um `MediaRecorder`
 * e não tem por que entrar.
 */
const TIPOS_ACEITOS = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac']);

function tipoBase(mime: string): string {
  return mime.split(';')[0]!.trim().toLowerCase();
}

function extensaoDe(base: string): string {
  if (base === 'audio/webm') return 'webm';
  if (base === 'audio/mp4') return 'm4a';
  if (base === 'audio/mpeg') return 'mp3';
  if (base === 'audio/aac') return 'aac';
  return 'ogg';
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, motivo: 'sem_sessao' }, { status: 401 });

  if (!temChaveDeServico()) {
    registrarRecusa('audio/enviar', 'nao_configurado');
    return NextResponse.json({ ok: false, motivo: 'nao_configurado' }, { status: 503 });
  }

  const formulario = await request.formData().catch(() => null);
  const fioId = String(formulario?.get('conversation_id') ?? '').trim();
  const arquivo = formulario?.get('arquivo');

  if (fioId === '' || !(arquivo instanceof File)) {
    return NextResponse.json({ ok: false, motivo: 'pedido_incompleto' }, { status: 400 });
  }
  if (arquivo.size === 0) {
    return NextResponse.json({ ok: false, motivo: 'audio_vazio' }, { status: 400 });
  }
  if (arquivo.size > TETO_BYTES) {
    return NextResponse.json({ ok: false, motivo: 'audio_grande_demais' }, { status: 413 });
  }

  const base = tipoBase(arquivo.type || '');
  if (!TIPOS_ACEITOS.has(base)) {
    return NextResponse.json({ ok: false, motivo: 'tipo_nao_aceito' }, { status: 415 });
  }

  // A conversa precisa ser alcançável PELA SESSÃO DELA. Sem isto, o caminho do
  // arquivo viraria a única prova — e caminho quem escolhe é quem pede.
  const { data: fio, error: erroDoFio } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', fioId)
    .maybeSingle();
  if (erroDoFio) {
    registrarRecusa('audio/enviar', 'consulta_falhou');
    return NextResponse.json({ ok: false, motivo: 'consulta_falhou' }, { status: 500 });
  }
  if (!fio) return NextResponse.json({ ok: false, motivo: 'conversa_invisivel' }, { status: 404 });

  // O caminho leva a conversa e o instante: dois áudios do mesmo segundo não se
  // atropelam, e o arquivo de uma conversa nunca cai na pasta de outra.
  const caminho = `${fioId}/saida/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extensaoDe(base)}`;

  const admin = criarClienteAdmin();
  const { error: erroDoBalde } = await admin.storage
    .from(BALDE)
    .upload(caminho, await arquivo.arrayBuffer(), { contentType: base, upsert: false });

  if (erroDoBalde) {
    registrarRecusa('audio/enviar', 'balde_recusou');
    return NextResponse.json({ ok: false, motivo: 'balde_recusou' }, { status: 502 });
  }

  // A linha vai com a sessão de quem gravou: a policy `messages_insert` decide,
  // como decide para a caixa de texto.
  const { data: mensagem, error: erroDaMensagem } = await supabase
    .from('messages')
    .insert({
      conversation_id: fioId,
      direction: 'out',
      type: 'audio',
      status: 'queued',
      media_path: caminho,
      media_mime: base,
      author_kind: 'human',
      sent_by: user.id,
      origin: 'crm',
    })
    .select('id')
    .single();

  if (erroDaMensagem) {
    // O arquivo sem mensagem é lixo no balde: sai junto com a recusa.
    await admin.storage.from(BALDE).remove([caminho]);
    registrarRecusa('audio/enviar', 'mensagem_recusada');
    return NextResponse.json(
      { ok: false, motivo: 'mensagem_recusada', detalhe: erroDaMensagem.message },
      { status: 403 },
    );
  }

  return NextResponse.json({ ok: true, message_id: mensagem.id });
}
