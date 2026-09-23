'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { toast } from 'sonner';
import { BellOff, NotebookPen, PenLine, SendHorizontal } from 'lucide-react';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

import { ErroDaConversa, responder } from './acoes';
import { CHAVE_CONVERSAS, chaveDaLinha } from './dados';
import { EnviarModelo } from './enviar-modelo';
import { GravarAudio } from './gravar-audio';
import { podeEscreverLivre } from './mensagens';
import {
  aplicarResposta,
  atalhoEmDigitacao,
  respostasQueBatem,
  type RespostaPronta,
} from './respostas-prontas';

/**
 * O teto da Cloud API para uma mensagem de texto. É o único limite que existe de
 * verdade aqui: `LIMITES_PADRAO.maxCaracteres` (300) é do robô, não de gente.
 */
const TETO_DO_WHATSAPP = 4096;
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
        Nada sai daqui para ele: nem texto livre dentro da janela de 24 h, nem modelo aprovado fora
        dela. O banco recusaria o envio de qualquer jeito, e a caixa fecha antes para ninguém
        escrever à toa. Se ele procurou você, anote na ficha — anotação não devolve ninguém para a
        fila.
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

/** Até onde a caixa cresce sozinha: dez linhas, e daí em diante ela rola. */
const ALTURA_MAXIMA = 220;

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
  const respostas = useQuery({
    queryKey: ['conversas', 'respostas-prontas'],
    queryFn: async (): Promise<RespostaPronta[]> => {
      const { data } = await createClient()
        .from('respostas_rapidas')
        .select('id, atalho, titulo, texto')
        .eq('ativo', true)
        .order('atalho');
      return (data ?? []) as RespostaPronta[];
    },
    staleTime: 5 * 60_000,
  });
  const digitando = atalhoEmDigitacao(texto);
  const sugestoes = digitando === null ? [] : respostasQueBatem(respostas.data ?? [], digitando);

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
  // O teto de 300 de `LIMITES_PADRAO` é do ROBÔ (RF-CON-24): ele existe para a
  // resposta automática não virar um texto de vendas. Aplicá-lo a uma pessoa que
  // está escrevendo à mão era um erro de categoria — quem fala com o parceiro é
  // gente, e gente escreve o que precisa. O teto aqui é o da Cloud API.
  const longo = texto.length > TETO_DO_WHATSAPP;
  const pode = limpo.length > 0 && !enviar.isPending && !longo;

  // A CAIXA CRESCE COM O TEXTO, de uma linha até dez.
  //
  // Ela era fixa em duas linhas: quem escreve três parágrafos digitava dentro de
  // uma janelinha rolando, e quem escreve "ok" pagava duas linhas de altura numa
  // tela de 390 px onde cada linha é uma mensagem a menos à vista.
  const caixa = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, ALTURA_MAXIMA)}px`;
  }, [texto]);

  return (
    <form
      className={cn('space-y-1.5', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (pode) enviar.mutate();
      }}
    >
      <label htmlFor="resposta" className="sr-only">
        Escrever para o parceiro
      </label>
      {sugestoes.length > 0 ? (
        <ul
          aria-label="Respostas prontas"
          className="max-h-48 overflow-y-auto rounded-xl border border-hairline bg-popover shadow-sm"
        >
          {sugestoes.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setTexto(aplicarResposta(texto, r))}
                className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <code className="shrink-0 text-primary">/{r.atalho}</code>
                <span className="min-w-0 truncate text-muted-foreground">{r.titulo}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Uma caixa só: o texto, o microfone e o enviar na mesma moldura, como em
          qualquer aplicativo de conversa. O botão inteiro numa linha própria
          custava 56 px de tela e uma varredura de olho a mais. */}
      <div className="flex items-end gap-1 rounded-2xl border border-input bg-card/60 py-1 pr-1 pl-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40">
        <textarea
          id="resposta"
          ref={caixa}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter manda no computador; no celular o Enter do teclado é quebra
            // de linha, e enviar ali seria mandar metade da frase toda vez.
            if (e.key !== 'Enter' || e.shiftKey) return;
            if (window.matchMedia?.('(pointer: coarse)').matches) return;
            e.preventDefault();
            if (pode) enviar.mutate();
          }}
          rows={1}
          placeholder="Mensagem"
          className="min-h-9 flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        {/* Gravar fica ao lado de Enviar porque são a mesma decisão: como mandar
            isto. Dentro da janela de 24 h os dois valem. */}
        <GravarAudio key={fio.id} fioId={fio.id} />
        <Button
          type="submit"
          size="icon"
          className="toque size-10 shrink-0 rounded-full md:size-9"
          disabled={!pode}
        >
          <SendHorizontal aria-hidden="true" />
          <span className="sr-only">Enviar pelo WhatsApp</span>
        </Button>
      </div>

      {/* Com a caixa vazia, a dica dos atalhos — e só no computador, onde há
          tecla para isso e espaço para dizer. No celular a mesma linha seria um
          rodapé permanente sobre uma tela que já é estreita. */}
      {texto.length === 0 ? (
        <p className="hidden px-1 text-[11px] leading-relaxed text-muted-foreground md:block">
          <code className="text-primary">/</code> abre as respostas prontas · Enter envia,
          Shift+Enter quebra a linha
        </p>
      ) : null}

      {texto.length > 0 ? (
        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
          Sai com seu primeiro nome em negrito na frente.
          {texto.length > TETO_DO_WHATSAPP - 400 ? (
            <span className={cn(longo && 'text-destructive-texto')}>
              {' · '}
              <span className="numerico">{texto.length}</span> de{' '}
              <span className="numerico">{TETO_DO_WHATSAPP}</span> caracteres
            </span>
          ) : null}
        </p>
      ) : null}
    </form>
  );

}
