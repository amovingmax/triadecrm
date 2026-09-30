'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatarLocal } from '@/components/parceiros/formatos';
import { useRevelarLinha } from '@/components/movimento';
import { EtiquetaEtapa } from '@/components/funis/etapa';

import { formatarQuando, quandoEmTexto } from './formatos';
import { ICONE_DO_ITEM, iconeDoItem } from './icones';
import { destinoDoItem, type ItemDoDia } from './tipos';

/**
 * Uma linha da fila. É a unidade que a Heloísa lê com o polegar, na rua, e o desenho
 * responde a três perguntas nessa ordem: com QUEM, o QUE fazer, e PARA QUANDO.
 *
 *   barra esquerda  nenhuma: a barra térmica saiu em 28/09/2026 (ADR-16)
 *   linha 1         nome do parceiro           · à direita, o prazo em IBM Plex Mono
 *   linha 2         a ação: título da tarefa ou a próxima ação combinada
 *   linha 3         o motivo, quando ele diz algo que as outras linhas não dizem
 *   linha 4         etapa, bairro e categoria
 *
 * O item inteiro é o alvo de toque — 76px de altura mínima, bem acima dos 44px —, e
 * o destino muda com o motivo: quem está sem resultado registrado vai para o
 * Registrar contato, quem está sem próxima ação ou parado vai para o funil, e o
 * resto vai para a ficha. Mandar tudo para o mesmo lugar transformaria a fila num
 * índice, e o trabalho continuaria a dois toques de distância.
 *
 * Interação sem alvo resolvido (acontece quando a atividade não tem organização nem
 * negócio) não vira link: não há para onde ir, e um link morto é pior que texto.
 *
 * No dia de outra pessoa (`somenteLeitura`), toda linha leva à ficha: registrar ou
 * mover dali gravaria no nome de quem está olhando.
 */
