'use client';

import { Building2, Check, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type DestinoDoSeletor, EMPRESA } from '@/lib/empresa';

/**
 * Troca de empresa: o mesmo CRM, com os dados de outra empresa.
 *
 * Cada empresa é um deploy com banco próprio, então trocar é ABRIR o endereço da
 * outra, nunca mudar de banco por dentro — assim cada aba fica presa à sua empresa e
 * uma aba antiga não grava no banco errado. Na primeira vez, a outra empresa pede o
 * login com Google; o navegador guarda os dois.
 *
 * `destinos` já vem recortado para a pessoa (`seletor-da-pessoa.tsx`): só aparece para
 * quem a outra empresa respondeu que entra lá. Com uma empresa só, não aparece.
 */
export function SeletorDeEmpresa({ destinos }: { destinos: DestinoDoSeletor[] }) {
  if (destinos.length < 2) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="lg"
          className="toque h-11 min-w-11 justify-center gap-1.5 px-2 md:h-9"
          aria-label={`Empresa: ${EMPRESA.nome}. Trocar de empresa`}
          title="Trocar de empresa"
        >
          <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="hidden max-w-40 truncate text-[13px] font-medium sm:inline">
            {EMPRESA.nome}
          </span>
          <ChevronDown className="hidden size-3.5 text-muted-foreground sm:block" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Trocar de empresa
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {destinos.map((destino) =>
          destino.atual ? (
            <DropdownMenuItem key={destino.slug} className="min-h-11 md:min-h-0" disabled>
              <Check aria-hidden="true" />
              {destino.nome}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={destino.slug} className="min-h-11 md:min-h-0" asChild>
              <a href={`${destino.url}/meu-dia`}>
                <span className="size-4" aria-hidden="true" />
                {destino.nome}
              </a>
            </DropdownMenuItem>
          ),
        )}
        <p className="px-2 pt-1 pb-1.5 text-xs leading-snug text-muted-foreground">
          Cada empresa tem os seus dados e o seu login. Na primeira vez, entre com o Google.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
