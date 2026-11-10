/**
 * O CRM cancela no Calendly (10/11/2026).
 *
 * Duas pessoas não ficam no mesmo horário (pedido do usuário). Quando um
 * agendamento chega num horário já ocupado, ou quando a equipe desmarca pelo
 * CRM um compromisso que veio do Calendly, o horário só volta a aparecer livre
 * no Calendly — e o cliente só fica sabendo — se o Calendly cancelar o evento.
 * É uma chamada da API ("Cancel Event"), com o token pessoal da conta e o
 * recado ao cliente, que vai no e-mail de cancelamento do próprio Calendly.
 */

const API_PADRAO = 'https://api.calendly.com';

export type ResultadoNoCalendly = { ok: true } | { ok: false; definitivo: boolean; erro: string };

/**
 * O uuid do evento é o fim da URI (`.../scheduled_events/<uuid>`). Só letras,
 * números e hífen: é isso que impede um caminho torto na URL da API. O tamanho
 * não importa (o Calendly já usou ids de 16 e de 36 caracteres).
 */
export function uuidDoEvento(eventoUri: string): string | null {
  const ultimo = eventoUri.replace(/\/+$/, '').split('/').pop() ?? '';
  return /^[A-Za-z0-9-]{1,64}$/.test(ultimo) ? ultimo : null;
}

export async function cancelarNoCalendly(opcoes: {
  token: string;
  eventoUri: string;
  motivo: string;
  buscar?: typeof fetch;
  api?: string;
}): Promise<ResultadoNoCalendly> {
  const uuid = uuidDoEvento(opcoes.eventoUri);
  if (!uuid) return { ok: false, definitivo: true, erro: 'URI do evento sem uuid' };

  let resposta: Response;
  try {
    resposta = await (opcoes.buscar ?? fetch)(
      `${opcoes.api ?? API_PADRAO}/scheduled_events/${uuid}/cancellation`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${opcoes.token}`, 'Content-Type': 'application/json' },
        // O Calendly aceita até 10 mil caracteres; o recado é uma frase.
        body: JSON.stringify({ reason: opcoes.motivo.slice(0, 1000) }),
      },
    );
  } catch (e) {
    return { ok: false, definitivo: false, erro: `Calendly fora do ar: ${(e as Error).message}` };
  }
  if (resposta.ok) {
    await resposta.body?.cancel().catch(() => undefined);
    return { ok: true };
  }

  const corpo = (await resposta.json().catch(() => ({}))) as {
    title?: string;
    message?: string;
    details?: Array<{ message?: string }>;
  };
  const detalhe = [corpo.title, corpo.message, ...(corpo.details ?? []).map((d) => d.message)]
    .filter(Boolean)
    .join(' · ');
  const erro = `Calendly ${resposta.status}${detalhe ? `: ${detalhe}` : ''}`;

  // O evento já não existe, ou já estava cancelado: não há mais o que fazer lá.
  if (resposta.status === 404) return { ok: true };
  if ((resposta.status === 400 || resposta.status === 403) && /cancel/i.test(detalhe))
    return { ok: true };
  // Token errado ou sem permissão volta a tentar (com espera): alguém pode
  // trocar o token em minutos. Fora do ar e limite de chamadas, também.
  if (
    resposta.status === 401 ||
    resposta.status === 403 ||
    resposta.status === 429 ||
    resposta.status >= 500
  ) {
    return { ok: false, definitivo: false, erro };
  }
  return { ok: false, definitivo: true, erro };
}
