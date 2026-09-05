'use client';

import { ChevronRight, Inbox, ShieldAlert, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

import { dataHoraCompleta, rotuloDoDia } from './formatos';
import {
  fichaDaIntencao,
  ordenarFila,
  ROTULO_INTENCAO,
  tempoCurto,
  validadorApitou,
} from './mensagens';
import { ROTULO_TIPO_RASCUNHO, type ItemConversa } from './tipos';

/**
 * A fila de aprovação: tudo que a IA escreveu e ninguém leu, de todos os
 * parceiros, na ordem de quem some primeiro.
 *
 * ===========================================================================
 * POR QUE ELA É UMA LISTA SEPARADA
 * ===========================================================================
 * O ADR-05 diz que a pessoa aprova. Uma fila de aprovação escondida dentro de
 * cem parceiros ordenados por recência é uma fila que ninguém trabalha: o
 * rascunho nasce, vive três dias e expira sem que ninguém o tenha visto — e o
 * `rascunhos_expirar` do cron apaga a evidência de que ele existiu. A aba separa
 * a pergunta "com quem eu falo agora?" da pergunta "o que está esperando por
 * mim?", que é a pergunta da Heloísa parada no ponto de ônibus.
 *
 * A ORDEM é por expiração, não por chegada: o que vence hoje à noite é o que
 * some se ninguém olhar. E cada linha já mostra as duas coisas que decidem se
 * vale abrir — a intenção que a IA entendeu e se o validador apitou —, para não
 * ser preciso abrir cinco conversas só para descobrir qual tem problema.
 */
export function FilaDeAprovacao({
  itens,
  selecionadoId,
  aoEscolher,
}: {
  /** Só os que têm rascunho pendente; a filtragem é de quem chama. */
  itens: ItemConversa[];
  selecionadoId: string | null;
  aoEscolher: (id: string) => void;
}) {
  const emOrdem = [...itens].sort((a, b) => {
    const [na] = ordenarFila(a.rascunhoPendente ? [a.rascunhoPendente] : []);
    const [nb] = ordenarFila(b.rascunhoPendente ? [b.rascunhoPendente] : []);
    if (!na) return 1;
    if (!nb) return -1;
    return na.expiraEm.localeCompare(nb.expiraEm);
  });

  return (
    <ul className="corpo-tabela flex flex-col">
      {emOrdem.map((item) => (
        <Linha
          key={item.id}
          item={item}
          selecionado={item.id === selecionadoId}
          aoEscolher={aoEscolher}
        />
      ))}
    </ul>
  );
}

function Linha({
  item,
  selecionado,
  aoEscolher,
}: {
  item: ItemConversa;
  selecionado: boolean;
  aoEscolher: (id: string) => void;
}) {
  const rascunho = item.rascunhoPendente;
  if (!rascunho) return null;

  const ficha = fichaDaIntencao(item.fio?.intencao ?? null);
  const apitou = validadorApitou(rascunho.validador);
  const some = rotuloDoDia(rascunho.expiraEm);

  return (
    <li className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={() => aoEscolher(item.id)}
        aria-current={selecionado ? 'true' : undefined}
        className={cn(
          'flex min-h-[4.75rem] w-full items-center gap-3 py-3 pr-3 pl-4 text-left outline-none',
          'hover:bg-muted/50 focus-visible:bg-muted/60',
          selecionado && 'bg-muted',
        )}
      >
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-center gap-2">
            <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.nome}</span>
            <span
              className="shrink-0 text-[11px] text-muted-foreground"
              title={`Some em ${dataHoraCompleta(rascunho.expiraEm)}`}
            >
              some {some.palavra}
              {some.numero ? <span className="numerico">{some.numero}</span> : null}
            </span>
          </span>

          <span className="line-clamp-2 block text-xs text-muted-foreground">
            {rascunho.proposto}
          </span>

          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="pilula" className="h-5 shrink-0 px-1.5 text-[10px] font-normal">
              {ROTULO_TIPO_RASCUNHO[rascunho.tipo]}
            </Badge>
            {ficha ? (
              <span className="truncate text-[11px] text-muted-foreground">
                {ROTULO_INTENCAO[ficha.intencao]}
              </span>
            ) : null}
            {apitou ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px]">
                <ShieldAlert className="size-3" aria-hidden="true" />
                validador apitou
              </span>
            ) : null}
          </span>
        </span>

        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Ninguém escreveu nada para aprovar — que hoje é o estado normal. */
export function FilaVazia({ temFio }: { temFio: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Inbox className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="font-heading font-medium">Nada esperando aprovação</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {temFio
            ? 'Quando a IA redigir uma resposta ou um follow-up, ele aparece aqui antes de sair — e só sai depois que alguém aprovar (ADR-05).'
            : 'A IA redige a partir do que o parceiro escreve, e ninguém escreveu ainda. Enquanto o número não for aprovado na Meta, essa fila fica vazia mesmo.'}
        </p>
      </div>
    </div>
  );
}

/** O contador da aba: quantos rascunhos e quantos deles o validador barrou. */
export function contarFila(itens: ItemConversa[]): { total: number; comAviso: number } {
  const pendentes = itens.map((i) => i.rascunhoPendente).filter((r) => r !== null);
  return {
    total: pendentes.length,
    comAviso: pendentes.filter((r) => validadorApitou(r.validador)).length,
  };
}

/** "3 h" até o rascunho mais próximo de expirar; `null` quando a fila está vazia. */
export function tempoDoMaisUrgente(
  itens: ItemConversa[],
  agora: Date = new Date(),
): { numero: string; unidade: string } | null {
  const pendentes = ordenarFila(itens.map((i) => i.rascunhoPendente).filter((r) => r !== null));
  const primeiro = pendentes[0];
  if (!primeiro) return null;
  const minutos = Math.floor((new Date(primeiro.expiraEm).getTime() - agora.getTime()) / 60_000);
  return tempoCurto(Math.max(0, minutos));
}
