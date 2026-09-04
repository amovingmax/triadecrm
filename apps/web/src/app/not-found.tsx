import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NaoEncontrada() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-sm font-medium text-muted-foreground">Erro 404</p>
      <h1 className="font-heading text-2xl font-semibold">Página não encontrada</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        O endereço pode estar errado ou a tela ainda não existe nesta versão do CRM.
      </p>
      <Button asChild>
        <Link href="/meu-dia">Voltar para Meu dia</Link>
      </Button>
    </div>
  );
}
