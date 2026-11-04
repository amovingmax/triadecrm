'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { useAcoesDosAvisos } from '@/components/avisos/provedor-avisos';
import { EMPRESA } from '@/lib/empresa';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { concluirConversa } from './acoes';
import { CHAVE_CONVERSAS, mensagemDoErro } from './dados';
import { rotuloDoDia } from './formatos';

/**
 * CONCLUIR A CONVERSA (03/11/2026), nas duas empresas desde a tela de Conversas
 * no jeito do WhatsApp.
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
 * Nasceu só na Imova ("ficando bom e sendo aprovado por mim, a gente coloca na
 * Komune") e foi para a KOMUNE com o protótipo da tela no jeito do WhatsApp, que
 * o tem no cabeçalho, no menu ⋯ e na setinha de cada linha da lista. O módulo
 * continua existindo: desligado, volta o ícone de arquivar.
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
/**
 * Concluir e reabrir, com o aviso e o "Desfazer". É a mesma ação no botão do
 * cabeçalho, no menu ⋯ da conversa e no menu da linha da lista.
 */
export function useConcluirConversa(fioId: string) {
  const clientes = useQueryClient();
  const { reconferir } = useAcoesDosAvisos();
  const acao = useMutation({
    mutationFn: (concluir: boolean) => concluirConversa(fioId, concluir),
    onSuccess: (_r, concluir) => {
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      // A concluída sai do número do menu: a casca reconfere na hora, em vez de
      // esperar o próximo minuto.
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
  return acao;
}

/**
 * "Concluir", ou "Reabrir" na concluída: a pílula do cabeçalho, ao lado de
 * "Ligar", como no protótipo; na folha do celular, quem chama passa a classe do
 * bloco de ação.
 */
export function ConcluirConversa({
  fioId,
  concluidaEm,
  className,
  tamanho = 'pilula',
  rotuloPelaLargura = false,
}: {
  fioId: string;
  concluidaEm: string | null;
  className?: string;
  /** `pilula` no cabeçalho; `bloco` na folha e na ficha, com a classe de quem chama. */
  tamanho?: 'pilula' | 'bloco';
  /**
   * Em cabeçalho apertado o rótulo sai e fica o ícone (o nome continua para o
   * leitor de tela). Pede um `@container` em volta.
   */
  rotuloPelaLargura?: boolean;
}) {
  const acao = useConcluirConversa(fioId);
  const concluida = concluidaEm !== null;
  const rotulo = concluida ? 'Reabrir' : 'Concluir';

  return (
    <Button
      type="button"
      variant="outline"
      size={tamanho === 'pilula' ? 'sm' : 'default'}
      className={cn(
        tamanho === 'pilula' &&
          'toque h-10 shrink-0 rounded-full border-wpp-linha-forte bg-transparent px-3.5 text-[13.5px] font-medium',
        className,
      )}
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
          <span className="hidden @3xl:inline">{rotulo}</span>
          <span className="sr-only @3xl:hidden">{rotulo}</span>
        </>
      ) : (
        rotulo
      )}
    </Button>
  );
}

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
  fioId,
  concluidaEm,
  concluidaPor,
  podeReabrir,
  className,
}: {
  fioId: string;
  concluidaEm: string | null;
  concluidaPor: string | null;
  /** Quem só lê vê a faixa sem o botão. */
  podeReabrir: boolean;
  className?: string;
}) {
  const acao = useConcluirConversa(fioId);
  if (!CONCLUIR_NA_EMPRESA || concluidaEm === null) return null;
  return (
    <div
      role="status"
      className={cn(
        'flex shrink-0 items-center gap-2.5 border-b border-wpp-linha bg-wpp-painel2 py-2 pr-3 pl-4 text-[13px] leading-snug text-wpp-suave',
        className,
      )}
    >
      <CircleCheck className="size-[17px] shrink-0 text-wpp-autor" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-foreground">
          Concluída {quandoConcluiu(concluidaEm)}
          {concluidaPor ? ` por ${concluidaPor}` : ''}.
        </span>{' '}
        {COMO_VOLTA}
      </span>
      {podeReabrir ? (
        <Button
          type="button"
          variant="outline"
          className="toque h-9 shrink-0 rounded-full border-wpp-linha-forte bg-transparent px-3.5 text-[13px]"
          disabled={acao.isPending}
          onClick={() => acao.mutate(false)}
        >
          Reabrir
        </Button>
      ) : null}
    </div>
  );
}

/** "concluída" na linha da lista, como "bloqueado". */
export function SeloDeConcluida({ concluidaEm }: { concluidaEm: string | null | undefined }) {
  if (!CONCLUIR_NA_EMPRESA || !concluidaEm) return null;
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-wpp-chip px-2 text-[11px] font-semibold text-wpp-chip-texto">
      Concluída
    </span>
  );
}
