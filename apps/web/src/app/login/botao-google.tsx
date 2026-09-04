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

  return (
    <Button
      size="lg"
      className="toque h-12 w-full justify-center text-base sm:w-auto sm:min-w-64"
      onClick={entrar}
      disabled={carregando}
      aria-busy={carregando}
    >
      {/* Sem giro redondo: o rótulo troca e o botão trava, que já é a resposta.
          O ícone continua o mesmo para o botão não mudar de largura. */}
      <IconeGoogle className="size-4" />
      {carregando ? 'Abrindo o Google' : rotulo}
    </Button>
  );
}
