'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatarLocal } from '@/components/parceiros/formatos';
import { useRevelarLinha } from '@/components/movimento';
import { BarraTermica, ChipTemperatura } from '@/components/temperatura';

import { formatarQuando, quandoEmTexto } from './formatos';
import { destinoDoItem, type ItemDoDia } from './tipos';

/**
 * Uma linha da fila. É a unidade que a Heloísa lê com o polegar, na rua, e o desenho
 * responde a três perguntas nessa ordem: com QUEM, o QUE fazer, e PARA QUANDO.
 *
 *   barra esquerda  temperatura do negócio (só quando existe negócio)
 *   linha 1         nome do parceiro           · à direita, o prazo em IBM Plex Mono
 *   linha 2         a ação: título da tarefa ou a próxima ação combinada
 *   linha 3         o motivo, quando ele diz algo que as outras linhas não dizem
 *   linha 4         temperatura escrita, etapa e bairro
 *
 * O item inteiro é o alvo de toque — 76px de altura mínima, bem acima dos 44px —, e
 * o destino muda com o motivo: quem está sem resultado registrado vai para o
 * Registrar contato, quem está sem próxima ação ou parado vai para o funil, e o
 * resto vai para a ficha. Mandar tudo para o mesmo lugar transformaria a fila num
 * índice, e o trabalho continuaria a dois toques de distância.
 *
 * Interação sem alvo resolvido (acontece quando a atividade não tem organização nem
 * negócio) não vira link: não há para onde ir, e um link morto é pior que texto.
 */
export function ItemDaFila({ item, indice }: { item: ItemDoDia; indice: number }) {
  const revelar = useRevelarLinha(indice);
  const destino = destinoDoItem(item);
  const quando = formatarQuando(item);

  const nome = item.organizacao ?? item.titulo;
  const acao = item.titulo !== item.organizacao ? item.titulo : null;
  // Nesses três motivos a explicação do banco carrega o que a linha não tem em
  // lugar nenhum (a etapa em que empacou, o SLA, o que ficou faltando dizer).
  const explicar =
    item.tipo === 'sem_proxima_acao' ||
    item.tipo === 'negocio_parado' ||
    item.tipo === 'desfecho_pendente';
  const motivo = explicar || !acao ? item.motivo : null;
  const local = formatarLocal(item.bairro, null);

  const miolo = (
    <>
      {item.temperatura ? (
        <BarraTermica temperatura={item.temperatura} posicao="absoluta" semRotulo />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate font-medium">{nome}</p>
        {acao ? <p className="truncate text-[0.8125rem]">{acao}</p> : null}
        {motivo ? <p className="text-xs text-muted-foreground">{motivo}</p> : null}

        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {item.temperatura ? (
            <ChipTemperatura temperatura={item.temperatura} comDescricao={false} />
          ) : null}
          {/* A etapa sai daqui quando o motivo já a nomeou: repetir "Prospectado"
              duas vezes na mesma linha só gasta a largura que o nome precisa. */}
          {item.etapa && !explicar ? <span className="truncate">{item.etapa}</span> : null}
          {local ? <span className="truncate">{local}</span> : null}
          {item.categoria ? <span className="truncate">{item.categoria}</span> : null}
        </p>
      </div>

      <div className="flex shrink-0 items-start gap-0.5 pt-0.5">
        <span
          title={quando.detalhe}
          className={cn(
            'whitespace-nowrap',
            quando.atencao ? 'font-medium text-foreground' : 'text-muted-foreground',
            quando.numero && !quando.prefixo && !quando.sufixo ? 'text-sm' : 'text-xs',
          )}
        >
          <span aria-hidden="true">
            {quando.prefixo}
            {quando.numero ? <span className="numerico">{quando.numero}</span> : null}
            {quando.sufixo}
          </span>
          <span className="sr-only">{`${quandoEmTexto(quando)}. ${quando.detalhe}`}</span>
        </span>
        {destino ? (
          <ChevronRight
            className="mt-px size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
      </div>
    </>
  );

  const molde = 'relative flex min-h-[76px] items-start gap-3 py-3 pr-3 pl-4';

  return (
    <li {...revelar} className={cn('border-b border-hairline last:border-b-0', revelar.className)}>
      {destino ? (
        <Link
          href={destino.href}
          className={cn(
            molde,
            'outline-none active:bg-muted/60 focus-visible:bg-muted/60 md:hover:bg-muted/40',
          )}
        >
          {miolo}
          {/* Sem `aria-label` no link: um rótulo aqui APAGARIA todo o conteúdo da
              linha para quem usa leitor de tela (temperatura, motivo, prazo). O
              destino entra como um acréscimo no fim, depois do que já foi lido. */}
          <span className="sr-only">Abrir {destino.onde}.</span>
        </Link>
      ) : (
        <div className={molde}>
          {miolo}
          <span className="sr-only">Sem parceiro ligado: não há para onde abrir.</span>
        </div>
      )}
    </li>
  );
}
