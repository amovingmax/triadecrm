import 'server-only';

/**
 * Registro das rotas de servidor, para o log da Vercel.
 *
 * Escrito depois de uma rota falhar em produção e o log só mostrar
 * `POST /api/telefone/procurar` — sem status, sem motivo, sem nada. A recusa
 * tinha nome (`chave_recusada`, `api_desabilitada`, `limite_do_google`), e ela
 * chegou à pessoa que clicou, mas não a quem podia consertar. Diagnosticar
 * dependia de alguém repetir o clique e ler o texto do aviso em voz alta.
 *
 * Regra que este módulo existe para cumprir: **o motivo que a tela mostra tem de
 * aparecer no log também**. São públicos diferentes — a pessoa lê "peça ao Luiz
 * para habilitar a API", o log lê `api_desabilitada` com o texto cru do Google —
 * mas a mesma causa.
 *
 * O que NUNCA entra aqui: telefone, e-mail, token, chave. O log da Vercel é
 * retido, exportável e visível para quem tem acesso ao projeto; ele não é lugar
 * de PII nem de segredo. Por isso a assinatura pede `detalhe` como texto curto
 * de diagnóstico, e quem chama é responsável por não pôr dado de pessoa nele.
 */

type Campos = Record<string, string | number | boolean | null | undefined>;

function linha(nivel: 'erro' | 'aviso', rota: string, motivo: string, campos?: Campos): string {
  const extra = Object.entries(campos ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  return `[${nivel}] ${rota} motivo=${motivo}${extra ? ' ' + extra : ''}`;
}

/** Recusa que a rota devolve com 4xx/5xx. */
export function registrarRecusa(rota: string, motivo: string, campos?: Campos): void {
  console.error(linha('erro', rota, motivo, campos));
}

/** Situação que não impede a resposta, mas alguém precisa saber. */
export function registrarAviso(rota: string, motivo: string, campos?: Campos): void {
  console.warn(linha('aviso', rota, motivo, campos));
}
