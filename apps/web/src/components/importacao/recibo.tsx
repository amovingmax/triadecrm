'use client';

import { useState } from 'react';
import { ArrowRight, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatarDataHora, formatarNumero } from '@/components/parceiros/formatos';

import { desfazerLote, mensagemDoErro } from './dados';
import { ORDEM_DAS_DECISOES, ROTULO_DECISAO, type Recibo as TipoRecibo } from './tipos';

/**
 * O que aconteceu, depois de gravar.
 *
 * Duas coisas importam aqui e nenhuma delas é a comemoração: para onde ir agora
 * (a fila do Radar, quando sobrou algo para decidir) e como voltar atrás. O
 * desfazer é do RF-BAS-17 e vale 48 h; ele não desfaz cegamente — o banco só
 * remove o que o lote criou e ninguém tocou, e conta quantas fichas ficaram de pé.
 */
export function Recibo({
  recibo,
  aoRecomecar,
  aoDesfazer,
}: {
  recibo: TipoRecibo;
  aoRecomecar: () => void;
  aoDesfazer: () => void;
}) {
  const [desfazendo, setDesfazendo] = useState(false);
  const paraRevisar = (recibo.contagem.duplicata ?? 0) + (recibo.contagem.revisao ?? 0);

  const desfazer = async () => {
    setDesfazendo(true);
    try {
      const r = await desfazerLote(recibo.loteId);
      if (r.jaEstava) {
        toast.info('Esse lote já tinha sido desfeito.');
      } else {
        toast.success(
          `${formatarNumero(r.organizacoes)} ${r.organizacoes === 1 ? 'ficha removida' : 'fichas removidas'}.` +
            (r.preservadas > 0
              ? ` ${formatarNumero(r.preservadas)} ${r.preservadas === 1 ? 'ficou' : 'ficaram'} de pé porque alguém já trabalhou.`
              : ''),
        );
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

        {paraRevisar > 0 ? (
          <Button asChild variant="outline" className="toque h-11 md:h-9">
            <Link href="/radar">
              Decidir as {formatarNumero(paraRevisar)} que ficaram na fila
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : null}

        <Button variant="ghost" onClick={aoRecomecar} className="toque h-11 md:h-9">
          Importar outra planilha
        </Button>

        <Button
          variant="destructive"
          disabled={desfazendo}
          onClick={() => void desfazer()}
          className="toque h-11 md:h-9"
        >
          <Undo2 aria-hidden="true" />
          {desfazendo ? 'Desfazendo...' : 'Desfazer este lote'}
        </Button>
      </div>

      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        O desfazer remove só o que este lote criou e ninguém tocou ainda. Ficha com atividade
        humana, mudança de etapa, consentimento ou ligação registrada continua de pé, e o CRM diz
        quantas foram.
      </p>
    </div>
  );
}
