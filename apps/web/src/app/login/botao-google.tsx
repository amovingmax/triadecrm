'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { IconeGoogle } from '@/components/icone-google';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

/**
 * Login Google via Supabase Auth (RF-ADM-01). Volta em /auth/callback, que troca o
 * código pela sessão. O clique leva para fora do app, então o botão fica travado
 * com o rótulo trocado até a navegação acontecer: sem isso o time clica duas vezes.
 *
 * O "G" do Google é a única marca colorida da interface e fica fora do bloqueio de
 * paleta de propósito: as diretrizes da Google não permitem redesenhar o logotipo,
 * e um botão de OAuth sem ele é mais lento de reconhecer.
 */
export function BotaoGoogle({
  next,
  rotulo = 'Entrar com Google',
}: {
  next: string;
  rotulo?: string;
}) {
  const [carregando, setCarregando] = useState(false);

  async function entrar() {
    // `aria-disabled` não bloqueia o clique como `disabled`: a guarda é aqui.
    if (carregando) return;
    setCarregando(true);
    const supabase = createClient();
    const redirectTo = new URL('/auth/callback', window.location.origin);
    redirectTo.searchParams.set('next', next);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo.toString(),
        queryParams: { prompt: 'select_account' },
      },
    });

    if (error) {
      toast.error('Não foi possível abrir o login do Google.', {
        description: 'Verifique a conexão e tente de novo.',
      });
      setCarregando(false);
    }
  }

  // A variante padrão do Button já é `acao-gradiente`: gradiente de ação, hover em
  // 1.02 e toque em 0.98, em 150ms. `sombra-base` acrescenta a elevação tingida pela
  // base, nunca sombra preta. Nada de `toque` aqui: dois utilitários mexendo no mesmo
  // `transform` cancelariam o `translate-y-px` que o próprio botão aplica no clique.
  //
  // `aria-disabled` e não `disabled`: o `disabled:opacity-50` da base do Button
  // atenuaria o botão inteiro, e o texto "Abrindo o Google" (que é justamente a
  // mensagem de estado que a pessoa precisa ler para não clicar de novo) cairia para
  // 2,02:1 no topo do gradiente e 1,47:1 na parada final. Assim o gradiente e o
  // rótulo ficam cheios; quem trava o segundo clique é a guarda em `entrar`, e o
  // `acao-gradiente` já ignora hover e toque quando aria-disabled está ligado.
  return (
    <Button
      size="lg"
      className="sombra-base h-12 w-full justify-center text-base aria-disabled:cursor-progress sm:w-auto sm:min-w-64"
      onClick={entrar}
      aria-disabled={carregando}
      aria-busy={carregando}
    >
      {/* Sem giro redondo: o rótulo troca e o botão trava, que já é a resposta.
          O ícone continua o mesmo para o botão não mudar de largura. */}
      <IconeGoogle className="size-4" />
      {carregando ? 'Abrindo o Google' : rotulo}
    </Button>
  );
}
