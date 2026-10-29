'use client';

import { memo, useEffect, useRef } from 'react';
import { BellOff, ChevronRight, Pin, Sparkles } from 'lucide-react';

import { FaixaDeNova, MarcaDeNova } from '@/components/avisos/marca-de-nova';
import { useConversasNovas } from '@/components/avisos/provedor-avisos';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Etiqueta } from '@/components/etiqueta';
import { EtiquetaEtapa } from '@/components/funis/etapa';
import { formatarTelefone } from '@/components/parceiros/formatos';
import { DiasSemContato } from '@/components/temperatura';

import { AtitudeNaLista } from './atitude';
import type { BaseDasAtitudes } from './atitude-dados';
import type { AtitudeDaConversa, Objecao } from './atitude-regra';
import { nomeDoCliente } from './fora-da-base-dados';
import { local, rotuloDoDia } from './formatos';
import { ICONE_CANAL } from './icones';
import { ChipDaJanela } from './janela-24h';
import { estadoDaJanela, type FioCru } from './mensagens';
import { juntarNaLista } from './montagem';
import { ehSilenciada, SEM_PREFERENCIAS, type Preferencias } from './preferencias';
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
  preferencias = SEM_PREFERENCIAS,
  atitudes = null,
  porInteresse = false,
}: {
  itens: ItemConversa[];
  selecionadoId: string | null;
  aoEscolher: (id: string) => void;
  /** Fixar e silenciar de quem está olhando (27/10/2026). */
  preferencias?: Preferencias;
  /** Quem escreveu e não é ficha. Só a lista de Conversas passa; as filas, não. */
  clientes?: FioCru[];
  /** O id da CONVERSA do cliente aberto — ele não tem ficha. */
  clienteSelecionadoId?: string | null;
  aoEscolherCliente?: (conversaId: string) => void;
  /** A atitude do cliente (29/10/2026). Nula ou desligada, a lista fica como era. */
  atitudes?: BaseDasAtitudes | null;
  /** "Mais interessados": a lista vai pela etiqueta de atitude. */
  porInteresse?: boolean;
}) {
  const novas = useConversasNovas();
  const ligadas = atitudes?.ligada ? atitudes : null;
  const atitudeDe = (fioId: string | null | undefined): AtitudeDaConversa | undefined =>
    fioId ? ligadas?.porConversa.get(fioId) : undefined;
  const objecoes = ligadas?.objecoes ?? SEM_OBJECOES;
  const digitados = useTextosDigitados();
  /** O que a linha mostra depois de "Rascunho:", ou `null`. */
  const rascunhoDe = (fioId: string | null | undefined, selecionado: boolean): string | null =>
    selecionado || !fioId ? null : previaDoDigitado(digitados.get(fioId)?.texto);
  return (
    <ul className="corpo-tabela flex flex-col">
      {juntarNaLista(
        itens,
        clientes,
        preferencias,
        porInteresse ? (ligadas?.porConversa ?? null) : null,
      ).map((linha) =>
        linha.tipo === 'parceiro' ? (
          <LinhaMemorizada
            key={linha.item.id}
            item={linha.item}
            selecionado={linha.item.id === selecionadoId}
            nova={linha.item.fio ? novas.has(linha.item.fio.id) : false}
            rascunho={rascunhoDe(linha.item.fio?.id, linha.item.id === selecionadoId)}
            aoEscolher={aoEscolher}
            marcas={marcasDa(linha.item.fio?.id, preferencias)}
            atitude={atitudeDe(linha.item.fio?.id)}
            objecoes={objecoes}
          />
        ) : (
          <LinhaDeClienteMemorizada
            key={linha.fio.id}
            fio={linha.fio}
            selecionado={linha.fio.id === clienteSelecionadoId}
            nova={novas.has(linha.fio.id)}
            rascunho={rascunhoDe(linha.fio.id, linha.fio.id === clienteSelecionadoId)}
            aoEscolher={aoEscolherCliente}
            marcas={marcasDa(linha.fio.id, preferencias)}
            atitude={atitudeDe(linha.fio.id)}
            objecoes={objecoes}
          />
        ),
      )}
    </ul>
  );
}

/** Constante: a linha é memorizada, e uma lista nova a cada pintura a redesenharia. */
const SEM_OBJECOES: readonly Objecao[] = [];

/**
 * Fixada e silenciada, de quem está olhando (27/10/2026). Uma constante por
 * combinação: a linha é memorizada, e um objeto novo a cada pintura a faria
 * redesenhar à toa.
 */
type Marcas = { readonly fixada: boolean; readonly silenciada: boolean };
const MARCAS: Record<string, Marcas> = {
  '00': { fixada: false, silenciada: false },
  '10': { fixada: true, silenciada: false },
  '01': { fixada: false, silenciada: true },
  '11': { fixada: true, silenciada: true },
};
function marcasDa(fioId: string | null | undefined, preferencias: Preferencias): Marcas {
  const p = fioId ? preferencias.get(fioId) : undefined;
  return MARCAS[`${p?.fixadaEm ? 1 : 0}${ehSilenciada(p?.silenciadaAte) ? 1 : 0}`]!;
}

