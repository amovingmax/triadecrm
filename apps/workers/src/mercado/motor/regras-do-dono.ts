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
import { ARG_CADERNO, CADERNO_DO_DONO, type EntradaDoCaderno } from './caderno';

export interface RegrasDasVantagens {
  /** As regras do caderno por imóvel (o do protótipo, ou com o que o dono liberou depois). */
  readonly caderno: Readonly<Record<string, EntradaDoCaderno>>;
  /** O nosso m² tem de estar até este fator da mediana dos parecidos (0,92 = 8% abaixo). */
  readonly limiarPreco: number;
  /** A vantagem de valorização da região (V1), só com sinal nas fontes. */
  readonly valorizacao: boolean;
  /** Para quem cada vantagem serve (família, tranquilidade, investimento...). */
  readonly perfis: boolean;
  /**
   * O preço que passa nas contas mas fica "abaixo demais" do modelo vai à tela do dono com
   * a marca "conferir" (27/11/2026, Pipa); no protótipo ele só virava bloqueio. O "possível
   * o mesmo imóvel anunciado por outro preço" continua bloqueio.
   */
  readonly precoAConferirVaiAoDono: boolean;
}

export const REGRAS_DO_DONO: RegrasDasVantagens = {
  caderno: CADERNO_DO_DONO,
  limiarPreco: 0.92,
  valorizacao: true,
  perfis: true,
  precoAConferirVaiAoDono: true,
};

export const REGRAS_DO_PROTOTIPO: RegrasDasVantagens = {
  caderno: ARG_CADERNO,
  limiarPreco: 0.85,
  valorizacao: false,
  perfis: false,
  precoAConferirVaiAoDono: false,
};

/** "8%" a partir do fator (0,92). */
export const pctDoLimiar = (r: RegrasDasVantagens): string =>
  `${Math.round((1 - r.limiarPreco) * 100)}%`;
