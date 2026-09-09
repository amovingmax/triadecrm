/**
 * Leva o evento do Google junto quando a reunião é remarcada no CRM.
 *
 * ---------------------------------------------------------------------------
 * O BURACO QUE ESTA ROTA FECHA
 * ---------------------------------------------------------------------------
 * Reagendar, no Tríade, não altera a tarefa da reunião: `move_deal` FECHA a
 * antiga e insere uma NOVA com a data combinada. O espelho em
 * `compromissos_no_google` é chaveado por `task_id`, então ele continuava
 * apontando para a tarefa fechada — e o evento seguia no horário velho.
 *
 * O efeito era o pior possível e invisível do nosso lado: o fornecedor ficava com
 * um convite para um horário que não valia mais, enquanto no CRM a reunião nova
 * aparecia certinha.
 *
 * ---------------------------------------------------------------------------
 * A ORDEM, E POR QUE ELA É ESSA
 * ---------------------------------------------------------------------------
 * 1. Google primeiro (PATCH no evento).
 * 2. Só depois o espelho muda de dono, para a tarefa nova.
 *
 * Se invertesse, e o PATCH falhasse, o CRM mostraria a reunião nova como "já está
 * na agenda" com um link para um evento no horário ERRADO — mentira invisível.
 * Nesta ordem, a falha possível é o inverso: o Google fica certo e o espelho não
 * se move. Aí a tarefa nova oferece "Pôr na agenda", e quem clicar cria um
 * segundo evento — erro visível, que uma pessoa vê e apaga.
 *
 * ---------------------------------------------------------------------------
 * O TOKEN É O DE QUEM CRIOU, NÃO O DE QUEM CLICOU
 * ---------------------------------------------------------------------------
 * O evento vive na agenda de quem o criou. Se a Heloísa remarca uma reunião que a
 * Bárbara pôs na agenda, o token da Heloísa não alcança aquele evento — o Google
 * responderia 404. Por isso `agenda_google_token_do_evento`, e não
 * `agenda_google_token`.
 */
import { NextResponse, type NextRequest } from 'next/server';

import {
  RECADO_DO_GOOGLE,
  remarcarEvento,
  temCredenciaisDoGoogle,
  type MotivoDoGoogle,
} from '@/lib/google/agenda';
import { createClient } from '@/lib/supabase/server';
import { criarClienteAdmin, temChaveDeServico } from '@/lib/supabase/servidor-admin';

const MINUTOS_REUNIAO = 45;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, motivo: 'sem_sessao' }, { status: 401 });

  if (!temChaveDeServico() || !temCredenciaisDoGoogle()) {
    return NextResponse.json({ ok: false, motivo: 'nao_configurado' }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => ({}))) as {
    task_id?: unknown;
    novo_horario?: unknown;
  };
  const taskId = typeof corpo.task_id === 'string' ? corpo.task_id : '';
  const horario = typeof corpo.novo_horario === 'string' ? corpo.novo_horario : '';
  if (!taskId || !horario) {
    return NextResponse.json({ ok: false, motivo: 'pedido_incompleto' }, { status: 400 });
  }

  const quando = new Date(horario);
  if (Number.isNaN(quando.getTime())) {
    return NextResponse.json({ ok: false, motivo: 'horario_invalido' }, { status: 400 });
  }

  // Acesso pela RLS da pessoa, como na criação: se ela não enxerga a tarefa
  // antiga, não remarca o evento dela.
  const { data: visivel } = await supabase.from('tasks').select('id').eq('id', taskId).maybeSingle();
  if (!visivel) {
    return NextResponse.json({ ok: false, motivo: 'tarefa_invisivel' }, { status: 404 });
  }

  const admin = criarClienteAdmin();

  const { data: espelhoBruto } = await admin
    .schema('app')
    .rpc('compromisso_do_google_ler', { p_task_id: taskId });
  const espelho = espelhoBruto as { evento_id?: string; agenda_id?: string } | null;
  if (!espelho?.evento_id) {
    // Normal e não é erro: a reunião antiga nunca foi para o Google. Não há o que
    // remarcar, e a tarefa nova pode ser posta na agenda quando alguém quiser.
    return NextResponse.json({ ok: false, motivo: 'sem_espelho' }, { status: 404 });
  }

  const { data: token } = await admin
    .schema('app')
    .rpc('agenda_google_token_do_evento', { p_task_id: taskId });
  if (!token) {
    // Quem criou o evento desconectou a agenda. O evento continua lá, e ninguém
    // aqui tem como alterá-lo.
    return NextResponse.json({ ok: false, motivo: 'dono_desconectado' }, { status: 409 });
  }

  const r = await remarcarEvento(
    token as string,
    espelho.agenda_id ?? 'primary',
    espelho.evento_id,
    quando,
    MINUTOS_REUNIAO,
  );

  if (!r.ok) {
    // Evento apagado à mão no Google: o espelho não descreve mais nada. Esquecer
    // é o certo — deixá-lo faria a tarefa nova herdar um link morto.
    if (r.motivo === 'evento_sumiu') {
      await admin.schema('app').rpc('compromisso_do_google_esquecer', { p_task_id: taskId });
      return NextResponse.json({ ok: false, motivo: 'evento_sumiu' }, { status: 409 });
    }
    return NextResponse.json(
      { ok: false, motivo: r.motivo, recado: RECADO_DO_GOOGLE[r.motivo as MotivoDoGoogle] },
      { status: 502 },
    );
  }

  const { data: mudou } = await admin.schema('app').rpc('compromisso_do_google_remanejar', {
    p_task_antiga: taskId,
    p_novo_horario: quando.toISOString(),
  });
  const m = (mudou ?? {}) as { ok?: boolean; motivo?: string };

  if (m.ok !== true) {
    // O Google já está certo. O que falhou foi apontar o espelho para a tarefa
    // nova, e dizer "ok" aqui esconderia que a reunião nova vai oferecer "Pôr na
    // agenda" — e criar um segundo evento se alguém clicar.
    return NextResponse.json(
      { ok: false, motivo: 'remarcado_sem_religar', detalhe: m.motivo },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, link_html: r.linkHtml });
}
