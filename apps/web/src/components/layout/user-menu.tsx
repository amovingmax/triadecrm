'use client';

import { ChevronDown, LogOut } from 'lucide-react';
import { useRef } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ROTULO_PAPEL } from '@/lib/auth/role';
import { type Sessao } from '@/lib/auth/session';

/** Avatar + nome + papel no cabeçalho, com menu para sair (POST /auth/signout). */
export function UserMenu({ sessao }: { sessao: Sessao }) {
  const formSair = useRef<HTMLFormElement>(null);
  const rotuloPapel = ROTULO_PAPEL[sessao.papel];

  return (
    <div className="flex items-center gap-2">
      {/* Formulário escondido: sair é sempre POST (não GET), para não ser disparado por um link qualquer. */}
      <form ref={formSair} action="/auth/signout" method="post" className="hidden" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-10 gap-2 px-2" aria-label="Menu do usuário">
            <Avatar>
              {sessao.avatarUrl ? <AvatarImage src={sessao.avatarUrl} alt="" /> : null}
              <AvatarFallback>{sessao.iniciais}</AvatarFallback>
            </Avatar>
            <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">
              {sessao.nome}
            </span>
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {rotuloPapel}
            </Badge>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-1">
            <span className="truncate font-medium">{sessao.nome}</span>
            {sessao.email ? (
              <span className="truncate text-xs font-normal text-muted-foreground">
                {sessao.email}
              </span>
            ) : null}
            <span className="pt-1">
              <Badge variant="secondary">{rotuloPapel}</Badge>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => formSair.current?.requestSubmit()}>
            <LogOut aria-hidden="true" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="outline"
        size="sm"
        className="hidden md:inline-flex"
        onClick={() => formSair.current?.requestSubmit()}
      >
        <LogOut aria-hidden="true" />
        Sair
      </Button>
    </div>
  );
}
