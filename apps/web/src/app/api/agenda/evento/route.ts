/**
 * Cria no Google Agenda o evento de uma reunião ou visita já marcada no CRM.
 *
 * ---------------------------------------------------------------------------
 * A ORDEM DAS COISAS, E POR QUE ELA É ESSA
 * ---------------------------------------------------------------------------
 * 1. Quem é a pessoa (cookies, cliente com RLS). Sem sessão, para aqui.
 * 2. A pessoa ENXERGA essa tarefa? A checagem é feita com o cliente dela, não
 *    com o de serviço: é a RLS de `tasks` respondendo, e não uma regra escrita
 *    de novo aqui. Regra de acesso duplicada é regra que diverge.
 * 3. Só então o cliente de serviço entra, para alcançar o que ela não alcança
 *    sozinha: o refresh token no Vault e os dados do evento numa consulta só.
 * 4. Fala com o Google.
 * 5. Grava o espelho.
 *
 * O passo 5 acontece DEPOIS do Google, e não antes: gravar primeiro deixaria o
 * CRM afirmando que existe um evento que talvez não tenha sido criado, e o link
 * do Meet apontaria para o nada.
 *
 * Se o Google criar o evento e a gravação falhar, o evento existe lá e o CRM não
 * sabe. É o único desencontro possível, e é o lado certo de errar: a reunião
 * acontece, e apertar o botão de novo cria um segundo evento que a pessoa vê e
 * apaga. O contrário — CRM prometendo uma sala que não existe — só se descobre
 * na hora da reunião.
 */
import { NextResponse, type NextRequest } from 'next/server';

