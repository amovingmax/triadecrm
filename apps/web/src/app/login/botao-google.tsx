'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { IconeGoogle } from '@/components/icone-google';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

/** Login Google via Supabase Auth (RF-ADM-01). Volta em /auth/callback, que troca o código pela sessão. */
export function BotaoGoogle({ next }: { next: string }) {
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
      toast.error('Não foi possível iniciar o login com o Google.', { description: error.message });
      setCarregando(false);
    }
  }

  return (
    <Button size="lg" className="w-full" onClick={entrar} disabled={carregando}>
      {carregando ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <IconeGoogle className="size-4" />
      )}
      Entrar com Google
    </Button>
  );
}
