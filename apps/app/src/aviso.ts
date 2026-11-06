import { partesDoEndereco, type EmpresaDoApp } from './ambiente';

/**
 * Os avisos no celular (push), do lado do app (06/11/2026).
 *
 * Quem decide e manda os avisos é o banco de cada empresa (migração
 * 20261106120000_avisos_no_celular, pelo serviço de push do Expo). O app faz duas coisas:
 *
 *   · entrega o endereço de push deste aparelho a cada empresa em que a pessoa entra
 *     (`scriptDoAparelho`, rodado DENTRO da página, com a sessão dela): o site o grava
 *     (`POST /api/aparelhos`) e guarda num cookie, que a saída da conta lê para desligar
 *     o aparelho daquela pessoa;
 *   · abre a tela do aviso tocado (`enderecoDoAviso`), na empresa de onde ele veio.
 *
 * O que vem no aviso é tratado como dado de fora: só abre empresa conhecida e caminho
 * simples do próprio site. Sem nada do React Native aqui: roda igual nos testes.
 */

export type Plataforma = 'ios' | 'android';

const CAMINHO = /^\/[A-Za-z0-9/_?=&-]*$/;

/** O endereço que o toque no aviso abre, ou `null` se o aviso não for nosso. */
export function enderecoDoAviso(
  dados: unknown,
  origens: Record<EmpresaDoApp, string>,
): string | null {
  if (!dados || typeof dados !== 'object') return null;
  const { empresa, caminho } = dados as { empresa?: unknown; caminho?: unknown };
  if (typeof empresa !== 'string' || !Object.hasOwn(origens, empresa)) return null;
  if (typeof caminho !== 'string' || !CAMINHO.test(caminho) || caminho.startsWith('//')) {
    return null;
  }
  return origens[empresa as EmpresaDoApp] + caminho;
}

/**
 * O roteiro que a casca roda na página da empresa: guarda o endereço de push num cookie
 * desta empresa (a saída da conta o lê) e o registra para a pessoa logada. Falhar aqui
 * não atrapalha nada: o app tenta de novo na próxima vez que abrir.
 */
export function scriptDoAparelho(token: string, plataforma: Plataforma): string {
  const t = JSON.stringify(token);
  const p = JSON.stringify(plataforma);
  return `(function () {
  try {
    var seguro = location.protocol === 'https:' ? '; secure' : '';
    document.cookie = 'triade_aparelho=' + encodeURIComponent(${t}) + '; path=/; max-age=31536000; samesite=lax' + seguro;
    fetch('/api/aparelhos', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: ${t}, plataforma: ${p} })
    }).catch(function () {});
  } catch (e) {}
})();
true;`;
}

/** A origem (esquema e host) de um endereço, para lembrar onde o aparelho já foi entregue. */
export function origemDe(endereco: string): string | null {
  const partes = partesDoEndereco(endereco);
  return partes ? `${partes.esquema}://${partes.host}` : null;
}
