/**
 * TESTE DA IA QUE ATENDE — SÓ EM `next dev`, SÓ COM O SUPABASE LOCAL.
 *
 * No CRM, tudo o que se escreve na conversa sai como mensagem da EQUIPE, e mensagem
 * da equipe para a IA (gente assumiu). Para conversar com a IA no computador, é
 * preciso escrever como o CLIENTE: esta rota grava uma mensagem recebida, igual à
 * que o WhatsApp entregaria, e a fila da IA (`app.ia_atendente_enfileirar`) a pega
 * como pegaria a de verdade.
 *
 * Travas: as mesmas do `/auth/dev` (`entradaLocalLigada`: `next dev` e banco local;
 * fora delas, 404), pessoa logada, módulo da IA ligado e SÓ a conversa do treino ou
 * uma de teste (10/11/2026).
 * Nada vai ao WhatsApp: a mensagem nasce no banco local, como recebida.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { entradaLocalLigada } from '@/lib/auth/entrada-local';
import { EMPRESA } from '@/lib/empresa';
import { createClient } from '@/lib/supabase/server';
import { criarClienteAdmin, temChaveDeServico } from '@/lib/supabase/servidor-admin';

const NAO_ACHOU = () => new NextResponse('Not found', { status: 404 });

export async function POST(request: NextRequest) {
  if (!entradaLocalLigada() || !EMPRESA.modulos.iaQueAtende) return NAO_ACHOU();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Entre no CRM primeiro.' }, { status: 401 });
  if (!temChaveDeServico()) {
    return NextResponse.json({ erro: 'Falta SUPABASE_SERVICE_ROLE_KEY no .env.local.' }, { status: 500 });
  }

  const corpo = (await request.json().catch(() => null)) as { conversa?: unknown; texto?: unknown } | null;
  const conversa = typeof corpo?.conversa === 'string' ? corpo.conversa : '';
  const texto = typeof corpo?.texto === 'string' ? corpo.texto.trim() : '';
  if (conversa === '' || texto === '') {
    return NextResponse.json({ erro: 'Escreva a mensagem do cliente.' }, { status: 400 });
  }
  if (texto.length > 2000) {
    return NextResponse.json({ erro: 'Mensagem longa demais (até 2.000 letras).' }, { status: 400 });
  }

  const admin = criarClienteAdmin();
  const { data: config } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'ia.atendente')
    .maybeSingle();
  const valor = (config?.value ?? null) as Record<string, unknown> | null;
  const treino = valor?.conversa_de_treino;
  const testes = Array.isArray(valor?.conversas_de_teste) ? (valor.conversas_de_teste as unknown[]) : [];
  if (treino !== conversa && !testes.includes(conversa)) {
    return NextResponse.json(
      { erro: 'Só dá para escrever como o cliente na conversa do treino ou numa de teste.' },
      { status: 403 },
    );
  }

  const { error } = await admin.from('messages').insert({
    conversation_id: conversa,
    direction: 'in',
    type: 'text',
    status: 'received',
    body: texto,
    author_kind: 'system',
    origin: 'crm',
  } as never);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
