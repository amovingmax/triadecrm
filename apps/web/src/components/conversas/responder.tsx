'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import { BellOff, NotebookPen, PenLine, SendHorizontal } from 'lucide-react';
import { LIMITES_PADRAO } from '@komune/prompts';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { ErroDaConversa, responder } from './acoes';
import { CHAVE_CONVERSAS, chaveDaLinha } from './dados';
import { EnviarModelo } from './enviar-modelo';
import { podeEscreverLivre } from './mensagens';
import type { EstadoDaJanela, FioDaConversa } from './tipos';

/**
 * A caixa de resposta — e, principalmente, o que ela NÃO deixa fazer.
 *
 * ===========================================================================
 * A JANELA MANDA NA CAIXA
 * ===========================================================================
 * Dentro da janela de 24 h: texto livre, e é de graça. Fora dela: só modelo
 * aprovado pela Meta, porque é regra da plataforma e tentar texto livre não dá
 * erro nosso, dá erro deles. Então a caixa MUDA de forma conforme o relógio
 * acima dela — não é um aviso ao lado de um campo que continua aceitando tudo.
 *
 * Deixar a pessoa digitar e só depois recusar seria pior do que não deixar: ela
 * escreveu, pensou, e o trabalho foi para o lixo na hora de enviar. O gatilho
 * `messages_guard` recusaria de qualquer jeito (`sem_janela_e_sem_template`); a
 * tela existe para ninguém chegar até lá.
 *
 * ===========================================================================
 * E O QUE SAI, SAI PELA FILA
 * ===========================================================================
 * O que sai daqui entra em `messages` como `queued` e o worker de envio entrega
 * pela Cloud API, com o número da KOMUNE. O gatilho reconfere supressão e teto
 * na hora da entrega, não só na hora do clique — quem pedir para sair nesse
 * meio-tempo não recebe.
 *
 * ===========================================================================
 * E QUEM PEDIU PARA SAIR NÃO TEM CAIXA
 * ===========================================================================
 * A janela diz "agora não"; o opt-out diz "nunca mais". Por isso ele é a
 * PRIMEIRA pergunta desta função, antes da janela e antes de existir fio: o que
 * vale para texto livre vale igual para modelo aprovado e para o primeiro
 * contato de um fio que ainda não nasceu. Um formulário aberto para quem pediu
 * para sair é um convite a escrever uma mensagem que o banco vai recusar — e o
 * pior é que a pessoa só descobre depois de escrever.
 */
export function CaixaDeResposta({
  fio,
  janela,
  organizacaoId,
  naoContatar = false,
  recolhida = false,
  className,
}: {
  fio: FioDaConversa | null;
  janela: EstadoDaJanela;
  organizacaoId: string;
  /**
   * A ficha está em `do_not_contact`.
   *
   * O padrão é `false` porque a ausência do dado não pode virar um bloqueio: a
   * tela que não souber informar mostra a caixa, e o gatilho continua sendo o
   * guardrail de verdade. O contrário — presumir opt-out — esconderia a caixa
   * de todo mundo no dia em que alguém esquecesse de passar a prop.
   */
  naoContatar?: boolean;
  /**
   * Há um rascunho esperando aprovação logo acima.
   *
   * Aí a caixa nasce fechada, num botão de uma linha. Não é economia de pixel:
   * com rascunho na tela, a decisão é aprovar, editar ou descartar — e em 390 px
   * a caixa aberta empurrava justamente o "o que a IA entendeu" para fora da
   * vista, que é a parte que faz a aprovação não ser às cegas. Quem prefere
   * escrever à mão continua a um toque.
   */
  recolhida?: boolean;
  className?: string;
}) {
  const [aberta, setAberta] = useState(false);

  if (naoContatar) return <PediuParaSair organizacaoId={organizacaoId} className={className} />;

  // Sem conversa, ou com a janela de 24 h fechada, só modelo aprovado atravessa —
  // e é a mesma caixa para os dois (migração 20260914100000).
  if (!fio) return <EnviarModelo organizacaoId={organizacaoId} className={className} />;

  if (recolhida && !aberta) {
    return (
      <Button
        variant="outline"
        className={cn('toque h-11 w-full md:h-9 md:w-auto', className)}
        onClick={() => setAberta(true)}
      >
        <PenLine aria-hidden="true" />
        Prefiro escrever a resposta
      </Button>
    );
  }

  return podeEscreverLivre(janela) ? (
    <TextoLivre fio={fio} organizacaoId={organizacaoId} className={className} />
  ) : (
    <EnviarModelo organizacaoId={organizacaoId} className={className} />
  );
}

