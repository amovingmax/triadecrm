/**
 * A frase do estado vazio do quadro, a partir do recorte ligado.
 *
 * (Até 07/10/2026 este arquivo também lia `?funil=ativacao`, o funil que o
 * seletor mostrava sem abrir quadro. A aba saiu, e a leitura da URL voltou a ser
 * só a do contrato: `filtrosQuadroDaUrl`, em `../tipos`.)
 */
import { ROTULO_CANAL } from '@/lib/canais';

import type { FiltrosQuadro } from '../tipos';

/** Frase que descreve o recorte ligado, para o estado vazio não ser genérico. */
export function descreverRecorte(filtros: FiltrosQuadro): string {
  const partes: string[] = [];
  if (filtros.q.trim()) partes.push(`a busca "${filtros.q.trim()}"`);
  if (filtros.apenasMeus) partes.push('só os seus negócios');
  if (filtros.canal) partes.push(`o canal ${ROTULO_CANAL[filtros.canal]}`);

  if (partes.length === 0) return 'Nenhum negócio entra no recorte atual.';
  if (partes.length === 1) return `Nada bate com ${partes[0]}.`;
  return `Nada bate com ${partes.join(' e ')} ao mesmo tempo. Tire um filtro por vez.`;
}
