import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { BotaoGoogle } from '@/app/login/botao-google';
import { Logo } from '@/components/logo';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getSession } from '@/lib/auth/session';
import { destinoSeguro } from '@/lib/supabase/middleware';

export const metadata: Metadata = {
  title: 'Entrar',
};

const MENSAGENS_ERRO: Record<string, string> = {
  callback: 'Não foi possível concluir o login. Tente de novo.',
  provedor: 'O Google não autorizou o acesso. Tente de novo ou use outra conta.',
  sessao: 'Sua sessão expirou. Entre de novo.',
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PaginaLogin({ searchParams }: Props) {
  const params = await searchParams;
  const next = destinoSeguro(typeof params.next === 'string' ? params.next : null);
  const erro = typeof params.erro === 'string' ? MENSAGENS_ERRO[params.erro] : undefined;

  // O proxy já redireciona quem está logado; isto cobre o acesso direto em modo de desenvolvimento.
  if (await getSession()) redirect(next);

  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Logo className="mb-2 text-lg" />
          <CardTitle>Entrar no CRM</CardTitle>
          <CardDescription>
            Use a conta Google da equipe KOMUNE. O acesso é restrito ao domínio da empresa.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {erro ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {erro}
            </p>
          ) : null}
          <BotaoGoogle next={next} />
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-center text-xs text-muted-foreground">
            Sem conta? Peça acesso a um admin (Rafael, Luiz ou Matheus).
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
