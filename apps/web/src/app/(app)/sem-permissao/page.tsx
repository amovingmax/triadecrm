import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ROTULO_PAPEL } from '@/lib/auth/role';
import { requireSession } from '@/lib/auth/session';
import { UM_ADMIN } from '@/lib/empresa';
import { LEITURA } from '@/lib/larguras';

export const metadata: Metadata = { title: 'Sem permissão' };

export default async function PaginaSemPermissao() {
  const sessao = await requireSession();

  return (
    <div className={LEITURA}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-muted-foreground" aria-hidden="true" />
            Sem permissão
          </CardTitle>
          <CardDescription>
            Seu papel <Badge variant="pilula">{ROTULO_PAPEL[sessao.papel]}</Badge> não dá acesso a
            esta área. Se precisar dela, peça a {UM_ADMIN}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* 44px no celular (16/11/2026): é a única saída da tela, e com a altura
              padrão do botão (32px) ela era o menor alvo da página. */}
          <Button asChild className="toque h-11 w-full sm:w-auto md:h-9">
            <Link href="/meu-dia">Voltar para Meu dia</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
