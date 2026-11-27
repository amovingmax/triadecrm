/**
 * "Chamar com a IA" (27/11/2026), só na Imova: o lead do portal que nunca falou
 * com a Imova (chat da OLX, "ver telefone") recebe pelo WhatsApp o modelo
 * aprovado pelo dono, e a IA assume a conversa quando a pessoa responder.
 *
 * O banco decide tudo (migração 20261127170000): `public.portal_lead_chamar_previa`
 * diz se pode, sugere o nome e o trecho do imóvel e mostra o texto;
 * `public.portal_lead_chamar` confere de novo, liga ou cria a ficha, abre a
 * conversa e põe o modelo na fila pela porteira de sempre. Aqui ficam as
 * chamadas e as regras que a tela repete para avisar antes do clique (as mesmas
 * do banco, que é quem manda).
 */
import { createClient } from '@/lib/supabase/client';

import { dataHoraDoLead, type LeadDoPortal } from './leads-rotulos';

/** O texto do modelo `IMV-LEAD-PORTAL`, como o dono aprovou em 27/11/2026. */
export const CORPO_DO_CHAMADO =
  'Olá, {{nome}}! Aqui é da Imova. Vimos seu interesse {{imovel_visto}}. Posso te passar mais informações?';

export const TETO_DO_NOME = 40;
export const PISO_DO_IMOVEL = 5;
export const TETO_DO_IMOVEL = 160;

/** Espaços seguidos viram um e as pontas saem (`app.modelo_parametro_limpo`). */
export function limparParametro(valor: string): string {
  return valor.replace(/\s+/g, ' ').trim();
}

/** O texto exato que a pessoa vai ler. */
export function textoDoChamado(nome: string, imovelVisto: string): string {
  return CORPO_DO_CHAMADO.replace('{{nome}}', limparParametro(nome) || '…').replace(
    '{{imovel_visto}}',
    limparParametro(imovelVisto) || '…',
  );
}

/** Por que o nome não vai (nulo = vai): só letras, sem número, até 40. */
export function problemaDoNome(nome: string): string | null {
  const limpo = limparParametro(nome);
  if (!limpo) return 'Escreva o primeiro nome da pessoa.';
  if (/[0-9]/.test(limpo)) return 'O nome não pode ter número.';
  if (!/\p{L}/u.test(limpo)) return 'Escreva o primeiro nome da pessoa.';
  if ([...limpo].length > TETO_DO_NOME) return `O nome passa de ${TETO_DO_NOME} letras.`;
  return null;
}

/** Por que o trecho do imóvel não vai (nulo = vai): de 5 a 160 letras, sem número comprido. */
export function problemaDoImovel(imovel: string): string | null {
  const limpo = limparParametro(imovel);
  const tamanho = [...limpo].length;
  if (tamanho < PISO_DO_IMOVEL) return 'Descreva o imóvel em poucas palavras.';
  if (tamanho > TETO_DO_IMOVEL) return `O trecho passa de ${TETO_DO_IMOVEL} letras.`;
  // O mesmo do banco: nada que pareça telefone ou documento.
  if (/[0-9][0-9 .,()/-]{8,}[0-9]/.test(limpo)) return 'Tire o número comprido (parece telefone).';
  return null;
}

/** O preço de um envio, pela categoria que a Meta deu ao modelo. */
export function custoDoChamado(categoria: string | null): string {
  if (categoria === 'utility') return 'cerca de R$ 0,04 por envio (categoria utilidade da Meta)';
  if (categoria === 'marketing') return 'cerca de R$ 0,32 por envio (categoria marketing da Meta)';
  return 'cobrado pela Meta conforme a categoria do modelo';
}

const MOTIVOS: Record<string, string> = {
  sem_permissao: 'Só admin, gestor e SDR chamam leads.',
  lead_nao_encontrado: 'Não achei este lead. Recarregue a página.',
  suprimido: 'Essa pessoa pediu para não ser contatada.',
  numero_suprimido: 'Essa pessoa pediu para não ser contatada.',
  contato_suprimido: 'Essa pessoa pediu para não ser contatada.',
  descartado: 'O lead está descartado. Traga de volta antes de chamar.',
  ja_tem_conversa: 'Já existe conversa com essa pessoa: responda por ela.',
  provavel_mesmo_contato:
    'Parece ser a mesma pessoa que escreveu pelo WhatsApp logo depois do clique: responda pela conversa dela.',
  contato_apagado: 'O contato que o portal mandou já foi apagado.',
  organizacao_apagada: 'A ficha dessa pessoa foi excluída.',
  sem_telefone: 'O portal não mandou o telefone dessa pessoa.',
  modelo_pending: 'A mensagem ainda está em análise na Meta. Quando ela aprovar, o botão funciona.',
  modelo_nao_enviado: 'A mensagem ainda não foi para a aprovação da Meta.',
  modelo_rejected: 'A Meta recusou a mensagem. Fale com quem cuida do CRM.',
  modelo_desligado: 'A mensagem está desligada no CRM.',
  modelo_ausente: 'A mensagem não existe neste CRM.',
  nome_invalido: 'Escreva só o primeiro nome, sem números (até 40 letras).',
  imovel_invalido: 'Descreva o imóvel em poucas palavras (5 a 160 letras), sem número de telefone.',
  whatsapp_nao_configurado: 'O WhatsApp da Imova não está configurado no CRM.',
  conversa_bloqueada: 'A conversa com essa pessoa está bloqueada.',
  qualidade_vermelha: 'A Meta está limitando o número da Imova agora. Tente mais tarde.',
  conta_banida: 'A Meta bloqueou o número da Imova.',
  meta_restringiu_saida: 'A Meta está limitando o número da Imova agora. Tente mais tarde.',
  meta_restringiu_entrada: 'A Meta está limitando o número da Imova agora. Tente mais tarde.',
  teto_iniciadas_dia: 'O limite de conversas iniciadas hoje acabou. Tente amanhã.',
  teto_iniciadas_hora: 'O limite de conversas iniciadas nesta hora acabou. Tente daqui a pouco.',
  teto_do_numero: 'O limite de mensagens do número acabou por hoje. Tente amanhã.',
};

