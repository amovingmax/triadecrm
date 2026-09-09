import 'server-only';

/**
 * A conversa com o Google Agenda.
 *
 * Só o servidor entra aqui: trocar um refresh token por um access token exige o
 * `client_secret` do OAuth, que não pode existir no navegador. Este arquivo não
 * conhece o Supabase nem o CRM — recebe um refresh token e devolve um evento.
 * Quem liga as duas pontas é a rota (`app/api/agenda/...`).
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE MÓDULO ASSUME, E POR QUE ELE FALHA EXPLÍCITO EM VEZ DE TENTAR
 * ---------------------------------------------------------------------------
 * Três coisas precisam estar configuradas fora do código, e nenhuma delas é
 * problema de quem está usando o CRM:
 *
 *   - `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no ambiente do servidor
 *   - a API do Google Agenda habilitada no projeto do Google Cloud
 *   - o escopo `calendar.events` declarado na tela de consentimento
 *
 * Faltando qualquer uma, a resposta é um motivo NOMEADO (`nao_configurado`,
 * `escopo_insuficiente`, `acesso_revogado`) e não uma exceção crua. A pessoa que
 * clicou precisa ler "peça ao Luiz para liberar a agenda no Google", não
 * "TypeError: fetch failed".
 */

/** Permissão mínima: criar e alterar eventos, nada de ler a agenda inteira. */
export const ESCOPO_AGENDA = 'https://www.googleapis.com/auth/calendar.events';

const URL_TOKEN = 'https://oauth2.googleapis.com/token';
const URL_EVENTOS = 'https://www.googleapis.com/calendar/v3/calendars';

export type MotivoDoGoogle =
  | 'nao_configurado'
  | 'acesso_revogado'
  | 'escopo_insuficiente'
  | 'api_desabilitada'
  | 'limite_do_google'
  | 'google_fora'
  | 'evento_sumiu'
  | 'resposta_inesperada';

export type Falha = { ok: false; motivo: MotivoDoGoogle; detalhe: string };

export type EventoCriado = {
  ok: true;
  eventoId: string;
  agendaId: string;
  meetUrl: string | null;
  linkHtml: string | null;
};

