import { type EntradaDoResumo } from './v1';

/**
 * O nó em que a conversa virou, por regra (R13 §3.2).
 *
 * Serve para duas coisas: dar um palpite quando o modelo não rodou, e conferir o palpite
 * dele. É deliberadamente burra — olha o prefixo do id do nó, que a convenção do roteiro
 * garante (`obj_*` são as objeções do bloco lateral).
 *
 * O limite é conhecido e está no eval: quando a conversa vira num nó comum — a pergunta
 * de volume em que a pessoa esfria, por exemplo —, não há prefixo para achar, e a regra
 * devolve `null`. É por isso que ela confere o modelo em vez de substituí-lo.
 */
export function viradaProvavel(caminho: EntradaDoResumo['caminho']): string | null {
  const objecao = caminho.find((no) => no.id.startsWith('obj_'));
  return objecao?.id ?? null;
}