/**
 * O parceiro pediu para não receber mais nada.
 *
 * Este bloco não é um aviso ao lado de um campo que continua aceitando texto: ele
 * SUBSTITUI o formulário. E não oferece "registrar contato por telefone", que é a
 * saída dos outros dois blocos daqui — telefonar para quem pediu para sair é o
 * mesmo contato por outro canal, e a tela de registro já recusa o caso. A única
 * ação que sobra é a honesta: abrir a ficha e anotar.
 */
function PediuParaSair({
  organizacaoId,
  className,
}: {
  organizacaoId: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2 rounded-xl border border-dashed border-hairline p-3', className)}>
      <p className="flex items-center gap-2 text-sm font-medium">
        <BellOff className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        Este parceiro pediu para não receber mais mensagens
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Nada sai daqui para ele: nem texto livre dentro da janela de 24 h, nem modelo aprovado
        fora dela. O banco recusaria o envio de qualquer jeito, e a caixa fecha antes para
        ninguém escrever à toa. Se ele procurou você, anote na ficha — anotação não devolve
        ninguém para a fila.
      </p>
      <Button asChild variant="outline" className="toque h-11 md:h-9">
        <Link href={`/parceiros/${organizacaoId}`}>
          <NotebookPen aria-hidden="true" />
          Abrir a ficha do parceiro
        </Link>
      </Button>
    </div>
  );
}

/** Janela aberta: texto livre, que é o que a Meta permite e não cobra. */
function TextoLivre({
  fio,
  organizacaoId,
  className,
}: {
  fio: FioDaConversa;
  organizacaoId: string;
  className?: string;
}) {
  const clientes = useQueryClient();
  const [texto, setTexto] = useState('');

  const enviar = useMutation({
    mutationFn: () => responder({ fioId: fio.id, texto: texto.trim() }),
    onSuccess: () => {
      setTexto('');
      toast.success('Mensagem na fila do WhatsApp.', {
        description: 'Sai pelo número da KOMUNE em instantes.',
      });
      void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
      void clientes.invalidateQueries({ queryKey: chaveDaLinha(organizacaoId) });
    },
    onError: (erro) => {
      toast.error('A mensagem não entrou na fila.', {
        description:
          erro instanceof ErroDaConversa ? erro.message : 'Tente de novo em alguns segundos.',
      });
    },
  });

  const limpo = texto.trim();
  const longo = texto.length > LIMITES_PADRAO.maxCaracteres;

  return (
    <form
      className={cn('space-y-2', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (limpo && !enviar.isPending) enviar.mutate();
      }}
    >
      <label htmlFor="resposta" className="sr-only">
        Escrever para o parceiro
      </label>
      <textarea
        id="resposta"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={2}
        placeholder="Escreva para o parceiro"
        className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          className="toque h-11 md:h-9"
          disabled={limpo.length === 0 || enviar.isPending}
        >
          <SendHorizontal aria-hidden="true" />
          Enviar
        </Button>
        <span className="w-full text-[11px] leading-relaxed text-muted-foreground">
          O parceiro vê seu primeiro nome em negrito no começo da mensagem.
        </span>
        <span
          className={cn('text-[11px] text-muted-foreground', longo && 'text-destructive-texto')}
        >
          <span className="numerico">{texto.length}</span> de{' '}
          <span className="numerico">{LIMITES_PADRAO.maxCaracteres}</span> caracteres
        </span>
      </div>
    </form>
  );
}
