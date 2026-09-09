/**
 * Tira o compromisso do Google Agenda.
 *
 * A saída de emergência da integração. Ela existe por três situações reais:
 *
 *   - a reunião foi cancelada de vez, e o convite continua na agenda do
 *     fornecedor prometendo um encontro que não vai acontecer;
 *   - alguém pôs na agenda por engano;
 *   - o remanejamento falhou no meio e sobraram dois eventos para a mesma
 *     reunião (a rota `remarcar` recusa escolher qual apagar; quem escolhe é
 *     gente, e é aqui).
 *
 * `sendUpdates=all` no DELETE: o convidado precisa saber que foi cancelada. Um
 * cancelamento silencioso é pior que nenhum — o fornecedor aparece.
 *
 * Como em `remarcar`, o token é o de QUEM CRIOU o evento: ele vive na agenda
 * daquela pessoa, e o token de quem está clicando não o alcança.
 */
import { NextResponse, type NextRequest } from 'next/server';

import {
  apagarEvento,
  RECADO_DO_GOOGLE,
  temCredenciaisDoGoogle,
  type MotivoDoGoogle,
} from '@/lib/google/agenda';
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
  if (!user) return NextResponse.json({ ok: false, motivo: 'sem_sessao' }, { status: 401 });

  if (!temChaveDeServico() || !temCredenciaisDoGoogle()) {
    registrarRecusa('agenda/remover', 'nao_configurado');
    return NextResponse.json({ ok: false, motivo: 'nao_configurado' }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => ({}))) as { task_id?: unknown };
  const taskId = typeof corpo.task_id === 'string' ? corpo.task_id : '';
  if (!taskId) {
    registrarRecusa('agenda/remover', 'sem_tarefa');
    return NextResponse.json({ ok: false, motivo: 'sem_tarefa' }, { status: 400 });
  }

  const { data: visivel } = await supabase.from('tasks').select('id').eq('id', taskId).maybeSingle();
  if (!visivel) {
    registrarRecusa('agenda/remover', 'tarefa_invisivel');
    return NextResponse.json({ ok: false, motivo: 'tarefa_invisivel' }, { status: 404 });
  }

  const admin = criarClienteAdmin();

  const espelhoBruto = await rpcDoServidor(admin, 'agenda/remover', 'compromisso_do_google_ler', {
    p_task_id: taskId,
  });
  const espelho = espelhoBruto as { evento_id?: string; agenda_id?: string } | null;
  if (!espelho?.evento_id) {
    registrarRecusa('agenda/remover', 'sem_espelho');
    return NextResponse.json({ ok: false, motivo: 'sem_espelho' }, { status: 404 });
  }

  const token = await rpcDoServidor<string>(
    admin,
    'agenda/remover',
    'agenda_google_token_do_evento',
    { p_task_id: taskId },
  );
  if (!token) {
    // Quem criou desconectou. O espelho aqui não descreve mais nada que a gente
    // consiga alcançar, então ele é esquecido — e a pessoa apaga o evento pelo
    // próprio Google, se quiser.
    await admin.rpc('compromisso_do_google_esquecer', { p_task_id: taskId });
    registrarRecusa('agenda/remover', 'dono_desconectado');
    return NextResponse.json({ ok: false, motivo: 'dono_desconectado' }, { status: 409 });
  }

  const r = await apagarEvento(token as string, espelho.agenda_id ?? 'primary', espelho.evento_id);

  // `apagarEvento` já trata 404 e 410 como sucesso: o estado desejado (evento
  // fora da agenda) é o estado atual.
  if (!r.ok) {
    registrarRecusa('agenda/remover', r.motivo, { detalhe: r.detalhe });
    return NextResponse.json(
      { ok: false, motivo: r.motivo, recado: RECADO_DO_GOOGLE[r.motivo as MotivoDoGoogle] },
      { status: 502 },
    );
  }

  await admin.rpc('compromisso_do_google_esquecer', { p_task_id: taskId });
  return NextResponse.json({ ok: true });
}
