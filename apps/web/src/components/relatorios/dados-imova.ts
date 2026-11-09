/**
 * Ajudantes de navegação dos relatórios da Imova.
 *
 * Até 09/11/2026 este arquivo também era a camada de dados dos cinco painéis de
 * 06/11 (Visão geral, Clientes quentes, Anúncios, Mensagens e IA que atende). Eles
 * deram lugar ao "relatório que vende", cujas leituras moram em `dados-vende.ts`;
 * daqui ficou só o caminho até a conversa.
 */

/**
 * Onde abrir a conversa de uma linha: a ficha leva para `?org=`; quem ainda não é
 * ficha, pela própria conversa (`?cliente=`), como a aba Clientes faz.
 */
export function linkDaConversa(organizacaoId: string | null, conversaId: string): string {
  return organizacaoId ? `/conversas?org=${organizacaoId}` : `/conversas?cliente=${conversaId}`;
}

/**
 * O link de um lead do "relatório que vende". O contrato de hoje traz só a conversa
 * (`conversation_id`); se a função do banco passar a mandar `organization_id`, o lead
 * que já é ficha abre pela ficha sem mudar nada aqui.
 */
export function linkDoLead(lead: { conversation_id: string; organization_id?: string | null }): string {
  return linkDaConversa(lead.organization_id ?? null, lead.conversation_id);
}
