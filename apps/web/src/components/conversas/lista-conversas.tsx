'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellOff, Check, Pin, Sparkles } from 'lucide-react';
import type { CanalDeChegada } from '@komune/schema';

import { FaixaDeNova, MarcaDeNova } from '@/components/avisos/marca-de-nova';
import { useConversasNovas } from '@/components/avisos/provedor-avisos';
import {
  SEM_PERDIDAS,
  type LigacaoPerdida,
  type Perdidas,
} from '@/components/ligacao-whatsapp/logica';
import { FaixaDePerdida, SeloDeLigacaoPerdida } from '@/components/ligacao-whatsapp/perdidas';
import { EMPRESA } from '@/lib/empresa';
import { cn } from '@/lib/utils';
import { Etiqueta } from '@/components/etiqueta';
import { formatarTelefone } from '@/components/parceiros/formatos';
import type { Temperatura } from '@/components/temperatura/escala-termica';

import { AtitudeNaLista } from './atitude';
import type { BaseDasAtitudes } from './atitude-dados';
import type { AtitudeDaConversa, Objecao } from './atitude-regra';
import { CanalNaLista } from './canal-de-chegada';
import type { BaseDosCanais } from './canal-de-chegada-dados';
import { canalNaLista } from './canal-de-chegada-regra';
import { SeloDeConcluida } from './concluir-conversa';
import { nomeDoCliente, pareceFornecedor } from './fora-da-base-dados';
import { local, quandoNaLista } from './formatos';
import { ICONE_CANAL } from './icones';
import { ChipDaJanela } from './janela-24h';
import { estadoDaJanela, type FioCru } from './mensagens';
import { juntarNaLista } from './montagem';
import { ehSilenciada, SEM_PREFERENCIAS, type Preferencias } from './preferencias';
import { previaDoDigitado, useTextosDigitados } from './texto-digitado';
import { ROTULO_CANAL, type ItemConversa } from './tipos';
import { useToqueLongo } from './acoes-da-mensagem';
import { BarraDaSelecao, MenuDaLinha, type EstadoDaLinha } from './menu-da-linha';
import { AvatarDaConversa } from './wpp';

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
  canais = null,
  porInteresse = false,
  perdidas = SEM_PERDIDAS,
}: {
  itens: ItemConversa[];
  selecionadoId: string | null;
  aoEscolher: (id: string) => void;
  /** Fixar e silenciar de quem está olhando (27/10/2026). */
  preferencias?: Preferencias;
  /** Quem escreveu e não é parceiro, para entrar na mesma lista (aba Conversas). */
  clientes?: FioCru[];
  /** A conversa de cliente aberta ao lado, para marcar a linha dela. */
  clienteSelecionadoId?: string | null;
  aoEscolherCliente?: (conversaId: string) => void;
  /** A atitude do cliente (Imova): a etiqueta na linha. Desligada, nada aparece. */
  atitudes?: BaseDasAtitudes | null;
  /** O canal de chegada (Imova, 06/11/2026): o chip na linha. Desligado, nada aparece. */
  canais?: BaseDosCanais | null;
  /** "Mais interessados": a ordem é a da atitude, e não a de sempre. */
  porInteresse?: boolean;
  /** Quem ligou e não foi atendido (03/11/2026): sobe para o topo com o selo. */
  perdidas?: Perdidas;
}) {
  const novas = useConversasNovas();
  const ligadas = atitudes?.ligada ? atitudes : null;
  const atitudeDe = (fioId: string | null | undefined): AtitudeDaConversa | undefined =>
    fioId ? ligadas?.porConversa.get(fioId) : undefined;
  const objecoes = ligadas?.objecoes ?? SEM_OBJECOES;
  // Só o canal (um texto), e não a chegada inteira: a linha é memorizada, e o
  // mapa dos canais é refeito a cada minuto.
  const canalDe = (fioId: string | null | undefined): CanalDeChegada | null =>
    !fioId || !canais?.ligada ? null : canalNaLista(canais.porConversa.get(fioId));
  const digitados = useTextosDigitados();
  // O texto que a pessoa digitou e não enviou, no lugar da prévia — menos na
  // conversa aberta, onde ele já está na caixa.
  const rascunhoDe = (fioId: string | null | undefined, selecionado: boolean): string | null =>
    selecionado || !fioId ? null : previaDoDigitado(digitados.get(fioId)?.texto);
  // A linha segurada no celular (o toque longo do WhatsApp): o alto da tela vira
  // a barra das ações dela até a pessoa agir ou desfazer.
  const [segurada, setSegurada] = useState<EstadoDaLinha | null>(null);
  const segurar = useCallback((linha: EstadoDaLinha) => setSegurada(linha), []);
  return (
    <>
      {segurada ? <BarraDaSelecao linha={segurada} aoCancelar={() => setSegurada(null)} /> : null}
      <ul className="flex flex-col">
        {juntarNaLista(
          itens,
          clientes,
          preferencias,
          porInteresse ? (ligadas?.porConversa ?? null) : null,
          perdidas,
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
              canal={canalDe(linha.item.fio?.id)}
              perdida={linha.item.fio ? perdidas.get(linha.item.fio.id) : undefined}
              segurada={segurada !== null && segurada.fioId === linha.item.fio?.id}
              aoSegurar={segurar}
              aoSoltar={segurada ? () => setSegurada(null) : null}
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
              canal={canalDe(linha.fio.id)}
              perdida={perdidas.get(linha.fio.id)}
              segurada={segurada !== null && segurada.fioId === linha.fio.id}
              aoSegurar={segurar}
              aoSoltar={segurada ? () => setSegurada(null) : null}
            />
          ),
        )}
      </ul>
    </>
  );
}

