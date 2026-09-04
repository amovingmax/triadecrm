/**
 * Os filtros do quadro na query string.
 *
 * A leitura reaproveita `filtrosQuadroDaUrl` do contrato e acrescenta uma linha: o
 * contrato reconhece só os funis QUE ABREM QUADRO (`ehFunilDoQuadro`), e por isso
 * `?funil=ativacao` cairia de volta em fornecedor. A página tem um seletor com os
 * três funis — ativação inclusive, porque ele existe no banco e o time pergunta por
 * ele — então ela precisa saber ler o terceiro. O que ela mostra para ativação não é
 * um quadro (isso continua valendo): é a régua de etapas com a contagem real.
 *
 * A escrita é a do contrato, sem mudança: `urlDosFiltrosQuadro` já grava qualquer
 * slug diferente do padrão.
 */
import { filtrosQuadroDaUrl, type FiltrosQuadro } from '../tipos';

/** O slug do funil que só existe no seletor, nunca no quadro. */
const FUNIL_SEM_QUADRO = 'ativacao';

export function lerFiltrosDoQuadro(
  params: Record<string, string | string[] | undefined>,
): FiltrosQuadro {
  const base = filtrosQuadroDaUrl(params);
  const bruto = params.funil;
  if (typeof bruto === 'string' && bruto === FUNIL_SEM_QUADRO) {
    return { ...base, funil: FUNIL_SEM_QUADRO };
  }
  return base;
}

/** Frase que descreve o recorte ligado, para o estado vazio não ser genérico. */
export function descreverRecorte(filtros: FiltrosQuadro): string {
  const partes: string[] = [];
  if (filtros.q.trim()) partes.push(`a busca "${filtros.q.trim()}"`);
  if (filtros.apenasMeus) partes.push('só os seus negócios');

  if (partes.length === 0) return 'Nenhum negócio entra no recorte atual.';
  if (partes.length === 1) return `Nada bate com ${partes[0]}.`;
  return `Nada bate com ${partes.join(' e ')} ao mesmo tempo. Tire um filtro por vez.`;
}
