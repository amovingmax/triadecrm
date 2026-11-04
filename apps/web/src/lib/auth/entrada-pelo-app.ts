import { enderecoDaRedeLocal, nomeDaRedeLocal } from '@/lib/auth/entrada-local';

/**
 * O LOGIN COM GOOGLE DENTRO DO APP DE CELULAR (04/11/2026).
 *
 * O Google recusa login dentro de WebView (`disallowed_useragent`), e a casca do app é
 * uma WebView. Até aqui o app mandava o login para o Safari, e a pessoa não voltava
 * logada: o Safari e o app não dividem cookie. Agora o login acontece na JANELA SEGURA
 * do iPhone (`ASWebAuthenticationSession`, a folha que outros apps abrem para "Entrar
 * com Google"), e o site entrega o login ao app quando a janela fecha:
 *
 *   1. o app intercepta `/auth/app/google`, sorteia um `estado` e abre a janela segura
 *      nesse endereço, dizendo para onde voltar (`volta`);
 *   2. `/auth/app/google` guarda estado e volta num cookie e manda para o Google, como
 *      o botão do navegador faz, com a volta em `/auth/callback?next=/auth/app/volta`;
 *   3. `/auth/app/volta`, já com a sessão da janela, gera um código de uso único para o
 *      mesmo e-mail (link mágico do Supabase, sem e-mail nenhum) e manda para
 *      `triade://auth?token=…&estado=…`. A janela fecha e só o app recebe o endereço;
 *   4. o app confere o estado e abre `/auth/app/entrar?token=…` na WebView, que troca o
 *      código pela sessão e grava os cookies do próprio app.
 *
 * Nada muda para quem usa o navegador: o botão só toma esse caminho com a marca do app
 * no user-agent, e as rotas novas só respondem a quem chega pela janela segura.
 */

export const INICIO_DO_APP = '/auth/app/google';
export const VOLTA_DO_APP = '/auth/app/volta';
export const ENTRAR_NO_APP = '/auth/app/entrar';

/** O cookie que leva estado e volta da ida ao Google até `/auth/app/volta`. */
export const COOKIE_DO_APP = 'triade_app_entrada';
/** Dez minutos: o tempo de escolher a conta e digitar a senha, com folga. */
export const VALIDADE_DO_COOKIE_S = 600;

/** A marca que a casca põe no user-agent (`apps/app/src/ambiente.ts`). */
export function estouNoApp(userAgent: string | null | undefined): boolean {
  return /\bTriadeApp\/\d/.test(userAgent ?? '');
}

/** O código que o app sorteia para reconhecer a própria volta (um UUID, no app). */
export function estadoValido(estado: string | null | undefined): estado is string {
  return typeof estado === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(estado);
}

/**
 * Para onde o código de uso único pode ir. Só para o próprio app, nunca para um site: com
 * o código, quem o recebe entra no CRM como a pessoa.
 *
 *   - `triade://auth`: o app instalado (TestFlight, loja);
 *   - `exp://<endereço da rede local>:<porta>/--/auth`: o app aberto pelo Expo Go, que
 *     não tem esquema próprio. Só endereço de rede privada ou nome `.local` (o Mac do
 *     teste); um endereço público seria um projeto de qualquer pessoa no Expo Go. Sai
 *     quando a equipe passar a usar o app instalado.
 */
export function voltaValida(volta: string | null | undefined): volta is string {
  if (volta === 'triade://auth') return true;
  const expo = /^exp:\/\/([^/:]+):(\d{2,5})\/--\/auth$/.exec(volta ?? '');
  if (!expo) return false;
  const host = expo[1] as string;
  return enderecoDaRedeLocal(host) || nomeDaRedeLocal(host);
}

/** O endereço de volta para o app, com os campos na query. */
export function enderecoDeVolta(volta: string, campos: Record<string, string>): string {
  return `${volta}?${new URLSearchParams(campos).toString()}`;
}

/** O que o cookie guarda, conferido de novo na leitura: ele volta do navegador. */
export function lerCookieDoApp(
  valor: string | null | undefined,
): { estado: string; volta: string } | null {
  if (!valor) return null;
  try {
    const lido = JSON.parse(valor) as { estado?: unknown; volta?: unknown };
    const estado = typeof lido.estado === 'string' ? lido.estado : null;
    const volta = typeof lido.volta === 'string' ? lido.volta : null;
    return estadoValido(estado) && voltaValida(volta) ? { estado, volta } : null;
  } catch {
    return null;
  }
}

/** O código de uso único que o Supabase devolve (`hashed_token`). */
export function codigoValido(codigo: string | null | undefined): codigo is string {
  return typeof codigo === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(codigo);
}