/** A frase da recusa (do banco ou da prévia), com o "quando" da janela de envio. */
export function fraseDoMotivoDoChamado(
  motivo: string | null | undefined,
  quando?: string | null,
): string {
  if (!motivo) return 'Não deu certo. Tente de novo.';
  if (motivo.startsWith('janela')) {
    const abre = quando ? dataHoraDoLead(quando) : '';
    return abre
      ? `Fora do horário de envio do WhatsApp. Dá para mandar a partir de ${abre}.`
      : 'Fora do horário de envio do WhatsApp. Tente no horário comercial.';
  }
  if (motivo.startsWith('ficha_')) return 'Não deu para criar a ficha dessa pessoa. Tente de novo.';
  return MOTIVOS[motivo] ?? 'Não deu certo. Tente de novo.';
}

/**
 * O botão aparece no lead que ainda não tem conversa e não foi descartado; o
 * resto (telefone, supressão, aprovação da Meta) a prévia conta dentro do diálogo.
 */
export function mostraChamarComIA(
  lead: Pick<LeadDoPortal, 'conversation_id' | 'situacao' | 'contato_apagado_em' | 'suprimido'>,
): boolean {
  return (
    !lead.conversation_id &&
    lead.situacao !== 'descartado' &&
    !lead.contato_apagado_em &&
    !lead.suprimido
  );
}

/** A conversa aberta pelo chamado: com ficha, `?org=`; sem, `?cliente=` (como `enderecoDaConversa`). */
export function enderecoDoChamado(conversationId: string, organizationId: string | null): string {
  return organizationId
    ? `/conversas?org=${encodeURIComponent(organizationId)}`
    : `/conversas?cliente=${encodeURIComponent(conversationId)}`;
}

export interface PreviaDoChamado {
  readonly pode: boolean;
  readonly motivo: string | null;
  readonly nome: string;
  readonly imovelVisto: string;
  readonly modelo: string;
  readonly categoria: string | null;
}

export type LeituraDaPrevia = { ok: true; previa: PreviaDoChamado } | { ok: false; motivo: string };

export async function lerPreviaDoChamado(id: string): Promise<LeituraDaPrevia> {
  const { data, error } = await createClient().rpc('portal_lead_chamar_previa', { p_id: id });
  if (error) return { ok: false, motivo: error.message };
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.ok !== true) return { ok: false, motivo: String(r.motivo ?? 'falhou') };
  return {
    ok: true,
    previa: {
      pode: r.pode === true,
      motivo: typeof r.motivo === 'string' ? r.motivo : null,
      nome: typeof r.nome === 'string' ? r.nome : '',
      imovelVisto: typeof r.imovel_visto === 'string' ? r.imovel_visto : '',
      modelo: typeof r.modelo === 'string' ? r.modelo : 'ausente',
      categoria: typeof r.categoria === 'string' ? r.categoria : null,
    },
  };
}

export type ResultadoDoChamado =
  | { ok: true; conversationId: string; organizationId: string | null }
  | { ok: false; motivo: string; quando: string | null };

export async function chamarComIA(
  id: string,
  nome: string,
  imovelVisto: string,
): Promise<ResultadoDoChamado> {
  const { data, error } = await createClient().rpc('portal_lead_chamar', {
    p_id: id,
    p_nome: limparParametro(nome),
    p_imovel_visto: limparParametro(imovelVisto),
  });
  if (error) return { ok: false, motivo: error.message, quando: null };
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.ok !== true || typeof r.conversation_id !== 'string') {
    return {
      ok: false,
      motivo: String(r.motivo ?? 'falhou'),
      quando: typeof r.quando === 'string' ? r.quando : null,
    };
  }
  return {
    ok: true,
    conversationId: r.conversation_id,
    organizationId: typeof r.organization_id === 'string' ? r.organization_id : null,
  };
}
