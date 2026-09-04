'use client';

import { useState } from 'react';
import { ArrowRight, NotebookPen, PauseCircle, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { anotarNaAtividade, corrigirComQuem } from '@/components/registro/ajustes';
import { formatarQuando } from '@/components/registro/formatos';
import {
  COM_QUEM_ABRE_PORTA,
  perguntaComQuem,
  ROTULOS_COM_QUEM,
  type ComQuem,
} from '@/components/registro/tipos';

import { cn } from '@/lib/utils';
import {
  ESPERA_ANTES_DO_PROXIMO_MS,
  type DesfechoDeLigacao,
  type ItemDoLote,
  type ResultadoTabulacao,
} from './tipos';

/**
 * O recibo: zero toque, e é ele que faz a próxima ligação acontecer.
 *
 * Ele mostra o que ACABOU de ser gravado (o desfecho, a próxima ação, se o contato
 * volta para a fila) e some sozinho depois de `ESPERA_ANTES_DO_PROXIMO_MS`, trazendo
 * o próximo contato já com a fala de abertura pronta. É o "encerrar-e-próxima" do
 * R13 §7.6, e é o único ganho de produtividade real do módulo.
 *
 * NÃO existe "Desfazer" aqui, e a ausência é deliberada: o toque no desfecho já é o
 * commit, `sdr` não tem `delete` em `activities` (a política `activities_delete` é só
 * admin), e prometer um desfazer que o banco não deixa cumprir seria mentira. O que
 * dá para corrigir sem mentir é a anotação, e ela está aqui num toque.
 *
 * ===========================================================================
 * A contagem PARA no primeiro toque, e não volta a andar
 * ===========================================================================
 * Os 5 segundos existem para quem não vai fazer nada — e para essa pessoa eles são o
 * ganho do módulo. Para quem TOCOU em alguma coisa aqui, eles eram um sequestro: foi
 * medido com uma anotação de 40 caracteres, que a tela levou embora no meio da frase
 * junto com o contato. Por isso o primeiro toque em QUALQUER controle deste recibo
 * (o rádio de "com quem falou", o botão de anotar, o campo de texto) para a contagem,
 * e ela não recomeça: quem começou a escrever decide quando vai para o próximo, no
 * botão que já está aqui embaixo. Nada se perde e nada anda sozinho por cima.
 */
export function ChamadaRecibo({
  item,
  rotulo,
  desfecho,
  resultado,
  comQuemGravado,
  restaMs,
  pausado,
  aoPausar,
  aoProximo,
}: {
  item: ItemDoLote;
  /** O nome do que foi gravado: o desfecho comercial, ou o resultado técnico. */
  rotulo: string;
  /** Nulo quando ninguém atendeu: aí não há interlocutor a confirmar. */
  desfecho: DesfechoDeLigacao | null;
  resultado: Extract<ResultadoTabulacao, { tabulado: true }>;
  /** O que a tabulação REALMENTE gravou em `metadata.com_quem`. */
  comQuemGravado: ComQuem;
  restaMs: number;
  /** A contagem parou porque a pessoa tocou em alguma coisa aqui. */
  pausado: boolean;
  aoPausar: () => void;
  aoProximo: () => void;
}) {
  const [anotando, setAnotando] = useState(false);
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [comQuem, setComQuem] = useState<ComQuem>(comQuemGravado);

  const proxima = formatarQuando(resultado.proxima_acao_em);
  const fracao = Math.max(0, Math.min(1, restaMs / ESPERA_ANTES_DO_PROXIMO_MS));

  /**
   * A correção de quem estava do outro lado, e ela vale por uma métrica: RF-MET-01 só
   * conta porta ABERTA quando o registro AFIRMA que a conversa foi com o decisor ou
   * com quem influencia a decisão.
   *
   * A PERGUNTA não mora mais aqui: ela é feita na barra de tabulação, antes do commit
   * (`ChamadaTabulacao`), porque perguntar depois é perguntar a quem já está discando
   * o próximo — e o que ficava gravado era `nao_informado` em quase toda ligação
   * atendida, reunião marcada inclusive. O que sobra aqui é a correção do que já foi
   * gravado, com o valor real pré-selecionado. Quem recalcula a porta é o gatilho do
   * banco, não esta tela.
   */
  async function corrigir(valor: ComQuem) {
    if (!resultado.activity_id) return;
    setComQuem(valor);
    try {
      await corrigirComQuem(resultado.activity_id, valor);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : 'Não deu para corrigir.');
    }
  }

  async function anotar() {
    if (!resultado.activity_id) return;
    setSalvando(true);
    try {
      await anotarNaAtividade(resultado.activity_id, texto);
      setAnotando(false);
      toast.success('Anotado.');
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : 'Não deu para anotar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    // O primeiro toque em qualquer controle daqui de dentro para a contagem. Fica na
    // captura (`onPointerDownCapture` / `onFocusCapture`) para valer também para o
    // teclado e para o foco que o `autoFocus` do campo de anotação dá sozinho.
    <div
      className="flex flex-col gap-5 pt-2"
      onPointerDownCapture={aoPausar}
      onFocusCapture={aoPausar}
    >
      <div
        aria-hidden="true"
        className={cn(
          'h-1.5 w-full origin-left transition-transform duration-150 ease-linear',
          pausado ? 'bg-muted' : 'bg-foreground',
        )}
        style={{ transform: `scaleX(${pausado ? 0 : 1 - fracao})` }}
      />

      <div className="flex flex-col gap-2">
        <p className="text-2xl leading-snug font-medium">
          Gravado. <span className="text-muted-foreground">{item.nome}</span>
        </p>
        <p className="text-base">{rotulo}</p>

        {proxima ? (
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <ArrowRight className="size-3.5" aria-hidden="true" />
            {resultado.proxima_acao_titulo ?? 'Próxima ação'}:{' '}
            <span className="numerico text-foreground">{proxima}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Sem próxima ação: este contato encerrou.</p>
        )}

        {resultado.volta_para_fila ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Volta para a fila deste lote na próxima janela.
          </p>
        ) : null}

        <p className="text-sm text-muted-foreground">
          Faltam <span className="numerico text-foreground">{resultado.restantes}</span> neste lote.
        </p>
      </div>

      {desfecho && resultado.activity_id && perguntaComQuem(desfecho) ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm text-muted-foreground">
            Com quem você falou — corrija se estiver errado
          </legend>
          <div className="flex flex-wrap gap-2">
            {COM_QUEM_ABRE_PORTA.map((valor) => (
              <button
                key={valor}
                type="button"
                aria-pressed={comQuem === valor}
                onClick={() => void corrigir(valor)}
                className={cn(
                  'toque inline-flex h-10 items-center rounded-lg border px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  comQuem === valor
                    ? 'border-input bg-muted font-medium'
                    : 'border-hairline text-muted-foreground',
                )}
              >
                {ROTULOS_COM_QUEM[valor]}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {resultado.activity_id ? (
        anotando ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              autoFocus
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="O que vale lembrar da conversa"
              className="h-11"
            />
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={salvando}
              onClick={() => void anotar()}
            >
              Salvar anotação
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAnotando(true)}
            className="flex items-center gap-1.5 self-start rounded-lg px-2 py-1 text-sm text-muted-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <NotebookPen className="size-3.5" aria-hidden="true" />
            Anotar
          </button>
        )
      ) : null}

      {pausado ? (
        <p
          aria-live="polite"
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <PauseCircle className="size-3.5" aria-hidden="true" />
          A fila esperou por você. Termine aqui e toque em Próximo.
        </p>
      ) : null}

      <Button type="button" className="h-12 w-full text-base sm:w-auto" onClick={aoProximo}>
        Próximo
      </Button>
    </div>
  );
}
