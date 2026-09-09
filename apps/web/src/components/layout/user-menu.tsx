'use client';

import { ChevronDown, LogOut } from 'lucide-react';
import { useRef, useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { lerFilaDaPessoa, limparFilaAoSair } from '@/components/registro/fila-offline';
import type { RegistroNaFila } from '@/components/registro/tipos';
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
 *
 * **Sair também apaga o caderninho de campo.** A fila offline do registro é PII —
 * nome de parceiro, o que foi dito, a frase da autorização — e o celular de campo é
 * compartilhado: quem entrega o aparelho para o colega no meio da tarde não pode
 * deixar as anotações no armazenamento do navegador, sem sessão e sem prazo. A chave
 * por pessoa já impede que o próximo LEIA aquilo; a limpeza daqui impede que fique.
 * Quando ainda há registro guardado, a saída para para avisar: apagar trabalho sem
 * dizer é o mesmo defeito, do outro lado.
 */
export function UserMenu({ sessao }: { sessao: Sessao }) {
  const formSair = useRef<HTMLFormElement>(null);
  const rotuloPapel = ROTULO_PAPEL[sessao.papel];
  const [naoSubiram, setNaoSubiram] = useState<readonly RegistroNaFila[]>([]);
  const [avisando, setAvisando] = useState(false);

  function sair() {
    limparFilaAoSair(sessao.id);
    formSair.current?.requestSubmit();
  }

  function pedirParaSair() {
    const guardados = lerFilaDaPessoa(sessao.id);
    if (guardados.length === 0) {
      sair();
      return;
    }
    setNaoSubiram(guardados);
    setAvisando(true);
  }

  const quantos = naoSubiram.length;
  // Quatro linhas e o resto vira contagem: a lista aqui é para reconhecer o que está
  // em jogo, não para revisar registro a registro — isso é a tela de registro.
  const mostrados = naoSubiram.slice(0, 4);
  const restantes = quantos - mostrados.length;
  const titulo =
    quantos === 1 ? '1 registro ainda não subiu' : `${quantos} registros ainda não subiram`;

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
          <DropdownMenuItem className="min-h-11 md:min-h-0" onSelect={pedirParaSair}>
            <LogOut aria-hidden="true" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={avisando} onOpenChange={setAvisando}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription>
              O que ainda não subiu está guardado só neste aparelho. Sair apaga isso daqui: o
              celular é compartilhado, e o que você anotou não pode ficar para quem entrar depois.
            </DialogDescription>
          </DialogHeader>

          <ul className="flex flex-col divide-y divide-hairline border-y border-hairline">
            {mostrados.map((item) => (
              <li key={item.clientKey} className="truncate py-2 text-sm">
                <span className="font-medium">{item.parceiro}</span>
                <span className="text-muted-foreground"> · {item.desfecho}</span>
              </li>
            ))}
            {restantes > 0 ? (
              <li className="py-2 text-sm text-muted-foreground">
                {restantes === 1 ? 'E mais 1 registro.' : `E mais ${restantes} registros.`}
              </li>
            ) : null}
          </ul>

          <p className="text-sm text-muted-foreground">
            Para não perder: volte para Registrar, toque em “Tentar de novo” com a rede ligada e
            saia depois.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAvisando(false)}>
              Voltar
            </Button>
            <Button type="button" variant="destructive" onClick={sair}>
              Sair e apagar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
