'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { useAcoesDosAvisos } from '@/components/avisos/provedor-avisos';
import { EMPRESA } from '@/lib/empresa';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { concluirConversa } from './acoes';
import { CHAVE_CONVERSAS, mensagemDoErro } from './dados';
import { rotuloDoDia } from './formatos';

/**
 * CONCLUIR A CONVERSA (03/11/2026), só na Imova por enquanto.
 *
 * Pedido: "colocar uma conversa como 'Concluída' e fazer com que ela saia das
 * conversas, mas não devemos perder o histórico [...] Assim que formos conversar
 * novamente com esse cliente devemos ter o histórico da conversa com ele". A
 * lista enchia de conversas de meses atrás.
 *
 * Concluir É o arquivar de 29/09/2026: as mesmas colunas e a mesma RPC
 * (`conversa_arquivar`), e nada é apagado. O arquivar já existia, mas era um
 * ícone de caixa sem nome, que ninguém lia como "terminei aqui". O que a Imova
 * ganha:
 *   - o botão com nome, "Concluir" (e "Reabrir" na concluída);
 *   - "Concluídas" no alto da lista: a gaveta onde se acha a conversa antiga;
 *   - a faixa na conversa concluída, dizendo quando, quem e como ela volta;
 *   - a volta também quando alguém do time escreve, e a saída do Meu dia
 *     (as duas no banco, `app.concluir_ligado`).
 *
 * Na KOMUNE nada disso aparece: fica o ícone de arquivar até o usuário aprovar
 * ("ficando bom e sendo aprovado por mim, a gente coloca na Komune").
 *
 * SEM CONFIRMAÇÃO, como o arquivar: nada é destruído, o aviso traz "Desfazer" e o
 * próprio botão vira "Reabrir".
 */
export const CONCLUIR_NA_EMPRESA: boolean = EMPRESA.modulos.concluirConversa;

/** Como a conversa concluída volta: o aviso e a faixa dizem a mesma frase. */
const COMO_VOLTA =
  'Ela volta para a lista quando a pessoa escrever ou quando alguém do time mandar mensagem.';

/**
 * "Concluir", ou "Reabrir" na concluída. No cabeçalho do computador é um botão
 * do tamanho dos vizinhos ("Transferir", "Registrar contato"); na folha do
 * celular, quem chama passa a classe do bloco de ação.
 */
export function ConcluirConversa({
  fioId,
  concluidaEm,
  className = 'toque h-9',
  tamanho = 'sm',
  rotuloPelaLargura = false,
}: {
  fioId: string;
  concluidaEm: string | null;
  className?: string;
  tamanho?: 'sm' | 'default';
  /**
   * O nome só com o cabeçalho largo (`@container`, 48rem), como o "Transferir".
   * O cabeçalho do parceiro tem cinco ações: num notebook de 1280 px o nome com
   * a palavra cortava o nome do parceiro em "So…". Estreito, fica o ícone.
   */
  rotuloPelaLargura?: boolean;
}) {
  const clientes = useQueryClient();
  const { reconferir } = useAcoesDosAvisos();
  const concluida = concluidaEm !== null;
  const acao = useMutation({
    mutationFn: (concluir: boolean) => concluirConversa(fioId, concluir),
    onSuccess: (_r, concluir) => {
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      // A concluída sai do número do menu e da marca "Nova" na hora, e a
      // reaberta volta: quem decide é a leitura dos avisos (`avisos/dados.ts`).
      reconferir();
      if (concluir) {
        toast.success('Conversa concluída.', {
          description: `O histórico fica guardado. ${COMO_VOLTA}`,
          action: { label: 'Desfazer', onClick: () => acao.mutate(false) },
        });
      } else {
        toast.success('Conversa reaberta: de volta na lista.');
      }
    },
    onError: (e) => toast.error(mensagemDoErro(e)),
  });

  return (
    <Button
      type="button"
      variant="outline"
      size={tamanho}
      className={className}
      disabled={acao.isPending}
      onClick={() => acao.mutate(!concluida)}
      title={
        concluida
          ? 'Trazer de volta para a lista de conversas'
          : 'Tirar da lista de conversas. O histórico fica guardado.'
      }
    >
      {concluida ? <RotateCcw aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
      {rotuloPelaLargura ? (
        <>
          <span className="hidden @3xl:inline">{concluida ? 'Reabrir' : 'Concluir'}</span>
          <span className="sr-only @3xl:hidden">{concluida ? 'Reabrir' : 'Concluir'}</span>
        </>
      ) : concluida ? (
        'Reabrir'
      ) : (
        'Concluir'
      )}
    </Button>
  );
}

/** "hoje", "ontem" ou "em 30/10": o dia da conclusão, curto. */
function quandoConcluiu(iso: string): string {
  const dia = rotuloDoDia(iso);
  return dia.numero ? `em ${dia.numero}` : dia.palavra;
}

/**
 * A faixa da conversa concluída, logo abaixo do cabeçalho: quando, quem e como
 * ela volta. Quem abre uma conversa pela lista de "Concluídas" (ou pela ficha)
 * precisa saber que ela está fora da lista antes de escrever nela.
 */
export function FaixaDeConcluida({
  concluidaEm,
  concluidaPor,
  className,
}: {
  concluidaEm: string | null;
  concluidaPor: string | null;
  className?: string;
}) {
  if (!CONCLUIR_NA_EMPRESA || concluidaEm === null) return null;
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 bg-muted/40 px-4 py-1.5 text-[11px] text-muted-foreground md:px-5',
        className,
      )}
    >
      <CircleCheck className="mt-px size-3 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-medium text-foreground">
          Concluída {quandoConcluiu(concluidaEm)}
          {concluidaPor ? ` por ${concluidaPor}` : ''}.
        </span>{' '}
        {COMO_VOLTA}
      </span>
    </p>
  );
}

/** "concluída" na linha da lista, como "bloqueado". */
export function SeloDeConcluida({ concluidaEm }: { concluidaEm: string | null | undefined }) {
  if (!CONCLUIR_NA_EMPRESA || !concluidaEm) return null;
  return (
    <Badge variant="pilula" className="h-4 shrink-0 px-1.5 text-[10px] font-normal">
      concluída
    </Badge>
  );
}

/**
 * "Concluídas", no alto da lista: liga e desliga a gaveta das conversas
 * concluídas. Mesma pílula da ordem ("Recentes · Mais interessados"), à direita
 * dela. Ligada, a lista mostra SÓ as concluídas (`FiltrosConversas.concluidas`).
 */
export function FiltroDasConcluidas({
  ativo,
  aoMudar,
  className,
}: {
  ativo: boolean;
  aoMudar: (ativo: boolean) => void;
  className?: string;
}) {
  if (!CONCLUIR_NA_EMPRESA) return null;
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={() => aoMudar(!ativo)}
      title={ativo ? 'Voltar para as conversas abertas' : 'Ver só as conversas concluídas'}
      className={cn(
        'toque inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors md:h-6',
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        ativo
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      <CircleCheck className="size-3" aria-hidden="true" />
      Concluídas
    </button>
  );
}
