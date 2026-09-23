'use client';

import { useEffect, useRef } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Etiqueta } from '@/components/etiqueta';
import { BarraTermica, DiasSemContato } from '@/components/temperatura';

import { local } from './formatos';
import { ICONE_CANAL } from './icones';
import { ChipDaJanela } from './janela-24h';
import { estadoDaJanela } from './mensagens';
import { ROTULO_CANAL, type ItemConversa } from './tipos';

/**
 * A lista da esquerda: um parceiro por linha, o que falou por último em cima.
 *
 * É a mesma gramática da lista de Parceiros — barra térmica na borda, nome, e os dias
 * sem contato em mono à direita —, porque é a mesma pessoa lendo as duas telas. O que
 * muda é a segunda linha: aqui ela é a PRÉVIA da conversa (o desfecho da última
 * interação, com o ícone do canal), que é o que faz alguém decidir em qual parceiro
 * tocar.
 *
 * Cada item é um `<button>`, não um link: a conversa abre ao lado, na mesma tela, e o
 * endereço acompanha por `replaceState` (ver `tela-conversas.tsx`). O alvo tem 76px de
 * altura, bem acima dos 44px mínimos, e o item selecionado leva `aria-current`.
 */
/** Abaixo disto a nota da IA não muda decisão nenhuma, e vira ruído na linha. */
const NOTA_QUE_VALE = 50;

export function ListaConversas({
  itens,
  selecionadoId,
  aoEscolher,
}: {
  itens: ItemConversa[];
  selecionadoId: string | null;
  aoEscolher: (id: string) => void;
}) {
  return (
    <ul className="corpo-tabela flex flex-col">
      {itens.map((item) => (
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
  const Icone = item.ultimoCanal ? ICONE_CANAL[item.ultimoCanal] : null;
  const onde = local(item.bairro, item.cidade);
  const rodape = [onde, item.categoria].filter(Boolean).join(' · ');
  const alvo = useRef<HTMLLIElement>(null);
  // O relógio da janela na linha da lista NÃO anda: ele é lido uma vez por
  // repintura da lista. Cem linhas com um `setInterval` cada é bateria da
  // Heloísa indo embora para mudar um "3 h" em "2 h" que ninguém está olhando.
  const janela = estadoDaJanela(item.fio?.janelaExpiraEm ?? null);

  // Um link com `?org=` pode apontar para o quinquagésimo parceiro da lista. Sem isto,
  // a conversa abre à direita e a lista continua no topo, sem nenhuma linha acesa: a
  // pessoa não vê onde está. Sincronizar o DOM com o estado é exatamente para o que
  // serve um efeito, e `block: 'nearest'` não mexe na lista quando o item já está à vista.
  useEffect(() => {
    if (selecionado) alvo.current?.scrollIntoView({ block: 'nearest' });
  }, [selecionado]);

  return (
    <li ref={alvo} className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={() => aoEscolher(item.id)}
        aria-current={selecionado ? 'true' : undefined}
        // Bairro e categoria saíram da terceira linha e vivem aqui: são consulta de
        // canto de olho, e custavam 40 px por linha — metade da lista visível.
        title={rodape || undefined}
        className={cn(
          'relative flex min-h-[4rem] w-full items-center gap-3 py-2.5 pr-3 pl-4 text-left outline-none',
          'hover:bg-muted/50 focus-visible:bg-muted/60',
          selecionado && 'bg-muted',
        )}
      >
        <BarraTermica
          temperatura={item.temperatura}
          needsAttention={item.precisaAtencao}
          posicao="absoluta"
          semRotulo
        />

        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm',
                item.naoLidas > 0 ? 'font-semibold' : 'font-medium',
              )}
            >
              {item.nome}
            </span>
            {/* Por ler vai no verde da ação, e não no branco: é o único número da
                linha que pede para alguém fazer alguma coisa. */}
            {item.naoLidas > 0 ? (
              <span
                className="numerico inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                title={`${item.naoLidas} mensagem(ns) por ler`}
              >
                {item.naoLidas}
              </span>
            ) : null}
            <DiasSemContato
              dias={item.diasSemContato}
              atencao={item.precisaAtencao}
              curto
              className="shrink-0"
            />
          </span>

          {/* O QUE ACONTECEU, primeiro. A prévia da última interação é o fato; o
              conselho da IA, logo abaixo, é opinião. Estavam trocados de ordem, e
              a linha inteira lia como se a máquina falasse pelo parceiro. */}
          <span className="flex items-center gap-1.5">
            {Icone ? (
              <Icone
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label={item.ultimoCanal ? ROTULO_CANAL[item.ultimoCanal] : undefined}
              />
            ) : null}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-xs',
                item.resumo ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {item.resumo ?? 'Nenhum contato registrado'}
            </span>
            {item.naoContatar ? (
              <Badge variant="pilula" className="h-4 shrink-0 px-1.5 text-[10px] font-normal">
                não contatar
              </Badge>
            ) : null}
            {/* O rascunho pendente é o que faz alguém abrir esta linha AGORA: ele
                expira em três dias e some sozinho. */}
            {item.rascunhoPendente ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline px-1.5 text-[10px]">
                <Sparkles className="size-2.5" aria-hidden="true" />
                aprovar
              </span>
            ) : null}
            <ChipDaJanela estado={janela} />
          </span>

          {/* AS ETIQUETAS, com a cor que o gestor escolheu: é o que separa um
              fundador de um contato qualquer antes de abrir a conversa. Duas, e o
              resto em número — quatro pílulas comiam a largura da prévia. */}
          {item.etiquetas.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1">
              {item.etiquetas.slice(0, 2).map((e) => (
                <Etiqueta key={e.id} nome={e.nome} cor={e.cor} className="h-4 px-1.5 text-[10px]" />
              ))}
              {item.etiquetas.length > 2 ? (
                <span className="numerico text-[10px] text-muted-foreground">
                  +{item.etiquetas.length - 2}
                </span>
              ) : null}
            </span>
          ) : null}

          {/* O CONSELHO DA IA, quando existe: "Recontatar em 3-5 dias com abordagem
              diferente". Sem itálico — em 11 px o itálico só atrapalha a leitura —,
              e com o ícone dizendo de onde vem. A nota de intenção (0 a 100) só
              aparece quando é alta: "15" solto na linha não decide nada. */}
          {item.leituraDaIa?.proximaAcao ? (
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {item.leituraDaIa.proximaAcao}
              </span>
              {(item.leituraDaIa.score ?? 0) >= NOTA_QUE_VALE ? (
                <span
                  className="numerico shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground"
                  title={`A IA vê ${item.leituraDaIa.score} de 100 de intenção de fechar nesta conversa`}
                >
                  IA {item.leituraDaIa.score}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>

        {/* Só no celular: lá a lista dá lugar à conversa numa tela nova, e o chevron é
            o que diz que aquele toque leva para outro lugar. No desktop a conversa
            abre ao lado e o estado selecionado já é o sinal. */}
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground md:hidden"
          aria-hidden="true"
        />
      </button>
    </li>
  );
}
