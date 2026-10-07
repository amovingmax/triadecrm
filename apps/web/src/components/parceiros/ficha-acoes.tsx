'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Ellipsis,
  MessageCircle,
  Pencil,
  PhoneOutgoing,
  SquareKanban,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { HREF_EXCLUIDOS } from '@/lib/navegacao';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  excluirParceiro,
  recadoDaExclusao,
  restaurarParceiro,
  resumoDoRecibo,
} from '@/components/exclusao/acoes';
import { DialogoExcluir } from '@/components/exclusao/dialogo-excluir';

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
 *   - "⋯" guarda o que se faz de vez em quando: ver no funil, editar a ficha e,
 *     desde 07/10/2026, EXCLUIR o parceiro.
 *
 * No celular os dois primeiros dividem a largura e o menu fica na ponta.
 *
 * ---------------------------------------------------------------------------
 * EXCLUIR (07/10/2026)
 * ---------------------------------------------------------------------------
 * A ficha não tinha como sair da base: a importação desfeita depois de 48 h
 * mandava "agora é um parceiro de cada vez, na ficha dele", e a ficha não tinha
 * o botão. Agora tem, para admin e gestor, no fim do menu e atrás de uma linha —
 * longe do dedo que ia em "Editar ficha".
 *
 * Excluir não apaga: tira de circulação (`public.parceiro_excluir`) e leva junto
 * o que estava pendente. Por isso o aviso de depois tem "Desfazer", e a lista de
 * Excluídos fica a um clique. O motivo é obrigatório: é o que essa lista mostra.
 */
export function AcoesDaFicha({
  organizationId,
  nome,
  podeEscrever,
  podeExcluir,
  conversaNoCrm,
  hrefDoFunil,
}: {
  organizationId: string;
  /** O nome do parceiro, para o diálogo de exclusão dizer de quem se trata. */
  nome: string;
  podeEscrever: boolean;
  /** Admin e gestor (`podeExcluirParceiro`). Quem decide é o banco. */
  podeExcluir: boolean;
  /** O número da KOMUNE está conectado e a pessoa pode escrever por ele. */
  conversaNoCrm: boolean;
  /** `null` quando o parceiro não está em funil nenhum: não há coluna para onde ir. */
  hrefDoFunil: string | null;
}) {
  const editar = useEditarFicha();
  const router = useRouter();
  const [excluindo, setExcluindo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const temMenu = hrefDoFunil !== null || editar !== null || podeExcluir;

  async function desfazer() {
    const r = await restaurarParceiro(organizationId);
    if (r.ok) {
      toast.success(`${r.nome} voltou para a base.`);
      router.push(`/parceiros/${organizationId}`);
    } else {
      toast.error('Não deu para restaurar.', { description: recadoDaExclusao(r.motivo) });
    }
  }

  async function excluir(motivo: string) {
    setOcupado(true);
    const r = await excluirParceiro(organizationId, motivo);
    setOcupado(false);
    if (!r.ok) {
      toast.error('Não foi excluído.', { description: recadoDaExclusao(r.motivo) });
      return;
    }
    setExcluindo(false);
    toast.success(`${r.recibo.nome} saiu da base.`, {
      description: resumoDoRecibo(r.recibo) ?? 'Dá para restaurar em Prospectados → Excluídos.',
      action: { label: 'Desfazer', onClick: () => void desfazer() },
      duration: 10_000,
    });
    // A ficha deixou de existir para as telas: a lista de onde ela veio é o
    // lugar para onde voltar, e `refresh` tira do cache a ficha que saiu.
    router.push('/parceiros');
    router.refresh();
  }

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
            {podeExcluir ? (
              <>
                {hrefDoFunil || editar ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem variant="destructive" onSelect={() => setExcluindo(true)}>
                  <Trash2 aria-hidden="true" />
                  Excluir parceiro
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {podeExcluir ? (
        <DialogoExcluir
          aberto={excluindo}
          aoFechar={() => setExcluindo(false)}
          titulo={`Excluir ${nome}?`}
          descricao={
            <>
              <p>
                Ele sai de Prospectados, do funil, dos lotes de ligação e das Conversas. As
                tarefas e reuniões marcadas com ele são canceladas, e nenhuma mensagem automática
                sai mais.
              </p>
              <p>
                Nada é apagado: o histórico fica guardado e dá para restaurar depois, em{' '}
                <Link href={HREF_EXCLUIDOS} className="font-medium text-foreground underline">
                  Excluídos
                </Link>
                . Se ele pediu para não ser procurado, isso continua valendo.
              </p>
            </>
          }
          motivo="obrigatorio"
          exemploDeMotivo="Ex.: cadastrado duas vezes, é o mesmo da outra ficha"
          rotuloConfirmar="Excluir parceiro"
          ocupado={ocupado}
          aoConfirmar={(motivo) => void excluir(motivo)}
        />
      ) : null}
    </nav>
  );
}
