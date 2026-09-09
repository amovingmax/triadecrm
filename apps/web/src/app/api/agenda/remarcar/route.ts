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
 *
 * ---------------------------------------------------------------------------
 * QUEM PODE MEXER
 * ---------------------------------------------------------------------------
 * A RLS de `tasks`, a única checagem que existia aqui, responde uma pergunta
 * mais fraca do que esta rota precisa: se a reunião aparece na tela de quem
 * clicou. Depois dela a rota usa o cliente de serviço e o token de outra pessoa,
 * e nada mais barra ninguém — um perfil de Leitura, que o banco impede até de
 * gravar uma atividade, mudava a hora de um evento na agenda pessoal de quem o
 * criou, e o Google avisava o fornecedor do novo horário. A pessoa que marcou
 * não ficava sabendo.
 *
 * Agora decide papel E autoria: admin e gestor respondem pela agenda do time;
 * fora esses dois, só quem criou o evento remarca.
 *
 * Onde isso deveria morar: no Postgres (ADR-03), numa função que decida e que as
 * duas rotas chamem. Está no TypeScript porque as rotas chegam ao espelho com o
 * cliente de serviço, que passa por cima da RLS — e essa mudança é maior que a
 * correção urgente. Enquanto não desce, a regra existe duplicada aqui e em
 * `remover`, e mudar uma sem a outra é como as duas versões divergem.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getSession } from '@/lib/auth/session';
import {
  RECADO_DO_GOOGLE,
  remarcarEvento,
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

const MINUTOS_REUNIAO = 45;

export async function POST(request: NextRequest) {
  // `getSession` e não `requireSession`: aquele redireciona para /login, e um
  // redirecionamento aqui devolveria ao `fetch` da tela a página de login com
  // status 200 — o cliente leria sucesso onde houve recusa. As claims são as
  // mesmas que as páginas leem, e o papel sai delas; não há segunda fonte de
  // verdade para papel.
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ ok: false, motivo: 'sem_sessao' }, { status: 401 });

  const supabase = await createClient();

  if (!temChaveDeServico() || !temCredenciaisDoGoogle()) {
    registrarRecusa('agenda/remarcar', 'nao_configurado');
    return NextResponse.json({ ok: false, motivo: 'nao_configurado' }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => ({}))) as {
    task_id?: unknown;
    novo_horario?: unknown;
  };
  const taskId = typeof corpo.task_id === 'string' ? corpo.task_id : '';
  const horario = typeof corpo.novo_horario === 'string' ? corpo.novo_horario : '';
  if (!taskId || !horario) {
    registrarRecusa('agenda/remarcar', 'pedido_incompleto');
    return NextResponse.json({ ok: false, motivo: 'pedido_incompleto' }, { status: 400 });
  }

  const quando = new Date(horario);
  if (Number.isNaN(quando.getTime())) {
    registrarRecusa('agenda/remarcar', 'horario_invalido');
    return NextResponse.json({ ok: false, motivo: 'horario_invalido' }, { status: 400 });
  }

  // Acesso pela RLS da pessoa, como na criação: se ela não enxerga a tarefa
  // antiga, não remarca o evento dela.
  const { data: visivel } = await supabase.from('tasks').select('id').eq('id', taskId).maybeSingle();
  if (!visivel) {
    registrarRecusa('agenda/remarcar', 'tarefa_invisivel');
    return NextResponse.json({ ok: false, motivo: 'tarefa_invisivel' }, { status: 404 });
  }

  const admin = criarClienteAdmin();

  const espelhoBruto = await rpcDoServidor(admin, 'agenda/remarcar', 'compromisso_do_google_ler', {
    p_task_id: taskId,
  });
  const espelho = espelhoBruto as {
    evento_id?: string;
    agenda_id?: string;
    criado_por?: string | null;
  } | null;
  if (!espelho?.evento_id) {
    // Normal e não é erro: a reunião antiga nunca foi para o Google. Não há o que
    // remarcar, e a tarefa nova pode ser posta na agenda quando alguém quiser.
    registrarRecusa('agenda/remarcar', 'sem_espelho');
    return NextResponse.json({ ok: false, motivo: 'sem_espelho' }, { status: 404 });
  }

  // A autorização vem depois de ler o espelho porque é o espelho que sabe de quem
  // é o evento, e antes de o Google ser tocado: até aqui nada mudou de horário e
  // nenhum convidado foi avisado.
  //
  // `criado_por` nulo é o perfil que saiu do CRM. O evento fica sem dono, e só
  // admin ou gestor mexe — ninguém herda o compromisso de quem foi embora.
  const respondePelaAgendaDoTime = sessao.papel === 'admin' || sessao.papel === 'gestor';
  if (!respondePelaAgendaDoTime && espelho.criado_por !== sessao.id) {
    registrarRecusa('agenda/remarcar', 'nao_e_seu', { papel: sessao.papel });
    return NextResponse.json({ ok: false, motivo: 'nao_e_seu' }, { status: 403 });
  }

  const token = await rpcDoServidor<string>(
    admin,
    'agenda/remarcar',
    'agenda_google_token_do_evento',
    { p_task_id: taskId },
  );
  if (!token) {
    // Quem criou o evento desconectou a agenda. O evento continua lá, e ninguém
    // aqui tem como alterá-lo.
    registrarRecusa('agenda/remarcar', 'dono_desconectado');
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
      await admin.rpc('compromisso_do_google_esquecer', { p_task_id: taskId });
      registrarRecusa('agenda/remarcar', 'evento_sumiu');
      return NextResponse.json({ ok: false, motivo: 'evento_sumiu' }, { status: 409 });
    }
    registrarRecusa('agenda/remarcar', r.motivo, { detalhe: r.detalhe });
    return NextResponse.json(
      { ok: false, motivo: r.motivo, recado: RECADO_DO_GOOGLE[r.motivo as MotivoDoGoogle] },
      { status: 502 },
    );
  }

  const mudou = await rpcDoServidor(admin, 'agenda/remarcar', 'compromisso_do_google_remanejar', {
    p_task_antiga: taskId,
    p_novo_horario: quando.toISOString(),
  });
  const m = (mudou ?? {}) as { ok?: boolean; motivo?: string };

  if (m.ok !== true) {
    // O Google já está certo. O que falhou foi apontar o espelho para a tarefa
    // nova, e dizer "ok" aqui esconderia que a reunião nova vai oferecer "Pôr na
    // agenda" — e criar um segundo evento se alguém clicar.
    registrarRecusa('agenda/remarcar', 'remarcado_sem_religar');
    return NextResponse.json(
      { ok: false, motivo: 'remarcado_sem_religar', detalhe: m.motivo },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, link_html: r.linkHtml });
}
