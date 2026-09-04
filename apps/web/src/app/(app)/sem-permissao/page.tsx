import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ROTULO_PAPEL } from '@/lib/auth/role';
import { requireSession } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Sem permissão' };

export default async function PaginaSemPermissao() {
  const sessao = await requireSession();

  return (
    <div className="mx-auto w-full max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-muted-foreground" aria-hidden="true" />
            Sem permissão
          </CardTitle>
          <CardDescription>
            Seu papel <Badge variant="pilula">{ROTULO_PAPEL[sessao.papel]}</Badge> não dá acesso a
            esta área. Se precisar dela, peça a um admin (Rafael, Luiz ou Matheus).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/meu-dia">Voltar para Meu dia</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
