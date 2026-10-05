'use client';

import { useEffect, useRef } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';

import { FaixaDeNova, MarcaDeNova } from '@/components/avisos/marca-de-nova';
import { useConversasNovas } from '@/components/avisos/provedor-avisos';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Etiqueta } from '@/components/etiqueta';
import { EtiquetaEtapa } from '@/components/funis/etapa';
import { DiasSemContato } from '@/components/temperatura';

import { finalDoNumero } from './fora-da-base-dados';
import { local, rotuloDoDia } from './formatos';
import { ICONE_CANAL } from './icones';
import { ChipDaJanela } from './janela-24h';
import { estadoDaJanela, type FioCru } from './mensagens';
import { juntarNaLista } from './montagem';
import { previaDoDigitado, useTextosDigitados } from './texto-digitado';
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
 *
 * QUEM NÃO É PARCEIRO TAMBÉM APARECE AQUI (01/10/2026), quando a tela passa
 * `clientes`: a lista "Todas" que só mostrava parceiros escondia a mensagem do
 * cliente atrás de outra aba. A linha dele é a mesma gramática, com menos coisa:
 * nome do WhatsApp, por ler, o dia, e "cliente" onde o parceiro tem a etapa.
 *
 * A MARCA "NOVA" (02/10/2026): a conversa com mensagem que ninguém do time
 * respondeu leva a faixa e o selo em menta, e perde os dois quando sai a
 * resposta — abrir só para ler não tira (05/10/2026). Quem
 * sabe quais são é a casca (`components/avisos`), a mesma que põe o número ao
 * lado de Conversas — por isso os dois andam juntos: cinco marcadas, número 5.
 *
 * "RASCUNHO:" NA LINHA (02/10/2026): quem começou a escrever numa conversa e
 * saiu dela vê, no lugar da prévia, "Rascunho:" e o começo do que digitou —
 * como no WhatsApp. É o texto da PESSOA (`texto-digitado.ts`), não o rascunho da
 * IA, que continua sendo o selo "aprovar". A conversa aberta não mostra: o texto
 * dela já está à vista, na caixa.
 */
/** Abaixo disto a nota da IA não muda decisão nenhuma, e vira ruído na linha. */
const NOTA_QUE_VALE = 50;

export function ListaConversas({
  itens,
  selecionadoId,
  aoEscolher,
  clientes = [],
  clienteSelecionadoId = null,
  aoEscolherCliente,
}: {
  itens: ItemConversa[];
  selecionadoId: string | null;
  aoEscolher: (id: string) => void;
  /** Quem escreveu e não é ficha. Só a lista de Conversas passa; as filas, não. */
  clientes?: FioCru[];
  /** O id da CONVERSA do cliente aberto — ele não tem ficha. */
  clienteSelecionadoId?: string | null;
  aoEscolherCliente?: (conversaId: string) => void;
}) {
  const novas = useConversasNovas();
  const digitados = useTextosDigitados();
  /** O que a linha mostra depois de "Rascunho:", ou `null`. */
  const rascunhoDe = (fioId: string | null | undefined, selecionado: boolean): string | null =>
    selecionado || !fioId ? null : previaDoDigitado(digitados.get(fioId)?.texto);
  return (
    <ul className="corpo-tabela flex flex-col">
      {juntarNaLista(itens, clientes).map((linha) =>
        linha.tipo === 'parceiro' ? (
          <Linha
            key={linha.item.id}
            item={linha.item}
            selecionado={linha.item.id === selecionadoId}
            nova={linha.item.fio ? novas.has(linha.item.fio.id) : false}
            rascunho={rascunhoDe(linha.item.fio?.id, linha.item.id === selecionadoId)}
            aoEscolher={aoEscolher}
          />
        ) : (
          <LinhaDeCliente
            key={linha.fio.id}
            fio={linha.fio}
            selecionado={linha.fio.id === clienteSelecionadoId}
            nova={novas.has(linha.fio.id)}
            rascunho={rascunhoDe(linha.fio.id, linha.fio.id === clienteSelecionadoId)}
            aoEscolher={aoEscolherCliente}
          />
        ),
      )}
    </ul>
  );
}

/**
 * "Rascunho: É assim que deveri…": o que a pessoa digitou e não enviou, no lugar
 * da prévia da linha. O rótulo vai na tinta de texto da menta (`menta-texto`),
 * e não na menta cheia — a cheia é clara demais para ser lida como letra.
 */
export function PreviaDoRascunho({ texto, className }: { texto: string; className?: string }) {
  return (
    <span className={cn('min-w-0 flex-1 truncate text-xs', className)}>
      <span className="font-medium text-menta-texto">Rascunho:</span>{' '}
      <span className="text-muted-foreground">{texto}</span>
    </span>
  );
}

/** "hoje", "ontem", "seg, 29/09" ou "29/09": o dia da última mensagem. */
function quando(iso: string): string {
  const dia = rotuloDoDia(iso);
  return `${dia.palavra}${dia.numero ?? ''}`;
}

