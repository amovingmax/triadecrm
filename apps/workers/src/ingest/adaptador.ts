/**
 * O contrato de um adaptador de fonte.
 *
 * Cada fonte tem um jeito próprio de entregar a página; o resto da esteira (fila,
 * idempotência, whitelist, gravação, resolução) é o mesmo para todas (ADR-08).
 * Por isso o adaptador é pequeno de propósito: recebe HTML e devolve registros
 * BRUTOS (ainda não filtrados) e a URL da próxima página, se houver. Ele não
 * conhece o banco, não conhece a fila e não decide o que pode ser guardado —
 * quem decide isso é `whitelist.ts`, uma camada acima, para que a regra seja uma
 * só e não se repita a cada fonte nova.
 */

export interface RegistroExtraido {
  /** Identidade do registro NA FONTE (o `e137503` do Casamentos, o place_id do Google). */
  externalId: string;
  /** A URL pública daquele fornecedor: é ela que responde "de onde vocês tiraram isso?". */
  sourceUrl: string;
  /** Campos como a fonte entregou, antes da whitelist. */
  bruto: Record<string, unknown>;
}

export interface ResultadoDaPagina {
  registros: RegistroExtraido[];
  /** `<link rel="next">` da própria página. Nunca uma URL montada no código. */
  proximaUrl: string | null;
}

export interface ContextoDaPagina {
  url: string;
  categoriaOrigem: string | null;
}

export interface Adaptador {
  slug: string;
  extrairListagem(html: string, contexto: ContextoDaPagina): ResultadoDaPagina;
}
