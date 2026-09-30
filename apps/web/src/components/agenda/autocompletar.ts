/**
 * A régua do autocompletar de parceiro da agenda: normalizar o que se digita, ordenar
 * o que o banco devolveu e destacar o trecho que casou.
 *
 * Normaliza do mesmo jeito que `app.search_name` grava `organizations.search_name`
 * (sem acento, minúsculo, espaços colapsados), para "josy" achar "Jôsy Buffet" e
 * "BUF" achar "Anne Vieira Buffet".
 */

/** Sem acento, minúsculo, espaços colapsados. */
export function normalizarBusca(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Quão bem um nome casa com o que foi digitado (menor é melhor):
 *
 *   0  o nome começa com o termo            ("buf" → "Buffet Sabor")
 *   1  uma palavra do nome começa com ele   ("buf" → "Anne Vieira Buffet")
 *   2  o termo aparece no meio de uma palavra
 *   3  o nome não contém o termo — veio da busca por telefone, @, CNPJ ou bairro
 */
export function pontuarNome(nome: string, termo: string): 0 | 1 | 2 | 3 {
  const n = normalizarBusca(nome);
  const t = normalizarBusca(termo);
  if (!t) return 3;
  if (n.startsWith(t)) return 0;
  if (n.split(/[^a-z0-9]+/).some((palavra) => palavra.startsWith(t))) return 1;
  if (n.includes(t)) return 2;
  return 3;
}

/**
 * Junta os achados da busca por trecho do nome com os da `search_organizations`
 * (que sabe telefone, @, CNPJ e bairro), sem repetir, e ordena: primeiro o que casa
 * pelo nome, do melhor casamento para o pior e em ordem alfabética; depois o resto,
 * na ordem de relevância que a RPC deu.
 */
export function ordenarCandidatos(
  termo: string,
  daBusca: readonly { id: string; nome: string }[],
  doTrecho: readonly { id: string; nome: string }[],
  limite: number,
): string[] {
  const vistos = new Map<string, { nome: string; ordemDaBusca: number }>();
  daBusca.forEach((c, i) => vistos.set(c.id, { nome: c.nome, ordemDaBusca: i }));
  for (const c of doTrecho) {
    if (!vistos.has(c.id))
      vistos.set(c.id, { nome: c.nome, ordemDaBusca: Number.MAX_SAFE_INTEGER });
  }
  return [...vistos]
    .map(([id, c]) => ({ id, ...c, pontos: pontuarNome(c.nome, termo) }))
    .sort(
      (a, b) =>
        a.pontos - b.pontos ||
        (a.pontos === 3
          ? a.ordemDaBusca - b.ordemDaBusca
          : a.nome.localeCompare(b.nome, 'pt-BR')) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limite)
    .map((c) => c.id);
}

/**
 * O nome partido em pedaços, com o trecho que casou marcado — sem acento na
 * comparação, mas com o nome original na tela ("Jôsy", não "Josy").
 */
export function trechosDestacados(
  nome: string,
  termo: string,
): { texto: string; destaque: boolean }[] {
  const t = normalizarBusca(termo);
  if (!t) return [{ texto: nome, destaque: false }];

  // Normaliza letra a letra, guardando de que posição do original cada uma veio.
  let normalizado = '';
  const origem: number[] = [];
  Array.from(nome).forEach((letra, i) => {
    const n = letra.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s/, ' ');
    for (const c of n) {
      normalizado += c;
      origem.push(i);
    }
  });

  const letras = Array.from(nome);
  const inicio = normalizado.indexOf(t);
  if (inicio < 0) return [{ texto: nome, destaque: false }];
  const de = origem[inicio]!;
  const ate = origem[inicio + t.length - 1]! + 1;
  return [
    { texto: letras.slice(0, de).join(''), destaque: false },
    { texto: letras.slice(de, ate).join(''), destaque: true },
    { texto: letras.slice(ate).join(''), destaque: false },
  ].filter((p) => p.texto !== '');
}

/** `%` e `_` são curingas no `ilike`: o que a pessoa digita é texto, não padrão. */
export function escaparCuringas(termo: string): string {
  return termo.replace(/[\\%_]/g, (c) => `\\${c}`);
}
