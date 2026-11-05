import { ENDERECOS, partesDoEndereco, type EmpresaDoApp } from './ambiente';

/**
 * Em que empresa o app abre (05/11/2026).
 *
 * Cada empresa é um site com login próprio, e no login do app a pessoa escolhe a
 * empresa antes de entrar (o seletor da tela de login, só no app). Quem decide se ela
 * entra é o login daquela empresa, como no navegador: e-mail fora da lista ou sem
 * perfil é recusado lá.
 *
 * A casca guarda a última empresa em que a pessoa ENTROU, e não a última que tocou: só
 * conta uma página de dentro do CRM, nunca o login nem o caminho dele (`/login`,
 * `/auth`). Quem tocou em Imova, foi recusado e fechou o app volta para onde entrava.
 *
 * Sem nada do React Native aqui: o que grava no aparelho fica na casca.
 */

const EMPRESAS = Object.keys(ENDERECOS) as EmpresaDoApp[];

/** O valor guardado no aparelho, se ainda for uma empresa conhecida. */
export function empresaGuardada(valor: string | null | undefined): EmpresaDoApp | null {
  const limpo = (valor ?? '').trim();
  return (EMPRESAS as string[]).includes(limpo) ? (limpo as EmpresaDoApp) : null;
}

/** A empresa de uma página de dentro do CRM; `null` no login, no caminho dele e fora. */
export function empresaParaLembrar(
  endereco: string,
  origens: Record<EmpresaDoApp, string>,
): EmpresaDoApp | null {
  const partes = partesDoEndereco(endereco);
  if (!partes) return null;
  const empresa = EMPRESAS.find((slug) => {
    const origem = partesDoEndereco(origens[slug]);
    return origem?.esquema === partes.esquema && origem.host === partes.host;
  });
  if (!empresa) return null;
  const caminho = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(endereco.trim())?.[1] || '/';
  const doLogin =
    caminho === '/' ||
    caminho === '/login' ||
    caminho.startsWith('/login/') ||
    caminho === '/auth' ||
    caminho.startsWith('/auth/');
  return doLogin ? null : empresa;
}
