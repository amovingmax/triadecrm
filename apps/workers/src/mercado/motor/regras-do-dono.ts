/**
 * As regras do dono para as vantagens (27/11/2026), num lugar só.
 *
 * Pedido do dono, depois de ver como o motor calcula:
 *   1. o preço vira vantagem quando o nosso estiver A PARTIR DE 8% mais barato que os
 *      parecidos (o protótipo exigia 15%);
 *   2. valorização: nunca "Não há como garantir valorização". Sem sinal nas fontes, não
 *      se fala nada disso; com sinal, a IA diz que é uma área com forte possibilidade de
 *      valorização, em linguagem de conversa, sem número nem conta;
 *   3. a vantagem certa para o que o cliente busca (filhos, tranquilidade, investimento,
 *      construir, praia...): cada vantagem diz para quem ela serve.
 *
 * O teste de ouro continua provando o porte fiel do protótipo: ele roda com
 * `REGRAS_DO_PROTOTIPO`. A rodada de verdade usa `REGRAS_DO_DONO`.
 */
export interface RegrasDasVantagens {
  /** O nosso m² tem de estar até este fator da mediana dos parecidos (0,92 = 8% abaixo). */
  readonly limiarPreco: number;
  /** A vantagem de valorização da região (V1), só com sinal nas fontes. */
  readonly valorizacao: boolean;
  /** Para quem cada vantagem serve (família, tranquilidade, investimento...). */
  readonly perfis: boolean;
}

export const REGRAS_DO_DONO: RegrasDasVantagens = {
  limiarPreco: 0.92,
  valorizacao: true,
  perfis: true,
};

export const REGRAS_DO_PROTOTIPO: RegrasDasVantagens = {
  limiarPreco: 0.85,
  valorizacao: false,
  perfis: false,
};

/** "8%" a partir do fator (0,92). */
export const pctDoLimiar = (r: RegrasDasVantagens): string =>
  `${Math.round((1 - r.limiarPreco) * 100)}%`;
