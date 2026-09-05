// =============================================================================
// TRIADE — de onde vem o segredo (CLAUDE.md: "segredo nunca em arquivo
// versionado")
//
// Ordem: variável de ambiente → Vault do próprio projeto. Nunca um terceiro
// lugar, nunca um valor embutido, nunca um `?? 'padrao'`. Sem segredo a função
// RECUSA a requisição (503) em vez de aceitar sem conferir — a falha aberta é
// pior que a fechada quando o assunto é assinatura.
//
// O valor fica em memória do worker por 5 minutos. Não vai para log, não vai
// para resposta e não vai para mensagem de erro.
// =============================================================================

import { rpcServico } from './postgrest.ts';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { valor: string; ate: number }>();

/** `komune_push_secret` → `KOMUNE_PUSH_SECRET`. */
function nomeDeAmbiente(nome: string): string {
  return nome.toUpperCase();
}

export class SegredoAusente extends Error {
  constructor(readonly nome: string) {
    super(`Segredo ${nome} não está no ambiente nem no Vault`);
    this.name = 'SegredoAusente';
  }
}

export async function segredo(nome: string): Promise<string> {
  const agora = Date.now();
  const emCache = cache.get(nome);
  if (emCache && emCache.ate > agora) return emCache.valor;

  const doAmbiente = Deno.env.get(nomeDeAmbiente(nome));
  if (doAmbiente && doAmbiente.trim().length > 0) {
    cache.set(nome, { valor: doAmbiente, ate: agora + TTL_MS });
    return doAmbiente;
  }

  const doVault = await rpcServico<string | null>('integracao_segredo', { p_nome: nome });
  if (typeof doVault === 'string' && doVault.trim().length > 0) {
    cache.set(nome, { valor: doVault, ate: agora + TTL_MS });
    return doVault;
  }

  throw new SegredoAusente(nome);
}

/** Só para teste: esquece o que está em memória. */
export function limparCacheDeSegredos(): void {
  cache.clear();
}
