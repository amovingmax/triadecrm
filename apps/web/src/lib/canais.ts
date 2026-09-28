import type { Channel } from '@komune/schema';

/**
 * Os canais de `app.channel`, em pt-BR e em ordem de tela.
 *
 * Moraram em `components/conversas/tipos.ts` até 28/09/2026, quando o quadro do
 * funil ganhou o mesmo filtro (ADR-16) e passaram a ser de duas telas. Duplicar
 * os rótulos seria duplicar o momento em que "Telefone" vira outra coisa numa
 * delas.
 */

/** Ordem dos canais na barra de filtros: a frequência de quem está na rua. */
export const CANAIS_EM_ORDEM = [
  'phone',
  'presencial',
  'whatsapp',
  'instagram',
  'email',
  'other',
] as const satisfies readonly Channel[];

/** `app.channel` em pt-BR. */
export const ROTULO_CANAL: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  email: 'E-mail',
  phone: 'Telefone',
  presencial: 'Presencial',
  other: 'Outro',
};

export function ehCanal(v: string): v is Channel {
  return v in ROTULO_CANAL;
}
