'use client';

import { ChevronDown, LogOut } from 'lucide-react';
import { useRef } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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

/**
 * Usuário no cabeçalho: avatar, nome e o papel em pt-BR (nunca o enum do banco).
 * Nome e papel ficam empilhados para caber nos 56px sem virar duas linhas de texto
 * corrido; no celular sobra só o avatar, e o nome vai para dentro do menu.
 */
export function UserMenu({ sessao }: { sessao: Sessao }) {
  const formSair = useRef<HTMLFormElement>(null);
  const rotuloPapel = ROTULO_PAPEL[sessao.papel];

  return (
    <>
      {/* Formulário escondido: sair é sempre POST (não GET), para não ser disparado por um link qualquer. */}
      <form ref={formSair} action="/auth/signout" method="post" className="hidden" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="lg"
            className="toque gap-2 px-1 sm:pr-1.5"
            aria-label={`Menu de ${sessao.nome}, ${rotuloPapel}`}
          >
            <Avatar className="size-7">
              {sessao.avatarUrl ? <AvatarImage src={sessao.avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-xs">{sessao.iniciais}</AvatarFallback>
            </Avatar>
            <span className="hidden max-w-36 flex-col items-start gap-0.5 sm:flex">
              <span className="w-full truncate text-[13px] leading-none font-medium">
                {sessao.nome}
              </span>
              <span className="w-full truncate text-[11px] leading-none text-muted-foreground">
                {rotuloPapel}
              </span>
            </span>
            <ChevronDown
              className="hidden size-3.5 text-muted-foreground sm:block"
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="flex flex-col gap-1">
            <span className="truncate font-medium">{sessao.nome}</span>
            {sessao.email ? (
              <span className="truncate text-xs font-normal text-muted-foreground">
                {sessao.email}
              </span>
            ) : null}
            <span className="text-xs font-normal text-muted-foreground">
              Papel: <span className="text-foreground">{rotuloPapel}</span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => formSair.current?.requestSubmit()}>
            <LogOut aria-hidden="true" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
