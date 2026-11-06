/**
 * Os avisos no celular (push do app), do lado do site (06/11/2026).
 *
 * O app pede a permissão do iPhone, pega o endereço de push do Expo e o entrega a cada
 * empresa em que a pessoa está logada (`POST /api/aparelhos`), que o grava no banco
 * (`public.aparelho_registrar`). O app também deixa o mesmo endereço num cookie desta
 * empresa (`COOKIE_DO_APARELHO`): ao sair da conta, a rota `/auth/signout` o lê e
 * desliga o aparelho daquela pessoa ANTES de encerrar a sessão.
 *
 * Quem decide e manda os avisos é o banco (migração 20261106210000, `app.avisos_push_*`).
 * Fora do app nada disso acontece: o navegador nunca chama estas rotas.
 */

export const COOKIE_DO_APARELHO = 'triade_aparelho';

const TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;

export function tokenValido(valor: unknown): valor is string {
  return typeof valor === 'string' && TOKEN.test(valor);
}

export type Plataforma = 'ios' | 'android';

export function plataformaValida(valor: unknown): valor is Plataforma {
  return valor === 'ios' || valor === 'android';
}