const SEM_OBJECOES: readonly Objecao[] = [];

/**
 * Fixada e silenciada, de quem está olhando (27/10/2026). Uma constante por
 * combinação, para a linha memorizada receber o MESMO objeto entre um desenho e
 * outro e não se redesenhar à toa.
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
 * da prévia da linha, com o rótulo no verde do WhatsApp.
 */
export function PreviaDoRascunho({ texto, className }: { texto: string; className?: string }) {
  return (
    <span className={cn('min-w-0 flex-1 truncate', className)}>
      <span className="font-medium text-wpp-nova">Rascunho:</span>{' '}
      <span className="text-wpp-suave">{texto}</span>
    </span>
  );
}

/** O número de por ler: o círculo verde do WhatsApp; cinza quando silenciada. */
function PorLer({ quantas, silenciada }: { quantas: number; silenciada: boolean }) {
  return (
    <span
      className={cn(
        'numerico inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-medium',
        silenciada ? 'bg-wpp-suave/60 text-wpp-painel' : 'bg-menta text-menta-tinta',
      )}
      title={`${quantas} mensagem(ns) por ler`}
    >
      {quantas}
    </span>
  );
}

/** Um selo miúdo da segunda linha: "Concluída", "bloqueado", "não contatar". */
function Selo({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full bg-wpp-chip px-2 text-[11px] font-semibold text-wpp-chip-texto',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A LINHA NO JEITO DO WHATSAPP (03/11/2026), igual para parceiro e cliente: o
 * retrato com o ponto da temperatura, o nome e a hora em cima, a prévia com os
 * selos e o número verde embaixo, e o filete só sob o texto. Ao passar o mouse
 * aparece a setinha das opções (o clique direito abre o mesmo menu); no celular,
 * segurar seleciona a linha.
 */
function LinhaWpp({
  nome,
  temperatura,
  quando,
  destaque,
  selecionado,
  aoEscolher,
  menu,
  segurada,
  aoSegurar,
  aoSoltar,
  faixa,
  segunda,
  terceira,
  dica,
}: {
  nome: string;
  temperatura: Temperatura | null;
  quando: string | null;
  /** Nova ou por ler: o nome em negrito e a hora em verde. */
  destaque: boolean;
  selecionado: boolean;
  aoEscolher: () => void;
  /** Sem conversa no WhatsApp (só registro de contato), a linha não tem menu. */
  menu: EstadoDaLinha | null;
  segurada: boolean;
  aoSegurar: (linha: EstadoDaLinha) => void;
  /** Com outra linha segurada, tocar nesta só desfaz a seleção. */
  aoSoltar: (() => void) | null;
  faixa: React.ReactNode;
  segunda: React.ReactNode;
  terceira?: React.ReactNode;
  dica?: string;
}) {
  const alvo = useRef<HTMLLIElement>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  // O toque longo seleciona e o dedo que sobe não pode abrir a conversa junto.
  const segurou = useRef(false);
  const toque = useToqueLongo(() => {
    if (!menu) return;
    segurou.current = true;
    aoSegurar(menu);
  }, menu !== null);

  useEffect(() => {
    if (selecionado) alvo.current?.scrollIntoView({ block: 'nearest' });
  }, [selecionado]);

  const fundo = segurada
    ? 'var(--wpp-chip-ativo)'
    : selecionado
      ? 'var(--wpp-sel)'
      : 'var(--wpp-painel)';

  return (
    <li ref={alvo} className="group/linha relative" style={{ background: fundo }}>
      <button
        type="button"
        {...toque}
        onClick={() => {
          if (segurou.current) {
            segurou.current = false;
            return;
          }
          if (aoSoltar) {
            aoSoltar();
            return;
          }
          aoEscolher();
        }}
        onContextMenu={(e) => {
          toque.onContextMenu(e);
          if (e.defaultPrevented || !menu) return;
          // O clique direito do mouse abre o menu da setinha, como no WhatsApp.
          e.preventDefault();
          setMenuAberto(true);
        }}
        aria-current={selecionado ? 'true' : undefined}
        title={dica}
        className={cn(
          'relative flex w-full items-center gap-3 px-3.5 text-left outline-none',
          'hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.06]',
          'pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]',
        )}
      >
        {faixa}
        <AvatarDaConversa nome={nome} temperatura={temperatura} anel={fundo}>
          {segurada ? (
            <span className="absolute right-[-2px] bottom-[-2px] flex size-5 items-center justify-center rounded-full bg-wpp-cita-barra text-white ring-2 ring-wpp-painel">
              <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
            </span>
          ) : null}
        </AvatarDaConversa>
        <span className="flex min-w-0 flex-1 flex-col gap-[3px] border-b border-wpp-linha py-[13px]">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[15px]',
                destaque ? 'font-semibold' : 'font-medium',
              )}
            >
              {nome}
            </span>
            {quando ? (
              <span
                className={cn(
                  'numerico shrink-0 text-[11.5px]',
                  destaque ? 'font-medium text-wpp-nova' : 'text-wpp-suave',
                )}
              >
                {quando}
              </span>
            ) : null}
          </span>
          <span className="flex min-w-0 items-center gap-[5px] text-[13.5px] text-wpp-suave transition-[padding] md:group-hover/linha:pr-8">
            {segunda}
          </span>
          {terceira}
        </span>
      </button>
      {menu ? (
        <MenuDaLinha
          linha={menu}
          aberto={menuAberto}
          aoMudar={setMenuAberto}
          className="absolute right-3 bottom-3 z-10"
        />
      ) : null}
    </li>
  );
}