/**
 * A linha de quem não é parceiro. Mesmas medidas da `Linha`, para as duas se
 * alinharem na mesma lista; o que ela não tem (etapa, bairro, etiquetas, conselho
 * da IA) simplesmente não aparece.
 */
function LinhaDeCliente({
  fio,
  selecionado,
  nova,
  rascunho,
  aoEscolher,
}: {
  fio: FioCru;
  selecionado: boolean;
  /** Tem mensagem para esta pessoa que ninguém do time respondeu ainda. */
  nova: boolean;
  /** O começo do que a pessoa digitou aqui e não enviou. */
  rascunho: string | null;
  aoEscolher?: (conversaId: string) => void;
}) {
  const Icone = ICONE_CANAL.whatsapp;
  const nome = fio.peer_nome?.trim();
  const alvo = useRef<HTMLLIElement>(null);
  const janela = estadoDaJanela(fio.window_expires_at);

  useEffect(() => {
    if (selecionado) alvo.current?.scrollIntoView({ block: 'nearest' });
  }, [selecionado]);

  return (
    <li ref={alvo} className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={() => aoEscolher?.(fio.id)}
        aria-current={selecionado ? 'true' : undefined}
        className={cn(
          'relative flex min-h-[4rem] w-full items-center gap-3 py-2.5 pr-3 pl-4 text-left outline-none',
          'hover:bg-muted/50 focus-visible:bg-muted/60',
          selecionado && 'bg-muted',
        )}
      >
        {nova ? <FaixaDeNova /> : null}
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm xl:text-[15px]',
                nova || fio.unread_count > 0 ? 'font-semibold' : 'font-medium',
              )}
            >
              {nome || `Número ${finalDoNumero(fio.peer_phone_e164)}`}
            </span>
            {nova ? <MarcaDeNova className="self-center" /> : null}
            {fio.unread_count > 0 ? (
              <span
                className="numerico inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                title={`${fio.unread_count} mensagem(ns) por ler`}
              >
                {fio.unread_count}
              </span>
            ) : null}
            {fio.last_message_at ? (
              <span className="numerico shrink-0 text-xs text-muted-foreground">
                {quando(fio.last_message_at)}
              </span>
            ) : null}
          </span>

          <span className="flex items-center gap-1.5">
            <Icone
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label={ROTULO_CANAL.whatsapp}
            />
            {rascunho ? (
              <PreviaDoRascunho texto={rascunho} />
            ) : (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {nome ? finalDoNumero(fio.peer_phone_e164) : 'sem nome no perfil'}
              </span>
            )}
            <ChipDaJanela estado={janela} />
            {/* Onde o parceiro tem a etapa, o cliente diz o que é: é esta palavra
                que explica por que a linha não tem funil nem bairro. */}
            <Badge variant="pilula" className="h-4 shrink-0 px-1.5 text-[10px] font-normal">
              cliente
            </Badge>
          </span>
        </span>

        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground md:hidden"
          aria-hidden="true"
        />
      </button>
    </li>
  );
}

function Linha({
  item,
  selecionado,
  nova,
  rascunho,
  aoEscolher,
}: {
  item: ItemConversa;
  selecionado: boolean;
  /** Tem mensagem para esta pessoa que ninguém do time respondeu ainda. */
  nova: boolean;
  /** O começo do que a pessoa digitou aqui e não enviou. */
  rascunho: string | null;
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
        {nova ? <FaixaDeNova /> : null}
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm xl:text-[15px]',
                nova || item.naoLidas > 0 ? 'font-semibold' : 'font-medium',
              )}
            >
              {item.nome}
            </span>
            {nova ? <MarcaDeNova className="self-center" /> : null}
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
            {rascunho ? (
              <PreviaDoRascunho texto={rascunho} />
            ) : (
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-xs',
                  item.resumo ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {item.resumo ?? 'Nenhum contato registrado'}
              </span>
            )}
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
            {/* A ETAPA NO LUGAR DA TEMPERATURA (28/09/2026, ADR-16). Ela vem aqui,
                na linha da prévia, e não na borda esquerda onde ficava a barra
                térmica: uma palavra diz o que uma cor não dizia — "Respondeu" e
                "Em conversa" eram o mesmo morno. */}
            <EtiquetaEtapa
              etapa={item.etapa}
              className="h-4 shrink-0 border-0 bg-transparent px-0 text-[10px] font-normal text-muted-foreground"
            />
          </span>

          {/* ONDE E O QUÊ — só onde há largura. Em 28/09/2026 a coluna passou de
              20rem para 23 (27 no xl), e o que estava escondido no `title` porque
              "custava 40 px por linha" cabe de novo: numa tela larga a lista não
              disputa mais espaço com a conversa. Em telas menores continua no
              tooltip, que é onde ele não custa altura nenhuma. */}
          {rodape ? (
            <span className="hidden truncate text-[11px] text-muted-foreground xl:block">
              {rodape}
            </span>
          ) : null}

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