export function temCredenciaisDoGoogle(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Refresh token → access token.
 *
 * O access token do Google dura uma hora e este módulo NÃO o guarda. Guardar
 * exigiria uma tabela a mais e uma decisão de invalidação; pedir de novo custa
 * uma chamada de ~200 ms numa ação que a pessoa faz algumas vezes por dia. O
 * refresh token, esse sim, é longo e mora no Vault.
 */
async function pegarAccessToken(refreshToken: string): Promise<{ ok: true; token: string } | Falha> {
  if (!temCredenciaisDoGoogle()) {
    return {
      ok: false,
      motivo: 'nao_configurado',
      detalhe: 'GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET ausente no servidor.',
    };
  }

  let resposta: Response;
  try {
    resposta = await fetch(URL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
  } catch (erro) {
    return { ok: false, motivo: 'google_fora', detalhe: String(erro) };
  }

  const corpo = (await resposta.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
    scope?: string;
  };

  if (!resposta.ok) {
    // `invalid_grant` é a recusa que NÃO adianta repetir: a pessoa revogou o
    // acesso no painel do Google, trocou a senha, ou o token expirou por desuso.
    // Quem chama usa isto para marcar a ligação como revogada e pedir reconexão.
    const codigo = corpo.error ?? String(resposta.status);
    return {
      ok: false,
      motivo: codigo === 'invalid_grant' ? 'acesso_revogado' : 'resposta_inesperada',
      detalhe: corpo.error_description ?? codigo,
    };
  }

  if (!corpo.access_token) {
    return { ok: false, motivo: 'resposta_inesperada', detalhe: 'Google não devolveu access_token.' };
  }

  // O escopo pode ter encolhido: o Google deixa a pessoa desmarcar permissões na
  // tela de consentimento, e aí o token vale mas não abre a agenda. Descobrir
  // aqui é melhor que descobrir com um 403 no meio da criação do evento.
  if (corpo.scope && !corpo.scope.includes('calendar')) {
    return {
      ok: false,
      motivo: 'escopo_insuficiente',
      detalhe: `A conta não concedeu acesso à agenda (escopos: ${corpo.scope}).`,
    };
  }

  return { ok: true, token: corpo.access_token };
}

export type PedidoDeEvento = {
  titulo: string;
  inicio: Date;
  duracaoMin: number;
  descricao?: string;
  local?: string;
  /** E-mail do fornecedor. Ausente é normal: nem toda ficha tem e-mail. */
  convidado?: string | null;
  /** Sala do Meet. Falso em visita presencial — sala vazia confunde quem vai dirigir. */
  comMeet: boolean;
};

/**
 * Cria o evento na agenda principal da conta conectada.
 *
 * `sendUpdates=all` é deliberado: sem isso o Google cria o evento e NÃO avisa o
 * convidado, e a reunião existiria só do nosso lado — que é exatamente o
 * problema que esta integração veio resolver.
 */
export async function criarEvento(
  refreshToken: string,
  pedido: PedidoDeEvento,
): Promise<EventoCriado | Falha> {
  const acesso = await pegarAccessToken(refreshToken);
  if (!acesso.ok) return acesso;

  const fim = new Date(pedido.inicio.getTime() + pedido.duracaoMin * 60_000);
  const agendaId = 'primary';

  // `timeZone` explícito e não o do servidor: a Vercel roda em UTC, e uma reunião
  // de 14h em Natal viraria 14h UTC — 11h no relógio de quem vai. Todo o CRM
  // trabalha em America/Fortaleza (CLAUDE.md).
  const corpo: Record<string, unknown> = {
    summary: pedido.titulo,
    description: pedido.descricao,
    location: pedido.local,
    start: { dateTime: pedido.inicio.toISOString(), timeZone: 'America/Fortaleza' },
    end: { dateTime: fim.toISOString(), timeZone: 'America/Fortaleza' },
    reminders: {
      useDefault: false,
      // 24 h e 1 h: os dois lembretes que o PRD pede para reunião marcada.
      overrides: [
        { method: 'popup', minutes: 24 * 60 },
        { method: 'popup', minutes: 60 },
      ],
    },
  };

  if (pedido.convidado) {
    corpo.attendees = [{ email: pedido.convidado }];
  }
  if (pedido.comMeet) {
    corpo.conferenceData = {
      createRequest: {
        // Precisa ser único por pedido, e não por tarefa: reenviar o mesmo id
        // devolve a MESMA sala, o que é certo em retentativa e errado quando a
        // reunião foi remarcada. Quem decide reaproveitar é quem chama.
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const url = new URL(`${URL_EVENTOS}/${encodeURIComponent(agendaId)}/events`);
  url.searchParams.set('sendUpdates', 'all');
  if (pedido.comMeet) url.searchParams.set('conferenceDataVersion', '1');

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${acesso.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    return { ok: false, motivo: 'google_fora', detalhe: String(erro) };
  }

  const dados = (await resposta.json().catch(() => ({}))) as {
    id?: string;
    htmlLink?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
    error?: { message?: string; status?: string; errors?: { reason?: string }[] };
  };

  if (!resposta.ok) {
    return { ok: false, motivo: motivoDoErro(resposta.status, dados), detalhe: dados.error?.message ?? String(resposta.status) };
  }
  if (!dados.id) {
    return { ok: false, motivo: 'resposta_inesperada', detalhe: 'Google não devolveu o id do evento.' };
  }

  // `hangoutLink` é o caminho curto; quando ele não vem, a sala está em
  // `conferenceData.entryPoints` com `entryPointType: 'video'`.
  const meet =
    dados.hangoutLink ??
    dados.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ??
    null;

  return {
    ok: true,
    eventoId: dados.id,
    agendaId,
    meetUrl: meet,
    linkHtml: dados.htmlLink ?? null,
  };
}


/**
 * Move um evento existente para outro horário.
 *
 * PATCH, e não apagar-e-criar, porque o Google tem semântica própria para isto:
 * alterar o evento faz ele avisar o convidado de que a reunião FOI REMARCADA, com
 * a mesma sala do Meet e o mesmo fio na caixa de entrada. Apagar e criar manda um
 * cancelamento seguido de um convite novo — duas notificações, dois links, e a
 * impressão de que a reunião caiu.
 *
 * `sendUpdates=all` de novo: sem isso o horário muda e o convidado não fica
 * sabendo, que é o mesmo problema de antes com outra roupa.
 */
export async function remarcarEvento(
  refreshToken: string,
  agendaId: string,
  eventoId: string,
  inicio: Date,
  duracaoMin: number,
): Promise<{ ok: true; linkHtml: string | null; meetUrl: string | null } | Falha> {
  const acesso = await pegarAccessToken(refreshToken);
  if (!acesso.ok) return acesso;

  const fim = new Date(inicio.getTime() + duracaoMin * 60_000);
  const url = new URL(
    `${URL_EVENTOS}/${encodeURIComponent(agendaId)}/events/${encodeURIComponent(eventoId)}`,
  );
  url.searchParams.set('sendUpdates', 'all');

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${acesso.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        start: { dateTime: inicio.toISOString(), timeZone: 'America/Fortaleza' },
        end: { dateTime: fim.toISOString(), timeZone: 'America/Fortaleza' },
      }),
    });
  } catch (erro) {
    return { ok: false, motivo: 'google_fora', detalhe: String(erro) };
  }

  const dados = (await resposta.json().catch(() => ({}))) as {
    htmlLink?: string;
    hangoutLink?: string;
    error?: { message?: string; errors?: { reason?: string }[] };
  };

  // 404/410: o evento não está mais lá — alguém apagou pelo Google. Não é erro de
  // quem clicou, e não adianta repetir: quem chama trata como "esqueça o espelho".
  if (resposta.status === 404 || resposta.status === 410) {
    return { ok: false, motivo: 'evento_sumiu', detalhe: 'O evento não existe mais no Google.' };
  }
  if (!resposta.ok) {
    return {
      ok: false,
      motivo: motivoDoErro(resposta.status, dados),
      detalhe: dados.error?.message ?? String(resposta.status),
    };
  }

  return { ok: true, linkHtml: dados.htmlLink ?? null, meetUrl: dados.hangoutLink ?? null };
}

/** Apaga o evento. Usado quando a reunião é cancelada no CRM. */
export async function apagarEvento(
  refreshToken: string,
  agendaId: string,
  eventoId: string,
): Promise<{ ok: true } | Falha> {
  const acesso = await pegarAccessToken(refreshToken);
  if (!acesso.ok) return acesso;

  const url = new URL(
    `${URL_EVENTOS}/${encodeURIComponent(agendaId)}/events/${encodeURIComponent(eventoId)}`,
  );
  url.searchParams.set('sendUpdates', 'all');

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${acesso.token}` },
    });
  } catch (erro) {
    return { ok: false, motivo: 'google_fora', detalhe: String(erro) };
  }

  // 410 quer dizer "já estava apagado", e isso é sucesso para quem chamou: o
  // estado desejado (evento fora da agenda) é o estado atual.
  if (resposta.ok || resposta.status === 410 || resposta.status === 404) return { ok: true };

  const dados = (await resposta.json().catch(() => ({}))) as {
    error?: { message?: string; errors?: { reason?: string }[] };
  };
  return {
    ok: false,
    motivo: motivoDoErro(resposta.status, dados),
    detalhe: dados.error?.message ?? String(resposta.status),
  };
}

/**
 * Traduz o erro do Google para um motivo que a tela sabe explicar.
 *
 * O 403 do Google é ambíguo: pode ser API desligada no projeto, escopo que a
 * pessoa não concedeu, ou cota estourada. A distinção está em `errors[].reason`,
 * e ela importa muito — "peça ao Luiz para habilitar a API" e "reconecte a sua
 * agenda" são ações de pessoas diferentes.
 */
function motivoDoErro(
  status: number,
  dados: { error?: { message?: string; errors?: { reason?: string }[] } },
): MotivoDoGoogle {
  const razao = dados.error?.errors?.[0]?.reason ?? '';
  const mensagem = dados.error?.message ?? '';

  if (status === 401) return 'acesso_revogado';
  if (status === 429 || razao === 'rateLimitExceeded' || razao === 'userRateLimitExceeded') {
    return 'limite_do_google';
  }
  if (status === 403) {
    if (/accessNotConfigured|has not been used|disabled/i.test(`${razao} ${mensagem}`)) {
      return 'api_desabilitada';
    }
    if (/insufficient|scope/i.test(`${razao} ${mensagem}`)) return 'escopo_insuficiente';
    return 'limite_do_google';
  }
  if (status >= 500) return 'google_fora';
  return 'resposta_inesperada';
}

/** O que cada motivo quer dizer para quem está olhando a tela. */
export const RECADO_DO_GOOGLE: Record<MotivoDoGoogle, string> = {
  nao_configurado:
    'A integração com o Google ainda não foi configurada no servidor. Fale com Luiz ou Matheus.',
  acesso_revogado:
    'O Google não aceita mais o acesso desta conta. Reconecte a sua agenda e tente de novo.',
  escopo_insuficiente:
    'A conta conectada não concedeu permissão para a agenda. Reconecte e marque a permissão de agenda.',
  api_desabilitada:
    'A API do Google Agenda ainda não está habilitada no projeto da Komune. Peça ao Luiz para habilitar.',
  limite_do_google: 'O Google recusou por limite de uso. Espere alguns minutos e tente de novo.',
  google_fora: 'Não deu para alcançar o Google agora. Tente de novo em instantes.',
  evento_sumiu: 'O evento não existe mais no Google — alguém apagou por lá.',
  resposta_inesperada: 'O Google respondeu de um jeito que o CRM não entendeu.',
};
