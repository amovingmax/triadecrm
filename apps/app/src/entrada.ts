import { partesDoEndereco, type RegrasDaCasca } from './ambiente';

/**
 * O LOGIN COM GOOGLE PELA JANELA SEGURA (04/11/2026).
 *
 * O Google recusa login dentro de WebView. A casca então intercepta o pedido do site
 * (`/auth/app/google`, o botão "Entrar com Google" quando o site vê a marca do app) e
 * abre esse endereço na janela segura do iPhone (`ASWebAuthenticationSession`, pelo
 * `expo-web-browser`), com um estado sorteado e o endereço de volta. O site faz o
 * login lá e devolve um código de uso único no endereço de volta, que só esta casca
 * recebe. A casca confere o estado e abre `/auth/app/entrar` com o código na WebView,
 * que fica logada. O lado do site está em `apps/web/src/lib/auth/entrada-pelo-app.ts`.
 *
 * Este arquivo não importa nada do React Native, como `ambiente.ts`: roda no Vitest. Nem
 * `URL` nem `URLSearchParams`: as do React Native não implementam tudo.
 */

export const CAMINHO_DO_INICIO = '/auth/app/google';
export const CAMINHO_DE_ENTRAR = '/auth/app/entrar';

/** A parte do caminho de um endereço, sem query nem âncora. */
function caminhoDe(endereco: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(endereco.trim())?.[1] ?? '';
}

/**
 * Se o endereço é o início do login pelo app, a origem do site que o pediu (é nela que
 * a janela abre e para ela que a WebView volta). Só vale nos sites da casa e, no ar, só
 * em https: a volta carrega a sessão da pessoa.
 */
export function origemDoInicio(
  endereco: string,
  regras: Pick<RegrasDaCasca, 'hosts' | 'soHttps'>,
): string | null {
  const partes = partesDoEndereco(endereco);
  if (!partes || !regras.hosts.includes(partes.host)) return null;
  const seguro = partes.esquema === 'https' || (partes.esquema === 'http' && !regras.soHttps);
  if (!seguro || caminhoDe(endereco) !== CAMINHO_DO_INICIO) return null;
  return `${partes.esquema}://${partes.host}`;
}

/**
 * Para onde o site devolve o login. O app instalado tem esquema próprio (`triade`, no
 * `app.config.ts`); no Expo Go o app é um projeto servido pelo Mac, e a volta é o
 * endereço dele (`exp://<Mac>:8081/--/auth`).
 */
export function voltaDoApp(noExpoGo: boolean, hostUri: string | null | undefined): string {
  return noExpoGo && hostUri ? `exp://${hostUri}/--/auth` : 'triade://auth';
}

/** O endereço que a janela segura abre. */
export function enderecoDoInicio(origem: string, estado: string, volta: string): string {
  return (
    `${origem}${CAMINHO_DO_INICIO}` +
    `?estado=${encodeURIComponent(estado)}&volta=${encodeURIComponent(volta)}`
  );
}

export type Devolucao = { codigo: string } | { erro: string };

/** Os campos da query de um endereço. */
function camposDe(endereco: string): Map<string, string> {
  const query = endereco.split('#')[0]!.split('?')[1] ?? '';
  const campos = new Map<string, string>();
  for (const par of query.split('&')) {
    if (!par) continue;
    const [chave = '', valor = ''] = par.split('=');
    try {
      campos.set(decodeURIComponent(chave), decodeURIComponent(valor.replace(/\+/g, ' ')));
    } catch {
      // Campo malformado: fica de fora, e a falta dele vira recusa abaixo.
    }
  }
  return campos;
}

/**
 * O que a janela devolveu. Sem o estado sorteado por esta casca, nada vale: é o que
 * impede outro alguém de entregar ao app um login que não foi pedido aqui.
 */
export function lerDevolucao(endereco: string, estado: string): Devolucao {
  const campos = camposDe(endereco);
  if (campos.get('estado') !== estado) return { erro: 'app' };
  const erro = campos.get('erro');
  if (erro) return { erro: /^[a-z-]{1,30}$/.test(erro) ? erro : 'callback' };
  const codigo = campos.get('token');
  return codigo && /^[A-Za-z0-9_-]{20,200}$/.test(codigo) ? { codigo } : { erro: 'app' };
}

/** Para onde a WebView vai quando a janela fecha: a entrada com o código, ou o aviso. */
export function enderecoDepoisDaJanela(origem: string, devolucao: Devolucao): string {
  return 'codigo' in devolucao
    ? `${origem}${CAMINHO_DE_ENTRAR}?token=${encodeURIComponent(devolucao.codigo)}`
    : `${origem}/login?erro=${encodeURIComponent(devolucao.erro)}`;
}
