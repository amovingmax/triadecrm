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
import { cn } from '@/lib/utils';
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

import { BotaoLigar } from '@/components/ligacao/voz-botao-ligar';

import { useEditarFicha } from './ficha-edicao';

/**
 * Um botão das ações da ficha: bloco de 60 px com o ícone em cima no celular,
 * pílula de 44 px (40 no desktop) a partir de `sm`. Os nomes do celular são de
 * uma palavra, e os blocos dividem por igual o que o "Mais" (48 px) deixa.
 *
 * Medido em 04/11/2026, com os quatro botões da KOMUNE: com o "Mais" do mesmo
 * tamanho dos outros, "Conversar" em 12,5 px passava da borda do bloco a 360 px
 * e encostava a 320. Abaixo de 360 o nome desce para 10,5 px, o tamanho dos
 * nomes da barra de baixo do iPhone.
 */
const BLOCO =
  'toque h-auto min-h-[60px] min-w-0 flex-1 basis-0 flex-col gap-1 rounded-2xl px-0.5 py-2 text-[10.5px] min-[360px]:text-[12.5px] sm:h-11 sm:min-h-0 sm:flex-none sm:basis-auto sm:flex-row sm:gap-1.5 sm:rounded-full sm:px-4 sm:text-sm md:h-10';

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
 *   - "⋯" guarda o que se faz de vez em quando: ver no funil, editar a ficha e,
 *     desde 07/10/2026, EXCLUIR o parceiro.
 *
 * No celular todos dividem a largura em blocos iguais, o menu inclusive ("Mais").
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
  temTelefone,
  podeEscrever,
  podeExcluir,
  conversaNoCrm,
  hrefDoFunil,
}: {
  organizationId: string;
  /** O nome do parceiro, para o diálogo de exclusão dizer de quem se trata. */
  nome: string;
  /** A ficha tem telefone (inteiro ou mascarado): sem ele não há para onde ligar. */
  temTelefone: boolean;
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
    // NO CELULAR, BLOCOS IGUAIS NUMA LINHA SÓ (04/11/2026), com o ícone em cima e
    // o nome embaixo, como as ações de um contato no iPhone. Os botões em pílula
    // quebravam: "Abrir a conversa" e "Registrar" ocupavam a linha e o "⋯" descia
    // sozinho para a segunda (antes, com a telefonia ligada, chegavam a passar da
    // borda, 20/10/2026). Os blocos dividem a largura por quantos botões houver —
    // dois, três ou quatro —, então nada quebra nem num celular de 320.
    // A partir de `sm` volta a ser a fila de pílulas de sempre.
    <nav
      aria-label="O que fazer com este parceiro"
      className="flex gap-1.5 min-[360px]:gap-2 sm:flex-wrap sm:items-center"
    >
      <Button asChild className={BLOCO}>
        <Link href={`/conversas?org=${organizationId}`}>
          <MessageCircle aria-hidden="true" />
          <span className="sm:hidden">{conversaNoCrm ? 'Conversar' : 'Conversa'}</span>
          <span className="hidden sm:inline">
            {conversaNoCrm ? 'Conversar' : 'Abrir a conversa'}
          </span>
        </Link>
      </Button>

      {podeEscrever ? (
        <Button asChild variant="outline" className={BLOCO}>
          <Link href={`/registrar?org=${organizationId}`}>
            <PhoneOutgoing aria-hidden="true" />
            <span className="sm:hidden">Registrar</span>
            <span className="hidden sm:inline">Registrar contato</span>
          </Link>
        </Button>
      ) : null}

      {podeEscrever ? (
        <BotaoLigar organizationId={organizationId} temTelefone={temTelefone} className={BLOCO} />
      ) : null}

      {temMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className={cn(BLOCO, 'w-12 flex-none basis-auto sm:size-11 sm:px-0 md:size-10')}
              aria-label="Mais ações deste parceiro"
            >
              <Ellipsis aria-hidden="true" />
              <span className="sm:hidden" aria-hidden="true">
                Mais
              </span>
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