/**
 * A hora da linha é a da ÚLTIMA COISA que aconteceu, como no WhatsApp: a
 * mensagem mais recente do fio ou o último contato registrado (ligação, visita),
 * o que vier depois. Só o registro deixava "Ontem" numa conversa com mensagem de
 * agora há pouco.
 */
function quandoDaLinha(item: ItemConversa): string | null {
  const datas = [item.ultimaEm, item.fio?.ultimaEm ?? null].filter((d): d is string => !!d);
  if (datas.length === 0) return null;
  return quandoNaLista(datas.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)));
}

/** Os ícones de fixada e silenciada, à direita da prévia. */
function IconesDaLinha({ marcas }: { marcas: Marcas }) {
  if (!marcas.fixada && !marcas.silenciada) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {marcas.silenciada ? <BellOff className="size-4" aria-label="Silenciada" /> : null}
      {marcas.fixada ? <Pin className="size-4" aria-label="Fixada" /> : null}
    </span>
  );
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
  canal,
  perdida,
  segurada,
  aoSegurar,
  aoSoltar,
}: {
  fio: FioCru;
  selecionado: boolean;
  /** Mensagem que ninguém do time respondeu ainda (02/10/2026). */
  nova: boolean;
  /** O começo do que a pessoa digitou aqui e não enviou. */
  rascunho: string | null;
  aoEscolher?: (conversaId: string) => void;
  marcas: Marcas;
  atitude: AtitudeDaConversa | undefined;
  objecoes: readonly Objecao[];
  /** O canal de chegada (Imova), só quando há o que dizer. */
  canal: CanalDeChegada | null;
  /** Ligou e ninguém atendeu (03/11/2026). */
  perdida: LigacaoPerdida | undefined;
  segurada: boolean;
  aoSegurar: (linha: EstadoDaLinha) => void;
  aoSoltar: (() => void) | null;
}) {
  const nome = fio.peer_nome?.trim();
  const janela = estadoDaJanela(fio.window_expires_at);
  const rotulo = nomeDoCliente(fio);
  const menu = useMemo<EstadoDaLinha>(
    () => ({
      fioId: fio.id,
      nome: rotulo,
      fixada: marcas.fixada,
      silenciada: marcas.silenciada,
      naoLidas: fio.unread_count,
      concluidaEm: fio.arquivada_em,
    }),
    [fio.id, rotulo, marcas, fio.unread_count, fio.arquivada_em],
  );

  return (
    <LinhaWpp
      nome={rotulo}
      temperatura={null}
      quando={fio.last_message_at ? quandoNaLista(fio.last_message_at) : null}
      destaque={nova || perdida !== undefined || fio.unread_count > 0}
      selecionado={selecionado}
      aoEscolher={() => aoEscolher?.(fio.id)}
      menu={menu}
      segurada={segurada}
      aoSegurar={aoSegurar}
      aoSoltar={aoSoltar}
      faixa={perdida ? <FaixaDePerdida /> : nova ? <FaixaDeNova /> : null}
      segunda={
        <>
          {perdida ? <SeloDeLigacaoPerdida perdida={perdida} /> : null}
          {rascunho ? (
            <PreviaDoRascunho texto={rascunho} />
          ) : (
            <span className="min-w-0 flex-1 truncate">
              {nome ? formatarTelefone(fio.peer_phone_e164) : 'sem nome no perfil'}
            </span>
          )}
          <ChipDaJanela estado={janela} />
          {fio.bloqueada_em ? <Selo>bloqueado</Selo> : null}
          <SeloDeConcluida concluidaEm={fio.arquivada_em} />
          {/* Onde o parceiro tem a etapa, o cliente diz o que é: é esta palavra
              que explica por que a linha não tem funil nem bairro. */}
          {EMPRESA.modulos.caixasDeConversa && pareceFornecedor(fio) ? (
            <Selo className="bg-wpp-janela text-wpp-janela-texto">parece fornecedor</Selo>
          ) : (
            <Selo>cliente</Selo>
          )}
          <IconesDaLinha marcas={marcas} />
          {nova ? <MarcaDeNova className="shrink-0" /> : null}
          {fio.unread_count > 0 ? (
            <PorLer quantas={fio.unread_count} silenciada={marcas.silenciada} />
          ) : null}
        </>
      }
      terceira={
        atitude || canal ? (
          <span className="flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-wpp-suave">
            <AtitudeNaLista atitude={atitude} objecoes={objecoes} />
            <CanalNaLista canal={canal} />
          </span>
        ) : null
      }
    />
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
  canal,
  perdida,
  segurada,
  aoSegurar,
  aoSoltar,
}: {
  item: ItemConversa;
  selecionado: boolean;
  /** Mensagem que ninguém do time respondeu ainda (02/10/2026). */
  nova: boolean;
  /** O começo do que a pessoa digitou aqui e não enviou. */
  rascunho: string | null;
  aoEscolher: (id: string) => void;
  marcas: Marcas;
  atitude: AtitudeDaConversa | undefined;
  objecoes: readonly Objecao[];
  /** O canal de chegada (Imova), só quando há o que dizer. */
  canal: CanalDeChegada | null;
  /** Ligou e ninguém atendeu (03/11/2026). */
  perdida: LigacaoPerdida | undefined;
  segurada: boolean;
  aoSegurar: (linha: EstadoDaLinha) => void;
  aoSoltar: (() => void) | null;
}) {
  const Icone = item.ultimoCanal ? ICONE_CANAL[item.ultimoCanal] : null;
  const onde = local(item.bairro, item.cidade);
  const rodape = [onde, item.categoria].filter(Boolean).join(' · ');
  // A janela de 24 h na linha (16/10/2026): quem tem resposta livre aparece
  // marcado, porque é a conversa que dá para responder agora sem modelo.
  const janela = estadoDaJanela(item.fio?.janelaExpiraEm ?? null);
  const fio = item.fio;
  const menu = useMemo<EstadoDaLinha | null>(
    () =>
      fio
        ? {
            fioId: fio.id,
            nome: item.nome,
            fixada: marcas.fixada,
            silenciada: marcas.silenciada,
            naoLidas: item.naoLidas,
            concluidaEm: fio.arquivadaEm,
          }
        : null,
    [fio, item.nome, marcas, item.naoLidas],
  );
  const temTerceira =
    item.etiquetas.length > 0 ||
    atitude !== undefined ||
    canal !== null ||
    Boolean(item.leituraDaIa?.proximaAcao);

  return (
    <LinhaWpp
      nome={item.nome}
      temperatura={item.temperatura}
      quando={quandoDaLinha(item)}
      destaque={nova || perdida !== undefined || item.naoLidas > 0}
      selecionado={selecionado}
      aoEscolher={() => aoEscolher(item.id)}
      menu={menu}
      segurada={segurada}
      aoSegurar={aoSegurar}
      aoSoltar={aoSoltar}
      // Onde e o quê no `title`: a linha do WhatsApp tem duas linhas, e o bairro
      // e a categoria estão na ficha ao lado.
      dica={rodape || undefined}
      faixa={perdida ? <FaixaDePerdida /> : nova ? <FaixaDeNova /> : null}
      segunda={
        <>
          {Icone ? (
            <Icone
              className="size-4 shrink-0"
              aria-label={item.ultimoCanal ? ROTULO_CANAL[item.ultimoCanal] : undefined}
            />
          ) : null}
          {perdida ? <SeloDeLigacaoPerdida perdida={perdida} /> : null}
          {rascunho ? (
            <PreviaDoRascunho texto={rascunho} />
          ) : (
            <span className={cn('min-w-0 flex-1 truncate', item.resumo && 'text-foreground/80')}>
              {item.resumo ?? 'Nenhum contato registrado'}
            </span>
          )}
          {item.naoContatar ? <Selo>não contatar</Selo> : null}
          {fio?.bloqueadaEm ? <Selo>bloqueado</Selo> : null}
          <SeloDeConcluida concluidaEm={fio?.arquivadaEm} />
          {/* O rascunho pendente é o que faz alguém abrir esta linha AGORA: ele
              expira em três dias e some sozinho. */}
          {item.rascunhoPendente ? (
            <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-wpp-linha-forte px-1.5 text-[11px]">
              <Sparkles className="size-3" aria-hidden="true" />
              aprovar
            </span>
          ) : null}
          <ChipDaJanela estado={janela} />
          <IconesDaLinha marcas={marcas} />
          {nova ? <MarcaDeNova className="shrink-0" /> : null}
          {item.naoLidas > 0 ? (
            <PorLer quantas={item.naoLidas} silenciada={marcas.silenciada} />
          ) : null}
        </>
      }
      terceira={
        temTerceira ? (
          // Etiquetas, a atitude, o canal de chegada e o próximo passo da IA numa
          // linha miúda só: a lista do WhatsApp tem duas linhas, e esta só aparece
          // quando há o que dizer.
          <span className="flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-wpp-suave">
            <AtitudeNaLista atitude={atitude} objecoes={objecoes} />
            <CanalNaLista canal={canal} />
            {item.etiquetas.slice(0, 2).map((e) => (
              <Etiqueta
                key={e.id}
                nome={e.nome}
                cor={e.cor}
                className="h-4 shrink-0 px-1.5 text-[10px]"
              />
            ))}
            {item.etiquetas.length > 2 ? (
              <span className="numerico shrink-0">+{item.etiquetas.length - 2}</span>
            ) : null}
            {item.leituraDaIa?.proximaAcao ? (
              <>
                <Sparkles className="ml-0.5 size-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{item.leituraDaIa.proximaAcao}</span>
                {(item.leituraDaIa.score ?? 0) >= NOTA_QUE_VALE ? (
                  <span
                    className="numerico shrink-0 rounded-full bg-wpp-chip px-1.5 text-[10px]"
                    title={`A IA vê ${item.leituraDaIa.score} de 100 de intenção de fechar nesta conversa`}
                  >
                    IA {item.leituraDaIa.score}
                  </span>
                ) : null}
              </>
            ) : null}
          </span>
        ) : null
      }
    />
  );
}
