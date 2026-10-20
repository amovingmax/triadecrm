import type { NegocioCru } from './montagem';

/**
 * O negócio em foco de uma organização: o aberto mexido mais recentemente e, se
 * nenhum estiver aberto, o mais recente de todos. O cabeçalho da conversa, o
 * cartão de aviso (`components/avisos`) e a folha de mover etapa precisam da mesma
 * escolha que a lista fez, senão discordariam sobre a etapa e a próxima ação do
 * mesmo parceiro.
 *
 * Mora sozinha (20/10/2026) porque o aviso de resposta vive na casca do app, em
 * toda página: importada de `montagem.ts`, ela levava junto a montagem inteira de
 * Conversas e, por ela, os prompts da IA. `montagem.ts` a reexporta.
 */
export function escolherNegocio<N extends NegocioParaEscolha>(negocios: readonly N[]): N | null {
  let escolhido: N | null = null;
  for (const d of negocios) {
    if (!escolhido || melhorNegocio(d, escolhido)) escolhido = d;
  }
  return escolhido;
}

/**
 * O que a escolha olha de um negócio. O cartão de aviso lê só isto, e precisa
 * chegar à MESMA etapa que a lista mostra.
 */
type NegocioParaEscolha = Pick<NegocioCru, 'status' | 'updated_at'>;

/** `candidato` vence `atual`? A mesma regra serve à lista de Conversas (`montagem.ts`). */
export function melhorNegocio(candidato: NegocioParaEscolha, atual: NegocioParaEscolha): boolean {
  const abertoCandidato = candidato.status === 'open';
  const abertoAtual = atual.status === 'open';
  if (abertoCandidato !== abertoAtual) return abertoCandidato;
  return candidato.updated_at > atual.updated_at;
}
