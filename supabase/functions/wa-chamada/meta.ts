// =============================================================================
// TRIADE — o formato da ligação na Cloud API, sem rede nem banco.
//
// Só o que muda de um pedido para o outro: o corpo de `POST <phone>/calls` e a
// tradução dos erros da Meta para o que a pessoa lê na tela. Referência:
// docs/operacao/ligacao-whatsapp.md.
// =============================================================================

export type PedidoDaMeta =
  | { acao: 'pre_accept' | 'accept'; callId: string; sdp: string; opaco?: string }
  | { acao: 'terminate' | 'reject'; callId: string }
  | { acao: 'connect'; para: string; sdp: string; opaco: string };

/** A Meta espera o número sem o `+`. */
export function semMais(e164: string): string {
  return e164.replace(/^\+/, '');
}

export function corpoDaMeta(p: PedidoDaMeta): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp' };
  switch (p.acao) {
    case 'pre_accept':
    case 'accept':
      return {
        ...base,
        call_id: p.callId,
        action: p.acao,
        session: { sdp_type: 'answer', sdp: p.sdp },
        ...(p.opaco ? { biz_opaque_callback_data: p.opaco } : {}),
      };
    case 'terminate':
    case 'reject':
      return { ...base, call_id: p.callId, action: p.acao };
    case 'connect':
      return {
        ...base,
        to: semMais(p.para),
        action: 'connect',
        session: { sdp_type: 'offer', sdp: p.sdp },
        // Volta nos avisos da Meta: a resposta pode chegar antes de sabermos o id da chamada.
        biz_opaque_callback_data: p.opaco,
      };
  }
}

const FRASES: Record<number, string> = {
  138000: 'As ligações ainda não estão ativadas neste número do WhatsApp.',
  138001: 'Este cliente não pode receber ligação pelo WhatsApp agora.',
  138002: 'O número está com ligações demais ao mesmo tempo. Tente de novo em instantes.',
  138003: 'Já existe uma ligação em andamento com este cliente.',
  138004: 'A Meta não conseguiu completar a ligação. Tente de novo.',
  138005: 'O número atingiu o limite de ligações por agora. Tente de novo mais tarde.',
  138006: 'O cliente não deu permissão para receber ligação. Peça a permissão na conversa.',
  138007: 'A ligação não completou a tempo. Tente de novo.',
  138009: 'A Meta não deixa pedir permissão a este cliente de novo por enquanto.',
  138012: 'O número atingiu o limite de 100 ligações completadas em 24 horas.',
  138013: 'A Meta não oferece ligação feita pela empresa neste número.',
  138014: 'A Meta suspendeu as ligações deste número por um tempo, por queda de qualidade.',
  138015: 'A Meta não permite ativar ligações neste número.',
  138017: 'O cliente já permitiu ligações sem prazo. Não é preciso pedir de novo.',
  138018: 'Faltam pré-requisitos técnicos na Meta para ativar as ligações neste número.',
  131044: 'A conta do WhatsApp está sem forma de pagamento válida. Avise quem administra a conta.',
};

export function fraseDoErro(codigo: number | null): string {
  return (codigo !== null ? FRASES[codigo] : undefined) ??
    'A Meta não aceitou o pedido agora. Tente de novo em instantes.';
}

export type ErroDaMeta = { codigo: number | null; mensagem: string | null };

/** `{ error: { code, message } }`, o erro da Graph. Qualquer outra coisa vira nulos. */
export function lerErroDaMeta(corpo: unknown): ErroDaMeta {
  const erro = typeof corpo === 'object' && corpo !== null
    ? (corpo as { error?: { code?: unknown; message?: unknown } }).error
    : undefined;
  return {
    codigo: typeof erro?.code === 'number' ? erro.code : null,
    mensagem: typeof erro?.message === 'string' ? erro.message : null,
  };
}

/** `calls[0].id` da resposta de `connect`. */
export function idDaChamada(corpo: unknown): string | null {
  const calls = typeof corpo === 'object' && corpo !== null
    ? (corpo as { calls?: unknown }).calls
    : null;
  if (!Array.isArray(calls)) return null;
  const id = (calls[0] as { id?: unknown } | undefined)?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
