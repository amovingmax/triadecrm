import { ShieldAlert } from 'lucide-react';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EMPRESA, UM_ADMIN } from '@/lib/empresa';

/**
 * O que aparece quando o site e o banco são de empresas diferentes
 * (`lib/conferir-empresa.ts`). Nenhuma tela abre e nada é gravado: a pessoa só
 * precisa saber que não é com ela e a quem avisar.
 */
export function BancoDeOutraEmpresa({ empresaDoBanco }: { empresaDoBanco: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-destructive" aria-hidden="true" />
              O CRM não abriu, por segurança
            </CardTitle>
            <CardDescription>
              Este endereço é o CRM da {EMPRESA.nome}, mas o banco de dados ligado a ele é de outra
              empresa ({empresaDoBanco}). Para nenhum dado de uma empresa aparecer ou ser gravado na
              outra, o CRM fica fechado até a configuração ser corrigida. Avise {UM_ADMIN}.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </main>
  );
}
