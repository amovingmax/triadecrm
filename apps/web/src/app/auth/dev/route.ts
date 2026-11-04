/**
 * ENTRADA DE TESTE — SÓ EM `next dev`, SÓ COM O SUPABASE LOCAL.
 *
 * O login do CRM é só Google, e o Google não está configurado no Supabase local.
 * Esta rota entra com um dos usuários de teste, que só existem no banco local. A
 * tela de login mostra os botões dela no lugar do Google quando as mesmas travas
 * deixam (`lib/auth/entrada-local.ts`); fora delas, responde 404.
 *
 * Quem abre o link no endereço do outro papel é mandado para o endereço certo
 * antes de entrar (ver `USUARIOS_DE_TESTE`). No celular de teste não: lá é um
 * papel por vez (ver abaixo).
 */
import { NextResponse, type NextRequest } from 'next/server';

import {
  enderecoDaRedeLocal,
  entradaLocalLigada,
  USUARIOS_DE_TESTE,
} from '@/lib/auth/entrada-local';
import { destinoDepoisDoLogin } from '@/lib/supabase/middleware';
import { createClient } from '@/lib/supabase/server';

const SENHA = 'teste-local-agenda';

export async function GET(request: NextRequest) {
  if (!entradaLocalLigada()) {
    return new NextResponse('Not found', { status: 404 });
  }

  const quem = request.nextUrl.searchParams.get('quem') === 'sdr' ? 'sdr' : 'gestor';
  const usuario = USUARIOS_DE_TESTE[quem];
  // A volta do app de celular também vale: é por ela que o teste do login pelo app passa
  // pelos usuários de teste dentro da janela segura (`/auth/app/google`, no computador).
  const destino = destinoDepoisDoLogin(request.nextUrl.searchParams.get('next'));

  // O endereço de verdade sai do cabeçalho `Host`: em `next dev`, `request.url` e
  // `nextUrl` dizem `localhost` mesmo quando a aba abriu `127.0.0.1` (medido: o
  // primeiro desenho desta rota entrava em laço de redirecionamento por isso).
  const [hostDaAba = '', porta = '3000'] = (request.headers.get('host') ?? '').split(':');
  const origem = (host: string) => `http://${host}:${porta}`;
  // O celular de teste abre o site pelo endereço do computador na rede: lá não há a
  // aba do outro papel para proteger, e `localhost` seria o próprio celular. Entra
  // ali mesmo, um papel por vez.
  const hostCerto = enderecoDaRedeLocal(hostDaAba) ? hostDaAba : usuario.host;

  if (hostDaAba !== hostCerto) {
    const aqui = new URL('/auth/dev', origem(hostCerto));
    aqui.searchParams.set('quem', quem);
    aqui.searchParams.set('next', destino);
    return NextResponse.redirect(aqui);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: usuario.email,
    password: SENHA,
  });
  if (error) {
    return new NextResponse(
      `Não entrou como ${usuario.email}: ${error.message}. O usuário de teste existe no banco local?`,
      { status: 500 },
    );
  }
  return NextResponse.redirect(`${origem(hostCerto)}${destino}`);
}
