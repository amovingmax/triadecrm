'use client';

import { useState } from 'react';
import { ArrowRight, Undo2 } from 'lucide-react';
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
 * (a fila do Radar, quando sobrou algo para decidir) e como voltar atrás. O
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
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-heading text-lg font-semibold tracking-tight">Importação concluída</h2>
        <p className="text-sm text-muted-foreground">
          Lote <span className="font-medium text-foreground">{recibo.rotulo}</span>
          {recibo.desfazerAte ? (
            <>
              {' · dá para desfazer até '}
              <span className="numerico">{formatarDataHora(recibo.desfazerAte)}</span>
            </>
          ) : null}
        </p>
      </div>

      <ul className="flex flex-wrap gap-2">
        {ORDEM_DAS_DECISOES.filter((d) => (recibo.contagem[d] ?? 0) > 0).map((decisao) => (
          <li key={decisao}>
            <Badge variant="pilula" className="h-auto py-1">
              <span className="numerico font-semibold">
                {formatarNumero(recibo.contagem[decisao] ?? 0)}
              </span>
              {ROTULO_DECISAO[decisao]}
            </Badge>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button asChild className="toque h-11 md:h-9">
          <Link href="/parceiros">
            Ver os parceiros
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>

        {paraDecidir > 0 ? (
          <Button asChild variant="outline" className="toque h-11 md:h-9">
            <Link href="/radar">
              Decidir {paraDecidir === 1 ? 'a que ficou' : `as ${formatarNumero(paraDecidir)} que ficaram`} na fila
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : null}

        <Button variant="ghost" onClick={aoRecomecar} className="toque h-11 md:h-9">
          Importar outra planilha
        </Button>

        {podeDesfazer ? (
          <Button
            variant="destructive"
            disabled={desfazendo}
            onClick={() => void desfazer()}
            className="toque h-11 md:h-9"
          >
            <Undo2 aria-hidden="true" />
            {desfazendo ? 'Desfazendo...' : 'Desfazer este lote'}
          </Button>
        ) : null}
      </div>

      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {podeDesfazer ? (
          <>
            O desfazer remove só o que este lote criou e ninguém tocou depois. Ficha com conversa
            registrada, mudança de etapa, autorização ou ligação continua de pé, e o CRM diz quantas
            foram.
          </>
        ) : (
          <>
            Desfazer uma importação é de gestor. Peça a um gestor para desfazer este lote (
            <span className="font-medium text-foreground">{recibo.rotulo}</span>) antes de{' '}
            {recibo.desfazerAte ? (
              <span className="numerico">{formatarDataHora(recibo.desfazerAte)}</span>
            ) : (
              'o prazo de 48 h acabar'
            )}
            . Depois disso é ficha por ficha.
          </>
        )}
      </p>
    </div>
  );
}