import {
  criarEvento,
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

/** Duração padrão de uma reunião de apresentação. Visita não usa: ver abaixo. */
const MINUTOS_REUNIAO = 45;
/** Visita presencial: a janela na agenda cobre deslocamento e conversa. */
const MINUTOS_VISITA = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, motivo: 'sem_sessao' }, { status: 401 });
  }

  if (!temChaveDeServico() || !temCredenciaisDoGoogle()) {
    registrarRecusa('agenda/evento', 'nao_configurado');
    return NextResponse.json(
      { ok: false, motivo: 'nao_configurado', recado: RECADO_DO_GOOGLE.nao_configurado },
      { status: 503 },
    );
  }

  const corpo = (await request.json().catch(() => ({}))) as { task_id?: unknown };
  const taskId = typeof corpo.task_id === 'string' ? corpo.task_id : '';
  if (!taskId) {
    registrarRecusa('agenda/evento', 'sem_tarefa');
    return NextResponse.json({ ok: false, motivo: 'sem_tarefa' }, { status: 400 });
  }

  // A RLS da pessoa decide. Se ela não enxerga a tarefa, a consulta volta vazia.
  const { data: visivel, error: erroDeLeitura } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', taskId)
    .maybeSingle();
  if (erroDeLeitura) {
    registrarRecusa('agenda/evento', 'falha_na_leitura');
    return NextResponse.json(
      { ok: false, motivo: 'falha_na_leitura', detalhe: erroDeLeitura.message },
      { status: 500 },
    );
  }
  if (!visivel) {
    registrarRecusa('agenda/evento', 'tarefa_invisivel');
    return NextResponse.json({ ok: false, motivo: 'tarefa_invisivel' }, { status: 404 });
  }

  const admin = criarClienteAdmin();

  const token = await rpcDoServidor<string>(admin, 'agenda/evento', 'agenda_google_token', {
    p_user_id: user.id,
  });
  if (!token) {
    registrarRecusa('agenda/evento', 'agenda_nao_conectada');
    return NextResponse.json({ ok: false, motivo: 'agenda_nao_conectada' }, { status: 409 });
  }

  const dados = await rpcDoServidor(admin, 'agenda/evento', 'agenda_dados_do_evento', {
    p_task_id: taskId,
  });
  if (!dados) {
    registrarRecusa('agenda/evento', 'falha_na_leitura');
    return NextResponse.json(
      { ok: false, motivo: 'falha_na_leitura' },
      { status: 500 },
    );
  }

  const t = dados as {
    titulo: string | null;
    tipo: string | null;
    quando: string | null;
    parceiro: string | null;
    bairro: string | null;
    cidade: string | null;
    convidado: string | null;
    ja_tem_evento: boolean;
  };

  if (!t.quando) {
    // A agenda só lista tarefa com data, então isto seria uma corrida: alguém
    // limpou o prazo entre a tela carregar e o clique.
    registrarRecusa('agenda/evento', 'sem_horario');
    return NextResponse.json({ ok: false, motivo: 'sem_horario' }, { status: 400 });
  }
  if (t.ja_tem_evento) {
    registrarRecusa('agenda/evento', 'ja_tem_evento');
    return NextResponse.json({ ok: false, motivo: 'ja_tem_evento' }, { status: 409 });
  }

  const ehVisita = t.tipo === 'visit';
  const local = ehVisita
    ? [t.bairro, t.cidade].filter(Boolean).join(', ') || undefined
    : undefined;

  const resultado = await criarEvento(token as string, {
    titulo: t.parceiro ? `${t.titulo ?? 'Compromisso'} — ${t.parceiro}` : (t.titulo ?? 'Compromisso'),
    inicio: new Date(t.quando),
    duracaoMin: ehVisita ? MINUTOS_VISITA : MINUTOS_REUNIAO,
    descricao: 'Compromisso criado pelo Tríade, o CRM de captação da Komune.',
    local,
    // Convite só em reunião: numa visita, mandar convite de calendário para o
    // fornecedor promete uma sala que não existe — quem vai é uma pessoa, de
    // carro.
    convidado: ehVisita ? null : t.convidado,
    comMeet: !ehVisita,
  });

  if (!resultado.ok) {
    // `acesso_revogado` não se resolve tentando de novo: o token morreu. Marcar a
    // ligação aqui é o que faz a tela oferecer "reconectar" na próxima vez, em
    // vez de repetir o mesmo erro.
    if (resultado.motivo === 'acesso_revogado') {
      await admin.rpc('agenda_google_falhou', {
        p_user_id: user.id,
        p_erro: resultado.detalhe,
        p_revogar: true,
      });
    } else {
      await admin.rpc('agenda_google_falhou', {
        p_user_id: user.id,
        p_erro: resultado.detalhe,
        p_revogar: false,
      });
    }
    registrarRecusa('agenda/evento', resultado.motivo, { detalhe: resultado.detalhe });
    return NextResponse.json(
      {
        ok: false,
        motivo: resultado.motivo,
        recado: RECADO_DO_GOOGLE[resultado.motivo as MotivoDoGoogle],
      },
      { status: 502 },
    );
  }

  const gravou = await rpcDoServidor(admin, 'agenda/evento', 'compromisso_do_google_gravar', {
    p_task_id: taskId,
    p_evento_id: resultado.eventoId,
    p_agenda_id: resultado.agendaId,
    p_meet_url: resultado.meetUrl,
    p_link_html: resultado.linkHtml,
    p_criado_por: user.id,
  });

  const g = (gravou ?? {}) as { ok?: boolean; motivo?: string };
  if (g.ok !== true) {
    // O evento EXISTE no Google. Dizer "deu certo" seria mentira, e dizer "deu
    // errado" sem contar que o evento está lá faria a pessoa criar um segundo.
    registrarRecusa('agenda/evento', 'evento_criado_sem_registro');
    return NextResponse.json(
      {
        ok: false,
        motivo: 'evento_criado_sem_registro',
        recado:
          'O evento foi criado na sua agenda, mas o CRM não conseguiu registrar. Confira no Google antes de tentar de novo.',
        link_html: resultado.linkHtml,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    meet_url: resultado.meetUrl,
    link_html: resultado.linkHtml,
    convidado: ehVisita ? null : t.convidado,
  });
}
