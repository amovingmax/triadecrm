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
 *
 * A entrelinha das duas linhas é a da tinta, não a do corpo: elas cortam com
 * `truncate` (`overflow: hidden`) e, em português, o acento sobe acima da altura de
 * maiúscula. Com `leading-none` a caixa do nome tinha 13px para 19px de tinta na
 * Poppins e o agudo do "í" de "Heloísa" saía ceifado; `leading-tight` ainda deixava
 * 2px de fora. `leading-5` (20px) cobre os 19px do nome e `leading-4` (16px) cobre os
 * 16px do papel — e as duas somam exatamente os 36px do botão no desktop, então o
 * `gap` entre elas sai: a própria entrelinha já separa.
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
            className="toque h-11 min-w-11 justify-center gap-2 px-1 sm:min-w-0 sm:pr-1.5 md:h-9"
            aria-label={`Menu de ${sessao.nome}, ${rotuloPapel}`}
          >
            <Avatar className="size-7">
              {sessao.avatarUrl ? <AvatarImage src={sessao.avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-xs">{sessao.iniciais}</AvatarFallback>
            </Avatar>
            <span className="hidden max-w-36 flex-col items-start sm:flex">
              <span className="w-full truncate text-[13px] leading-5 font-medium">
                {sessao.nome}
              </span>
              <span className="w-full truncate text-[11px] leading-4 text-muted-foreground">
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
          <DropdownMenuItem
            className="min-h-11 md:min-h-0"
            onSelect={() => formSair.current?.requestSubmit()}
          >
            <LogOut aria-hidden="true" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
