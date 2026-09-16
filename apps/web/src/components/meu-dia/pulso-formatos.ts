import type { PrioridadeDoPulso } from './pulso-dados';

/**
 * As duas perguntas que a tela do Pulso faz e que não são JSX: **de quando ele é** e
 * **em que ordem as prioridades aparecem**.
 */

/**
 * De quando é este Pulso, do ponto de vista de quem está lendo agora.
 *
 * O Pulso sai às 18h30, e quem abre o Meu dia de manhã lê o de ontem. Dizer só a
 * data ("17/09") faria a pessoa calcular; dizer "ontem" responde. Acima de dois
 * dias vira a data, porque "há cinco dias" é a informação de que o digest parou —
 * e essa merece o número.
 */
export function deQuandoE(diaDoPulso: string, hoje: Date = new Date()): string {
  const dia = new Date(`${diaDoPulso}T12:00:00`);
  if (Number.isNaN(dia.getTime())) return diaDoPulso;

  const meioDiaDeHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 12, 0, 0);
  const diferenca = Math.round((meioDiaDeHoje.getTime() - dia.getTime()) / 86_400_000);

  if (diferenca <= 0) return 'hoje';
  if (diferenca === 1) return 'ontem';
  if (diferenca === 2) return 'anteontem';
  return dia.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Quanto tempo faz — para a tela avisar quando o digest parou de sair. */
export function diasDesde(diaDoPulso: string, hoje: Date = new Date()): number {
  const dia = new Date(`${diaDoPulso}T12:00:00`);
  if (Number.isNaN(dia.getTime())) return 0;
  const meioDiaDeHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 12, 0, 0);
  return Math.max(0, Math.round((meioDiaDeHoje.getTime() - dia.getTime()) / 86_400_000));
}

const PESO: Record<PrioridadeDoPulso['urgencia'], number> = {
  hoje: 0,
  amanha: 1,
  esta_semana: 2,
};

/**
 * Hoje antes de amanhã, amanhã antes desta semana. O modelo já entrega mais ou
 * menos nessa ordem; ordenar aqui é o que garante que ela não dependa disso.
 */
export function ordenarPrioridades(
  prioridades: readonly PrioridadeDoPulso[],
): PrioridadeDoPulso[] {
  return [...prioridades].sort((a, b) => PESO[a.urgencia] - PESO[b.urgencia]);
}

export const ROTULO_DA_URGENCIA: Record<PrioridadeDoPulso['urgencia'], string> = {
  hoje: 'hoje',
  amanha: 'amanhã',
  esta_semana: 'esta semana',
};

/**
 * Prioridade sem conversa não vira link.
 *
 * O worker resolve `leadId` para a conversa antes de gravar, e descarta o que não
 * resolver. Se ainda assim vier uma sem id — Pulso antigo, gravado antes desta
 * versão —, ela aparece como texto: melhor uma linha sem link que um link que
 * abre a conversa errada.
 */
export function linkDaPrioridade(prioridade: PrioridadeDoPulso): string | null {
  if (prioridade.organizationId !== null) return `/conversas?org=${prioridade.organizationId}`;
  return null;
}
