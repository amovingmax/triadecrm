'use client';

import Link from 'next/link';
import { Ellipsis, MessageCircle, Pencil, PhoneOutgoing, SquareKanban } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { BotaoLigar } from '@/components/ligacao/voz-botao-ligar';

import { useEditarFicha } from './ficha-edicao';

/**
 * As saídas da ficha, no cabeçalho.
 *
 * Eram quatro botões do mesmo peso, empilhados no celular: 210 px de tela antes
 * de qualquer informação. Agora são duas ações à vista e um menu:
 *
 *   - CONVERSAR é a de destaque. É o que mais se faz depois de ler uma ficha, e
 *     é para lá que apontam o histórico e o WhatsApp.
 *   - REGISTRAR CONTATO fica ao lado, só para quem escreve: o banco recusaria a
 *     gravação do papel de leitura no fim do fluxo (`app.can_write()`).
 *   - LIGAR aparece só com a telefonia ligada (`voz.telefonia`) e para quem escreve:
 *     abre a tela de ligar com o roteiro, para este parceiro, e a chamada sai do navegador.
 *   - "⋯" guarda o que se faz de vez em quando: ver no funil e editar a ficha.
 *
 * No celular os dois primeiros dividem a largura e o menu fica na ponta.
 */
export function AcoesDaFicha({
  organizationId,
  temTelefone,
  podeEscrever,
  conversaNoCrm,
  hrefDoFunil,
}: {
  organizationId: string;
  /** A ficha tem telefone (inteiro ou mascarado): sem ele não há para onde ligar. */
  temTelefone: boolean;
  podeEscrever: boolean;
  /** O número da KOMUNE está conectado e a pessoa pode escrever por ele. */
  conversaNoCrm: boolean;
  /** `null` quando o parceiro não está em funil nenhum: não há coluna para onde ir. */
  hrefDoFunil: string | null;
}) {
  const editar = useEditarFicha();
  const temMenu = hrefDoFunil !== null || editar !== null;

  return (
    <nav aria-label="O que fazer com este parceiro" className="flex items-center gap-2">
      <Button asChild className="toque h-11 flex-1 px-4 sm:flex-none md:h-10">
        <Link href={`/conversas?org=${organizationId}`}>
          <MessageCircle aria-hidden="true" />
          {conversaNoCrm ? 'Conversar' : 'Abrir a conversa'}
        </Link>
      </Button>

      {podeEscrever ? (
        <Button asChild variant="outline" className="toque h-11 flex-1 px-4 sm:flex-none md:h-10">
          <Link href={`/registrar?org=${organizationId}`}>
            <PhoneOutgoing aria-hidden="true" />
            <span className="sm:hidden">Registrar</span>
            <span className="hidden sm:inline">Registrar contato</span>
          </Link>
        </Button>
      ) : null}

      {podeEscrever ? (
        <BotaoLigar organizationId={organizationId} temTelefone={temTelefone} />
      ) : null}

      {temMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="toque size-11 shrink-0 rounded-full md:size-10"
              aria-label="Mais ações deste parceiro"
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {hrefDoFunil ? (
              <DropdownMenuItem asChild>
                <Link href={hrefDoFunil}>
                  <SquareKanban aria-hidden="true" />
                  Ver no funil
                </Link>
              </DropdownMenuItem>
            ) : null}
            {editar ? (
              <DropdownMenuItem onSelect={() => editar()}>
                <Pencil aria-hidden="true" />
                Editar ficha
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </nav>
  );
}