/** O alfinete e o sino cortado, ao lado do nome. */
function IconesDaLinha({ marcas }: { marcas: Marcas }) {
  if (!marcas.fixada && !marcas.silenciada) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 self-center text-muted-foreground">
      {marcas.silenciada ? <BellOff className="size-3.5" aria-label="Silenciada" /> : null}
      {marcas.fixada ? <Pin className="size-3.5" aria-label="Fixada" /> : null}
    </span>
  );
}

/** O número de por ler: verde para agir; cinza quando silenciada, como no WhatsApp. */
function PorLer({ quantas, silenciada }: { quantas: number; silenciada: boolean }) {
  return (
    <span
      className={cn(
        'numerico inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
        silenciada
          ? 'bg-muted-foreground/60 text-background'
          : 'bg-primary text-primary-foreground',
      )}
      title={`${quantas} mensagem(ns) por ler`}
    >
      {quantas}
    </span>
  );
}

/** O contato bloqueado (27/10/2026): nada sai para ele. */
function SeloDeBloqueado() {
  return (
    <Badge variant="pilula" className="h-4 shrink-0 px-1.5 text-[10px] font-normal">
      bloqueado
    </Badge>
  );
}

/**
 * As linhas são memorizadas (20/10/2026): cada tecla na caixa de resposta muda o
 * mapa de rascunhos, e a lista, que o escuta, era redesenhada INTEIRA — até 500
 * linhas por tecla, ao lado da conversa no PC. Só que a linha da conversa aberta
 * nunca mostra "Rascunho:" (`rascunhoDe` devolve `null` para a selecionada), então
 * enquanto se digita nenhuma linha muda: com as propriedades iguais, nenhuma é
 * redesenhada. `item` vem do cache e `aoEscolher` é estável (`useCallback`).
 */
const LinhaMemorizada = memo(Linha);
const LinhaDeClienteMemorizada = memo(LinhaDeCliente);

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
  marcas,
  atitude,
  objecoes,
}: {
  fio: FioCru;
  selecionado: boolean;
  /** Tem mensagem para esta pessoa que ninguém do time respondeu ainda. */
  nova: boolean;
  /** O começo do que a pessoa digitou aqui e não enviou. */
  rascunho: string | null;
  aoEscolher?: (conversaId: string) => void;
  marcas: Marcas;
  atitude: AtitudeDaConversa | undefined;
  objecoes: readonly Objecao[];
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
              {nomeDoCliente(fio)}
            </span>
            {nova ? <MarcaDeNova className="self-center" /> : null}
            <IconesDaLinha marcas={marcas} />
            {fio.unread_count > 0 ? (
              <PorLer quantas={fio.unread_count} silenciada={marcas.silenciada} />
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
                {nome ? formatarTelefone(fio.peer_phone_e164) : 'sem nome no perfil'}
              </span>
            )}
            <ChipDaJanela estado={janela} />
            {fio.bloqueada_em ? <SeloDeBloqueado /> : null}
            {/* Onde o parceiro tem a etapa, o cliente diz o que é: é esta palavra
                que explica por que a linha não tem funil nem bairro. */}
            <Badge variant="pilula" className="h-4 shrink-0 px-1.5 text-[10px] font-normal">
              cliente
            </Badge>
          </span>

          {/* A ATITUDE (29/10/2026): o quanto essa pessoa quer, e a objeção dela. */}
          <AtitudeNaLista atitude={atitude} objecoes={objecoes} />
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
  marcas,
  atitude,
  objecoes,
}: {
  item: ItemConversa;
  selecionado: boolean;
  /** Tem mensagem para esta pessoa que ninguém do time respondeu ainda. */
  nova: boolean;
  /** O começo do que a pessoa digitou aqui e não enviou. */
  rascunho: string | null;
  aoEscolher: (id: string) => void;
  marcas: Marcas;
  atitude: AtitudeDaConversa | undefined;
  objecoes: readonly Objecao[];
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
            <IconesDaLinha marcas={marcas} />
            {/* Por ler vai no verde da ação, e não no branco: é o único número da
                linha que pede para alguém fazer alguma coisa. */}
            {item.naoLidas > 0 ? (
              <PorLer quantas={item.naoLidas} silenciada={marcas.silenciada} />
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
            {item.fio?.bloqueadaEm ? <SeloDeBloqueado /> : null}
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
          {/* A ATITUDE (29/10/2026) abre a linha das etiquetas: é a primeira
              coisa que se procura nela quando a pergunta é "quem quer mais?". */}
          {item.etiquetas.length > 0 || atitude ? (
            <span className="flex flex-wrap items-center gap-1">
              <AtitudeNaLista atitude={atitude} objecoes={objecoes} />
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
