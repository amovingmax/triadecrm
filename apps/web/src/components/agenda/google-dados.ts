/**
 * Idas ao servidor da integração com o Google Agenda, do lado do navegador.
 *
 * O estado da conexão vem do Postgres (`agenda_google_estado`, que nunca devolve
 * o token). A criação do evento vai por uma rota do Next, porque é lá que vive o
 * `client_secret` do Google.
 */
import { createClient } from '@/lib/supabase/client';

/**
 * O mesmo escopo declarado no servidor (`lib/google/agenda.ts`), repetido aqui
 * porque aquele arquivo é `server-only` e importá-lo quebraria o build do
 * cliente. Se um dia mudar, muda nos dois — e o teste abaixo do módulo do
 * servidor existe para o valor não divergir em silêncio.
 */
export const ESCOPO_AGENDA_NO_CLIENTE = 'https://www.googleapis.com/auth/calendar.events';

export type EstadoDaAgenda = {
  conectada: boolean;
  email: string | null;
  desde: string | null;
  ultimoErro: string | null;
};

export async function buscarEstadoDaAgenda(): Promise<EstadoDaAgenda> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('agenda_google_estado');
  if (error) throw new Error(error.message);

  const r = (data ?? {}) as {
    conectada?: boolean;
    email?: string;
    desde?: string;
    ultimo_erro?: string;
  };
  return {
    conectada: r.conectada === true,
    email: r.email ?? null,
    desde: r.desde ?? null,
    ultimoErro: r.ultimo_erro ?? null,
  };
}

export async function desconectarAgenda(): Promise<{ ok: boolean; motivo?: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('agenda_google_desconectar');
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { ok?: boolean; motivo?: string };
  return { ok: r.ok === true, motivo: r.motivo };
}

export type RespostaDoEvento =
  | { ok: true; meetUrl: string | null; linkHtml: string | null; convidado: string | null }
  | { ok: false; motivo: string; recado?: string; linkHtml?: string | null };

/**
 * Manda criar o evento de uma tarefa.
 *
 * A rota devolve HTTP 4xx/5xx com corpo JSON nos casos de recusa, e o corpo é o
 * que interessa: `motivo` diz o que houve e `recado` é a frase pronta para a
 * pessoa. Tratar só o status esconderia a diferença entre "reconecte a sua
 * agenda" e "peça ao Luiz para habilitar a API".
 */
export async function criarEventoNoGoogle(taskId: string): Promise<RespostaDoEvento> {
  const resposta = await fetch('/api/agenda/evento', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId }),
  });

  const corpo = (await resposta.json().catch(() => ({}))) as {
    ok?: boolean;
    motivo?: string;
    recado?: string;
    meet_url?: string | null;
    link_html?: string | null;
    convidado?: string | null;
  };

  if (corpo.ok === true) {
    return {
      ok: true,
      meetUrl: corpo.meet_url ?? null,
      linkHtml: corpo.link_html ?? null,
      convidado: corpo.convidado ?? null,
    };
  }
  return {
    ok: false,
    motivo: corpo.motivo ?? 'desconhecido',
    recado: corpo.recado,
    linkHtml: corpo.link_html ?? null,
  };
}

/**
 * Leva o evento junto quando a reunião é remarcada.
 *
 * Chamada DEPOIS de o registro ser gravado, porque só aí a tarefa nova existe —
 * e é ela que o banco procura para receber o espelho. Falhar aqui não desfaz o
 * registro: a reunião foi remarcada no CRM de qualquer jeito, e o que sobra é um
 * evento no horário velho, que a tela avisa.
 */
export async function remarcarNoGoogle(
  taskId: string,
  /** ISO, como `folha-extra` guarda em `reuniaoEm` (via `doInputLocal`). */
  novoHorarioIso: string,
): Promise<{ ok: boolean; motivo?: string; recado?: string }> {
  const resposta = await fetch('/api/agenda/remarcar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId, novo_horario: novoHorarioIso }),
  });
  const corpo = (await resposta.json().catch(() => ({}))) as {
    ok?: boolean;
    motivo?: string;
    recado?: string;
  };
  return { ok: corpo.ok === true, motivo: corpo.motivo, recado: corpo.recado };
}

/** Tira o evento da agenda e esquece o espelho. */
export async function removerDoGoogle(
  taskId: string,
): Promise<{ ok: boolean; motivo?: string; recado?: string }> {
  const resposta = await fetch('/api/agenda/remover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId }),
  });
  const corpo = (await resposta.json().catch(() => ({}))) as {
    ok?: boolean;
    motivo?: string;
    recado?: string;
  };
  return { ok: corpo.ok === true, motivo: corpo.motivo, recado: corpo.recado };
}

/** Recusas que a própria rota nomeia, antes de o Google entrar na história. */
export const RECADO_DA_ROTA: Record<string, string> = {
  sem_sessao: 'A sua sessão expirou. Entre de novo.',
  nao_configurado:
    'A integração com o Google ainda não foi configurada no servidor. Fale com Luiz ou Matheus.',
  agenda_nao_conectada: 'Conecte a sua agenda Google antes, no topo desta tela.',
  tarefa_invisivel: 'Você não tem acesso a esse compromisso.',
  // Enxergar a reunião não é poder desmarcá-la: o evento mora na agenda pessoal de
  // quem o criou, e o Google avisa o fornecedor a cada mudança.
  // FALTA AQUI (de quem cuida deste arquivo): no caminho de remarcar, quando a
  // recusa é esta, o CRM já registrou o horário novo e o Google ficou no velho —
  // a tela deveria dizer isso, e este recado sozinho não diz.
  nao_e_seu:
    'Esse evento está na agenda de quem marcou a reunião: só essa pessoa, ou um gestor, muda o horário ou tira do Google. Peça a ela para ajustar por lá.',
  ja_tem_evento: 'Esse compromisso já está no seu Google Agenda.',
  sem_horario: 'Esse compromisso não tem hora marcada.',
  evento_criado_sem_registro:
    'O evento foi criado na sua agenda, mas o CRM não conseguiu registrar. Confira no Google antes de tentar de novo.',
  sem_espelho: 'Esse compromisso não está no Google Agenda.',
  dono_desconectado:
    'Quem pôs esse evento na agenda desconectou a conta Google. Só essa pessoa consegue alterá-lo, ou dá para ajustar direto no Google.',
  evento_sumiu: 'O evento não existe mais no Google — alguém apagou por lá.',
  remarcado_sem_religar:
    'O horário foi corrigido no Google, mas o CRM não conseguiu ligar o evento à reunião nova. Confira a agenda antes de pôr de novo, para não criar um segundo evento.',
  pedido_incompleto: 'Faltou informação para remarcar. Recarregue a agenda e tente de novo.',
  horario_invalido: 'A nova data não foi entendida.',
};
