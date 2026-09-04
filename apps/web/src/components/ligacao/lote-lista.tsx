'use client';

/**
 * A lista de lotes: o que está de pé, de quem é, e como foi (R13 §3.1).
 *
 * ---------------------------------------------------------------------------
 * Por que a lista mostra os lotes dos outros
 * ---------------------------------------------------------------------------
 * São duas pessoas ligando da mesma base de 100 organizações. O lote da Heloísa
 * segura os contatos dele — eles somem da montagem do Matheus, e a prévia diz
 * "reservado em outro lote". Esconder o lote alheio deixaria essa subtração sem
 * explicação. Por isso todo lote visível aparece, com o nome de quem montou, e só o
 * dono vê as ações de encerrar.
 *
 * ---------------------------------------------------------------------------
 * Encerrar não é apagar
 * ---------------------------------------------------------------------------
 * Enquanto um lote está ativo, quem sobrou na fila dele continua reservado e ninguém
 * mais liga para aquele buffet. Encerrar é a única forma de devolver essa gente à
 * base — quem devolve é o gatilho `call_batches_on_close`, não esta tela. Por isso a
 * confirmação diz o número: "devolve 7 contatos à base" é uma consequência; "tem
 * certeza?" é uma pergunta sem informação.
 */
import { useState } from 'react';
import Link from 'next/link';
import { PhoneOutgoing, SquareCheckBig } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ChipTemperatura } from '@/components/temperatura';

import { type LoteNaLista } from './consultas';
import { BarraDaFila, NumerosDoLote } from './fila-progresso';
import { ROTULOS_ORDEM, ROTULOS_STATUS_LOTE, type StatusDoLote } from './tipos';

const TOM_DO_STATUS: Record<StatusDoLote, 'default' | 'secondary' | 'outline' | 'pilula'> = {
  rascunho: 'outline',
  ativo: 'default',
  pausado: 'secondary',
  encerrado: 'pilula',
};

/** `YYYY-MM-DD` em dia e mês curtos, sem fuso: a string já é o dia civil de Fortaleza. */
function diaCurto(dia: string): string {
  const [ano, mes, resto] = dia.split('-');
  if (!ano || !mes || !resto) return dia;
  return `${resto}/${mes}`;
}

/**
 * Nome do roteiro com a versão, sem dizer a versão duas vezes.
 *
 * O roteiro da seed se chama "Captação por ligação — v1", e o lote congela
 * `script_version = 1`: escrever os dois viraria "Captação por ligação — v1 v1". Quando
 * o nome já termina na versão congelada, ele basta.
 */
function nomeDoRoteiro(lote: LoteNaLista): string {
  const versao = `v${lote.roteiroVersao}`;
  return lote.roteiro.trim().toLowerCase().endsWith(versao)
    ? lote.roteiro
    : `${lote.roteiro} ${versao}`;
}

function periodoDoLote(lote: LoteNaLista): string {
  return lote.iniciaEm === lote.terminaEm
    ? diaCurto(lote.iniciaEm)
    : `${diaCurto(lote.iniciaEm)} a ${diaCurto(lote.terminaEm)}`;
}

export function CartaoDoLote({
  lote,
  aoEncerrar,
  encerrando,
}: {
  lote: LoteNaLista;
  aoEncerrar: (lote: LoteNaLista) => void;
  encerrando: boolean;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const aberto = lote.status === 'ativo' || lote.status === 'pausado';
  const podeEncerrar = aberto && lote.ehMeu;

  return (
    <article
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4',
        lote.status === 'encerrado' && 'opacity-70',
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-heading truncate font-medium">{lote.nome}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {lote.funil} · {lote.dono}
            {lote.ehMeu ? ' (você)' : ''} · {periodoDoLote(lote)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ChipTemperatura temperatura={lote.temperaturaOrigem} />
          <Badge variant={TOM_DO_STATUS[lote.status]}>{ROTULOS_STATUS_LOTE[lote.status]}</Badge>
        </div>
      </header>

      <BarraDaFila feitos={lote.feitos} total={lote.total} />

      <NumerosDoLote
        numeros={{
          total: lote.total,
          faltam: lote.faltam,
          feitos: lote.feitos,
          atenderam: lote.atenderam,
          reunioes: lote.reunioes,
          meta: lote.metaLigacoes,
        }}
      />

      <p className="text-xs text-muted-foreground">
        Roteiro {nomeDoRoteiro(lote)} · {ROTULOS_ORDEM[lote.ordem].toLowerCase()} · até{' '}
        <span className="numerico">{lote.maxTentativas}</span> tentativas por número
      </p>

      <footer className="flex flex-wrap items-center gap-2 border-t pt-3">
        {aberto && lote.faltam > 0 ? (
          <Button asChild className="toque h-11 md:h-9">
            <Link href={`/ligar/${lote.id}`}>
              <PhoneOutgoing aria-hidden="true" />
              Abrir e ligar
            </Link>
          </Button>
        ) : null}

        {aberto && lote.faltam === 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <SquareCheckBig aria-hidden="true" className="size-4" />
            Fila zerada. Pode encerrar.
          </p>
        ) : null}

        {podeEncerrar ? (
          <Button
            variant="outline"
            className="toque h-11 md:h-9"
            onClick={() => setConfirmando(true)}
            disabled={encerrando}
          >
            {encerrando ? 'Encerrando...' : 'Encerrar'}
          </Button>
        ) : null}
      </footer>

      <Dialog open={confirmando} onOpenChange={setConfirmando}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Encerrar “{lote.nome}”?</DialogTitle>
            <DialogDescription>
              {lote.faltam > 0 ? (
                <>
                  Os <span className="numerico">{lote.faltam}</span> que ainda estão na fila voltam
                  para a base e podem entrar em outro lote. O que já foi tabulado continua
                  registrado.
                </>
              ) : (
                'A fila já está vazia. Encerrar só marca o lote como fechado; nada do que foi tabulado se perde.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="toque h-11 md:h-9">
                Deixar aberto
              </Button>
            </DialogClose>
            <Button
              className="toque h-11 md:h-9"
              onClick={() => {
                setConfirmando(false);
                aoEncerrar(lote);
              }}
            >
              Encerrar lote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

export function ListaDeLotes({
  lotes,
  aoEncerrar,
  encerrandoId,
}: {
  lotes: readonly LoteNaLista[];
  aoEncerrar: (lote: LoteNaLista) => void;
  encerrandoId: string | null;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {lotes.map((lote) => (
        <CartaoDoLote
          key={lote.id}
          lote={lote}
          aoEncerrar={aoEncerrar}
          encerrando={encerrandoId === lote.id}
        />
      ))}
    </div>
  );
}
