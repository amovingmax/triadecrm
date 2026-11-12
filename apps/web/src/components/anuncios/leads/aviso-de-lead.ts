/**
 * As regras do aviso de lead novo dos portais (11/11/2026), sem React e sem
 * banco, para serem testadas à parte. Quem usa é `vigia-de-leads.tsx`.
 *
 * Pedido do usuário: "O lead deve aparecer na aba de leads em anúncios e
 * devemos ser notificados que um novo lead chega."
 *
 * O lead que conta é o que ESCREVEU pelo portal (chat, formulário, pedido de
 * visita ou mensagem sem tipo): o banco grava `portal_leads.escreveu_em` (migração
 * 20261111120000). Quem clicou no WhatsApp do anúncio e mandou mensagem por lá
 * já avisa pelo aviso de mensagem nova, e quem só clicou não escreveu nada. O
 * lead que nasce dessa conversa (12/11/2026, "Mensagem no WhatsApp") também não
 * avisa: `lerLeadsQueEscreveram` o deixa de fora.
 */

/** O que o lead fez no portal, na mesma ordem e com as mesmas palavras do aviso do celular. */
export function acaoDoLead(tipos: readonly string[]): string {
  if (tipos.includes('VISIT_REQUEST')) return 'pediu uma visita';
  if (tipos.includes('CONTACT_FORM')) return 'preencheu o formulário';
  if (tipos.includes('CONTACT_CHAT')) return 'mandou mensagem pelo chat';
  return 'escreveu pelo portal';
}

export interface LeadDoAviso {
  readonly id: string;
  /** O nome da ficha, ou o que o portal mandou. `null` = não se sabe. */
  readonly nome: string | null;
  readonly acao: string;
  /** O código do anúncio. */
  readonly codigo: string | null;
}

function quem(lead: LeadDoAviso): string {
  const nome = lead.nome?.trim();
  return nome ? nome : 'Alguém';
}

/** "Maria Souza pediu uma visita · IM0003". */
export function linhaDoLead(lead: LeadDoAviso): string {
  const codigo = lead.codigo?.trim();
  return `${quem(lead)} ${lead.acao}${codigo ? ` · ${codigo}` : ''}`;
}

/**
 * O título e o corpo da notificação do sistema. O título leva a empresa, como o
 * aviso de mensagem ("Imova · Novo lead do portal"), para quem tem as duas abertas.
 */
export function textoDoAvisoDeLead(
  leads: readonly LeadDoAviso[],
  empresa: string,
): { titulo: string; corpo: string } {
  const primeiro = leads[0];
  if (leads.length === 1 && primeiro) {
    return { titulo: `${empresa} · Novo lead do portal`, corpo: linhaDoLead(primeiro) };
  }
  const nomes = leads.slice(0, 3).map(quem);
  const resto = leads.length - nomes.length;
  return {
    titulo: `${empresa} · ${leads.length} leads novos do portal`,
    corpo: resto > 0 ? `${nomes.join(', ')} e mais ${resto}` : juntarComE(nomes),
  };
}

function juntarComE(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes.join('');
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/** Para onde o toque leva: o lead aberto, ou a lista quando são vários. */
export function destinoDosLeads(ids: readonly string[]): string {
  const [unico] = ids;
  return ids.length === 1 && unico ? `/anuncios/leads?lead=${unico}` : '/anuncios/leads';
}

/**
 * O que vai junto com a notificação do sistema, para o clique voltar à aba. O
 * aviso de mensagem usa `{ conversaId, organizacaoId }`; o do lead, `{ lead }`.
 * Cada vigia só abre o que é dele.
 */
export interface AlvoDoLead {
  readonly lead: string;
}

export function ehAlvoDeLead(alvo: unknown): alvo is AlvoDoLead {
  return (
    typeof alvo === 'object' &&
    alvo !== null &&
    typeof (alvo as { lead?: unknown }).lead === 'string'
  );
}

/** Um id de lead que veio da URL (`?lead=`): só um uuid. */
export function leadDaUrl(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(limpo)
    ? limpo
    : null;
}

/** O momento mais recente entre os leads lidos (ISO), ou o piso que já havia. */
export function pisoDepois(piso: string, lidos: readonly { escreveuEm: string }[]): string {
  let maior = piso;
  for (const l of lidos) {
    if (Date.parse(l.escreveuEm) > Date.parse(maior)) maior = l.escreveuEm;
  }
  return maior;
}
