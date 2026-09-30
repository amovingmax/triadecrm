'use client';

import { useState } from 'react';
import { ArrowRight, Check, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatarDataHora, formatarNumero } from '@/components/parceiros/formatos';

import { candidatosNaFila, desfazerLote, fraseDoDesfazer, mensagemDoErro } from './dados';
import { ORDEM_DAS_DECISOES, ROTULO_DECISAO, type Recibo as TipoRecibo } from './tipos';

/**
 * O que aconteceu, depois de gravar.
 *
 * Duas coisas importam aqui e nenhuma delas é a comemoração: para onde ir agora
 * (a fila de Revisão, quando sobrou algo para decidir) e como voltar atrás. O
 * desfazer é do RF-BAS-17 e vale 48 h; ele não desfaz cegamente — o banco só
 * remove o que o lote criou e ninguém tocou DEPOIS, e conta quantas fichas
 * ficaram de pé.
 *
 * Três correções do laudo moram nesta tela:
 *   · §3.7 — o botão de desfazer só aparece para quem o Postgres deixa desfazer
 *     (admin e gestor). Quem importa e não desfaz lê para quem pedir, em vez de
 *     apertar e levar um 403 traduzido como "o servidor não respondeu".
 *   · §3.6 — a frase do desfazer não afirma mais que "alguém já trabalhou": ela
 *     enumera o que o banco de fato confere (`fraseDoDesfazer`).
 *   · §3.12g — "Decidir as N que ficaram na fila" conta CANDIDATOS, não linhas
 *     da planilha (`candidatosNaFila`).
 */
export function Recibo({
  recibo,
  podeDesfazer,
  aoRecomecar,
  aoDesfazer,
}: {
  recibo: TipoRecibo;
  /** Espelho de `app.is_manager()`. A autorização de verdade é o Postgres. */
  podeDesfazer: boolean;
  aoRecomecar: () => void;
  aoDesfazer: () => void;
}) {
  const [desfazendo, setDesfazendo] = useState(false);
  const paraDecidir = candidatosNaFila(recibo.linhas);
  const criados = recibo.contagem.entra ?? 0;

  const desfazer = async () => {
    setDesfazendo(true);
    try {
      const r = await desfazerLote(recibo.loteId);
      if (r.jaEstava) {
        toast.info('Esse lote já tinha sido desfeito.');
      } else {
        toast.success(fraseDoDesfazer(r));
      }
      aoDesfazer();
    } catch (erro) {
      toast.error(mensagemDoErro(erro));
    } finally {
      setDesfazendo(false);
    }
  };

  return (
    // O fim da importação, num cartão (30/09/2026): o resultado em uma frase
    // grande com o disco de menta, as contagens em pílula e as três saídas.
    // O desfazer desceu para uma linha discreta no pé — ele é a exceção, e
    // como botão vermelho do lado de "Ver os parceiros" competia com o caminho
    // normal.
    <section className="sombra-base flex flex-col gap-5 rounded-xl bg-card p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-menta text-menta-tinta">
          <Check className="size-5" aria-hidden="true" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">
            {criados === 0
              ? 'Pronto. Nenhuma virou parceiro ainda'
              : `Pronto: ${formatarNumero(criados)} ${criados === 1 ? 'novo parceiro' : 'novos parceiros'}`}
          </h2>
          <p className="truncate text-sm text-muted-foreground" title={recibo.rotulo}>
            {recibo.rotulo}
          </p>
        </div>
      </div>

      <ul className="flex flex-wrap gap-2">
        {ORDEM_DAS_DECISOES.filter((d) => (recibo.contagem[d] ?? 0) > 0).map((decisao) => (
          <li key={decisao}>
            <Badge variant="pilula" className="h-auto gap-1.5 px-3 py-1 text-[13px]">
              <span className="numerico font-semibold">
                {formatarNumero(recibo.contagem[decisao] ?? 0)}
              </span>
              {ROTULO_DECISAO[decisao]}
            </Badge>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button asChild className="toque h-11 md:h-10">
          <Link href="/parceiros">
            Ver os parceiros
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>

        {paraDecidir > 0 ? (
          <Button asChild variant="outline" className="toque h-11 md:h-10">
            <Link href="/revisao">
              Abrir a Revisão ({formatarNumero(paraDecidir)})
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : null}

        <Button variant="ghost" onClick={aoRecomecar} className="toque h-11 md:h-10">
          Importar outra lista
        </Button>
      </div>

      <div className="flex flex-col gap-2 border-t border-hairline pt-4 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          {podeDesfazer ? (
            <>
              Errou o arquivo? Dá para desfazer
              {recibo.desfazerAte ? (
                <>
                  {' até '}
                  <span className="numerico">{formatarDataHora(recibo.desfazerAte)}</span>
                </>
              ) : null}
              . Sai só o que ninguém mexeu depois.
            </>
          ) : (
            <>
              Errou o arquivo? Peça a um gestor para desfazer
              {recibo.desfazerAte ? (
                <>
                  {' até '}
                  <span className="numerico">{formatarDataHora(recibo.desfazerAte)}</span>
                </>
              ) : null}
              .
            </>
          )}
        </p>
        {podeDesfazer ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={desfazendo}
            onClick={() => void desfazer()}
            className="toque h-11 shrink-0 text-destructive-texto hover:text-destructive-texto md:h-8"
          >
            <Undo2 aria-hidden="true" />
            {desfazendo ? 'Desfazendo...' : 'Desfazer esta importação'}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
