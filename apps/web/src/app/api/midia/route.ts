/**
 * A URL assinada de uma mídia recebida no WhatsApp — o endereço que faltava.
 *
 * ===========================================================================
 * POR QUE ISTO EXISTE, E POR QUE NO SERVIDOR
 * ===========================================================================
 * O balde `mensagens` é privado e **não tem política nenhuma** em
 * `storage.objects` (migração `20260905000201`): quem escreve é o worker, com a
 * chave de serviço. A decisão está escrita lá e continua valendo — "balde
 * público para áudio de conversa seria vazamento por configuração".
 *
 * A consequência é que a tela não consegue assinar a URL sozinha, e era isso que
 * o player dizia desde então: *"falta o endereço no servidor que assina a URL"*.
 * Este arquivo é esse endereço.
 *
 * ===========================================================================
 * A ORDEM DAS TRÊS PERGUNTAS IMPORTA
 * ===========================================================================
 * 1. **Tem sessão?** Sem isso não há a quem perguntar o resto.
 * 2. **Esta pessoa enxerga esta mensagem?** A pergunta é feita com a sessão
 *    DELA, não com a chave de serviço — quem responde é a RLS de `messages`, a
 *    mesma que decide o que ela vê na tela. Embaixador fora da carteira recebe
 *    "não existe", que é a verdade do ponto de vista dele.
 * 3. **Só então** a chave de serviço assina a URL do arquivo.
 *
 * Inverter 2 e 3 seria o furo clássico: assinar primeiro e conferir depois dá a
 * qualquer pessoa autenticada o áudio de qualquer conversa, bastando o caminho.
 * Por isso o pedido é por `message_id` e nunca por caminho: caminho vindo do
 * cliente é caminho que o cliente escolhe.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { registrarRecusa } from '@/lib/registro-do-servidor';
import { createClient } from '@/lib/supabase/server';
import { criarClienteAdmin, temChaveDeServico } from '@/lib/supabase/servidor-admin';

/** O balde das mídias recebidas (migração `20260905000201`). */
const BALDE = 'mensagens';

/**
 * Cinco minutos. É tempo de sobra para tocar um áudio de trinta segundos e curto
 * o bastante para a URL não virar um link permanente circulando por aí.
 */
const SEGUNDOS_DA_URL = 300;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, motivo: 'sem_sessao' }, { status: 401 });

  if (!temChaveDeServico()) {
    registrarRecusa('midia/assinar', 'nao_configurado');
    return NextResponse.json({ ok: false, motivo: 'nao_configurado' }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => ({}))) as { message_id?: unknown };
  const messageId = typeof corpo.message_id === 'string' ? corpo.message_id.trim() : '';
  if (messageId === '') {
    return NextResponse.json({ ok: false, motivo: 'sem_mensagem' }, { status: 400 });
  }

  // A pergunta que decide tudo, feita com a sessão de quem pediu: a RLS de
  // `messages` responde exatamente o que esta pessoa pode ver.
  const { data: mensagem, error } = await supabase
    .from('messages')
    .select('id, media_path')
    .eq('id', messageId)
    .maybeSingle();

  if (error) {
    registrarRecusa('midia/assinar', 'consulta_falhou');
    return NextResponse.json({ ok: false, motivo: 'consulta_falhou' }, { status: 500 });
  }
  if (!mensagem) {
    // Invisível pela RLS e inexistente respondem igual, de propósito: dizer
    // "existe, mas não é sua" já conta algo sobre a conversa de outra pessoa.
    return NextResponse.json({ ok: false, motivo: 'mensagem_invisivel' }, { status: 404 });
  }

  const caminho = typeof mensagem.media_path === 'string' ? mensagem.media_path : '';
  if (caminho === '') {
    // Mensagem de áudio cujo arquivo não foi guardado: a URL da Meta expira em
    // minutos, e quando o worker está parado a transcrição fica sem arquivo.
    return NextResponse.json({ ok: false, motivo: 'sem_arquivo' }, { status: 404 });
  }

  const admin = criarClienteAdmin();
  const { data, error: erroDoBalde } = await admin.storage
    .from(BALDE)
    .createSignedUrl(caminho, SEGUNDOS_DA_URL);

  if (erroDoBalde || !data?.signedUrl) {
    registrarRecusa('midia/assinar', 'balde_recusou');
    return NextResponse.json({ ok: false, motivo: 'balde_recusou' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, url: data.signedUrl, expira_em: SEGUNDOS_DA_URL });
}
