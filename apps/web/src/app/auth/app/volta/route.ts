/**
 * A VOLTA PARA O APP DE CELULAR, ainda na janela segura do iPhone (ver
 * `lib/auth/entrada-pelo-app.ts`, passo 3).
 *
 * Chega aqui quem acabou de entrar com o Google nesta janela (`/auth/callback`) ou com um
 * usuário de teste (`/auth/dev`, no computador). Gera um código de uso único para o mesmo
 * e-mail e manda para o endereço do app. O redirecionamento para `triade://` fecha a
 * janela, e só o app que a abriu recebe o endereço.
 *
 * O código é o link mágico do Supabase gerado pelo servidor (`generateLink`): nenhum
 * e-mail sai, e ele vale uma vez só. A sessão desta janela é encerrada em seguida.
 *
 * Sem o cookie da ida (`/auth/app/google`), nada é gerado: só chega com ele quem começou
 * o login pelo app, nesta mesma janela, há menos de dez minutos.
 */
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { AVISOS, type ChaveAviso } from '@/app/login/avisos';
import { COOKIE_DO_APP, enderecoDeVolta, lerCookieDoApp } from '@/lib/auth/entrada-pelo-app';
import { origemDaRequisicao } from '@/lib/http';
import { createClient } from '@/lib/supabase/server';
import { criarClienteAdmin, temChaveDeServico } from '@/lib/supabase/servidor-admin';

export async function GET(request: NextRequest) {
  const base = origemDaRequisicao(request);
  const cookieStore = await cookies();
  const ida = lerCookieDoApp(cookieStore.get(COOKIE_DO_APP)?.value);
  cookieStore.set(COOKIE_DO_APP, '', { path: '/auth', maxAge: 0 });
  if (!ida) return NextResponse.redirect(`${base}/login?erro=app`);

  const voltar = (campos: Record<string, string>) =>
    NextResponse.redirect(enderecoDeVolta(ida.volta, { ...campos, estado: ida.estado }));

  // A recusa do login (e-mail sem acesso, conta sem perfil) vai para o app, que a mostra
  // na tela de login dele: na janela, a pessoa ficaria presa num aviso sem saída.
  const erro = request.nextUrl.searchParams.get('erro');
  if (erro) return voltar({ erro: erro in AVISOS ? (erro as ChaveAviso) : 'callback' });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !temChaveDeServico()) return voltar({ erro: 'callback' });

  const { data, error } = await criarClienteAdmin().auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  });
  // A sessão desta janela não serve para mais nada: quem fica logado é o app.
  await supabase.auth.signOut({ scope: 'local' });
  const codigo = data?.properties?.hashed_token;
  if (error || !codigo) {
    console.error(
      `[erro] ${request.nextUrl.pathname} generateLink: ${error?.message ?? 'sem código'}`,
    );
    return voltar({ erro: 'callback' });
  }
  return voltar({ token: codigo });
}