export function ItemDaFila({
  item,
  indice,
  somenteLeitura = false,
}: {
  item: ItemDoDia;
  indice: number;
  /** Dia de outra pessoa: a linha leva só à ficha (ver `destinoDoItem`). */
  somenteLeitura?: boolean;
}) {
  const revelar = useRevelarLinha(indice);
  const destino = destinoDoItem(item, { somenteLeitura });
  const quando = formatarQuando(item);

  const nome = item.organizacao ?? item.titulo;
  // O AVISO DO SISTEMA não tem parceiro: o título dele JÁ é a linha de cima.
  // Sem esta condição, "Dead-letter ai_dlq: 1 mensagem morreu" aparecia duas
  // vezes, uma embaixo da outra, em toda linha sem organização.
  const acao = item.organizacao && item.titulo !== item.organizacao ? item.titulo : null;
  // MOSTRAR O MOTIVO NÃO É A MESMA COISA QUE ESCONDER A ETAPA. Eram uma variável
  // só porque, nos três motivos antigos, o motivo já NOMEAVA a etapa ("parado na
  // etapa Contatado") e repeti-la gastava a largura do nome. O motivo da conversa
  // não nomeia etapa nenhuma: ele conta quanto falta da janela de 24 h — o único
  // dado da linha que a pessoa não deduz, e o que separa "responda hoje" de
  // "responda agora". Os dois têm de caber juntos.
  const motivoNomeiaEtapa =
    item.tipo === 'sem_proxima_acao' ||
    item.tipo === 'negocio_parado' ||
    item.tipo === 'desfecho_pendente';
  // E o motivo só entra quando diz algo que as duas linhas acima não disseram.
  const mostrarMotivo = motivoNomeiaEtapa || item.tipo === 'conversa_esperando' || !acao;
  const motivoCru = mostrarMotivo ? item.motivo : null;
  const motivo = motivoCru && motivoCru !== nome && motivoCru !== acao ? motivoCru : null;
  const local = formatarLocal(item.bairro, null);

  const Icone = ICONE_DO_ITEM[iconeDoItem(item)];

  const miolo = (
    <>
      {/* O ÍCONE DO MOTIVO: reunião, tarefa, próxima ação, negócio parado. Ele diz
          antes da leitura o que aquela linha é — e quando o prazo já venceu, ele
          veste o tom de alerta, que é o único lugar da fila onde a cor significa
          urgência. */}
      <span
        aria-hidden="true"
        className={cn(
          // `bg-card` e não `bg-muted`: a linha agora É muted, e um disco muted
          // sobre linha muted é um disco invisível. O branco do cartão recorta.
          'mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full',
          quando.atencao
            ? 'bg-destructive/15 text-destructive-texto'
            : 'bg-card text-muted-foreground',
        )}
      >
        <Icone className="size-4.5" />
      </span>

      {/* Em tela larga, quem é o parceiro fica à esquerda e o CONTEXTO (etapa,
          bairro, categoria) vai para a direita, antes do prazo: a linha
          ocupava um terço da largura e deixava metade da tela vazia, com três
          andares de texto amontoados na margem esquerda. No celular ele volta a
          empilhar, que é onde empilhar faz sentido. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 md:flex-row md:items-center md:gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{nome}</p>
          {acao ? <p className="truncate text-[0.8125rem]">{acao}</p> : null}
          {motivo ? <p className="text-xs text-muted-foreground">{motivo}</p> : null}
        </div>

        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:mt-0 md:max-w-[45%] md:shrink-0 md:justify-end">
          {/* A ETAPA NO LUGAR DA TEMPERATURA (28/09/2026, ADR-16), e agora em
              etiqueta: ela era a palavra mais apagada da linha e passou a ser o
              dado que decide. Continua saindo quando o motivo já a nomeou —
              repetir "Prospectado" duas vezes na mesma linha só gasta a largura
              que o nome precisa. */}
          {/* A QUEM A CONVERSA APONTA (28/09/2026, ADR-17). A fila de quem
              respondeu deixou de ser filtrada por dono, então a linha pode ser
              de outra pessoa — e esconder isso seria mentir por omissão. O banco
              só manda o nome quando ele ACRESCENTA: na minha própria fila a
              coluna vem nula, porque "endereçada a mim" em toda linha é um
              rótulo que a pessoa aprende a não ler. Não é um aviso para parar:
              quem responde primeiro tira a conversa da fila de todos. */}
          {item.atendente ? (
            <span className="truncate">Endereçada a {item.atendente}</span>
          ) : null}
          {item.etapa && !motivoNomeiaEtapa ? <EtiquetaEtapa etapa={item.etapa} /> : null}
          {local ? <span className="truncate">{local}</span> : null}
          {item.categoria ? <span className="truncate">{item.categoria}</span> : null}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 pt-1">
        {/* O prazo vencido vira pastilha: "há 6 d" em cinza, no fim de uma linha
            cinza, era a informação mais urgente da tela escrita no tom mais baixo. */}
        <span
          title={quando.detalhe}
          className={cn(
            'inline-flex items-center rounded-full whitespace-nowrap',
            quando.atencao
              ? 'bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive-texto'
              : 'text-xs text-muted-foreground',
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
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
      </div>
    </>
  );

  // A linha virou CARTÃO: cantos arredondados, fundo no hover e um respiro entre
  // uma e outra, no lugar do filete cinza que ligava tudo num bloco só de texto.
  //
  // 29/09/2026 (Tríade Design System): o fundo deixou de ser só no hover. O
  // sistema desenha a linha dentro do cartão como uma SUPERFÍCIE própria — cinza
  // de 16px sobre o branco —, e é o que faz a fila parecer uma lista de coisas
  // em vez de texto empilhado. O raio desce de 24 para 16: 24px é o cartão que
  // contém, 16px é a linha que mora dentro dele.
  const molde =
    'relative flex min-h-[72px] items-start gap-3 rounded-lg bg-muted/45 py-3 pr-3 pl-3.5 transition-colors';

  return (
    <li {...revelar} className={revelar.className}>
      {destino ? (
        <Link
          href={destino.href}
          className={cn(
            molde,
            'outline-none active:bg-muted focus-visible:bg-muted md:hover:bg-muted',
          )}
        >
          {miolo}
          {/* Sem `aria-label` no link: um rótulo aqui APAGARIA todo o conteúdo da
              linha para quem usa leitor de tela (etapa, motivo, prazo). O
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
