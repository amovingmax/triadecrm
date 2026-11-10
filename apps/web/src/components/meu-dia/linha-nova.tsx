'use client';

import Link from 'next/link';
import {
  ChevronRight,
  ClipboardCheck,
  Flag,
  MessageCircle,
  Phone,
  Send,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatarLocal } from '@/components/parceiros/formatos';
import { useRevelarLinha } from '@/components/movimento';

import { formatarQuando, quandoEmTexto } from './formatos';
import { ICONE_DO_ITEM, iconeDoItem } from './icones';
import {
  acaoDoItem,
  corDoDisco,
  iniciais,
  motivoQueSobra,
  pastilhaDaJanela,
  type IconeDaAcao,
} from './novo';
import { destinoDoItem, type ItemDoDia } from './tipos';

/**
 * Uma linha da fila no Meu dia novo da Imova (módulo `meuDiaNovo`), no desenho do
 * protótipo aprovado em 10/11/2026. A KOMUNE continua com `ItemDaFila`.
 *
 *   à esquerda   o disco com as iniciais de quem é a pendência
 *   no meio      o nome e, ao lado, categoria · etapa · bairro; embaixo, a fala do
 *                lead (conversa) ou o que fazer (tarefa); e o motivo, quando ele
 *                diz algo que as duas linhas não disseram
 *   à direita    a quem a conversa aponta, o prazo numa pastilha e o botão que diz
 *                o que o toque faz
 *
 * A linha inteira continua sendo UM link (`destinoDoItem`): o botão da direita é
 * desenho, e não outro alvo. Um botão dentro de um link é HTML inválido, e dois
 * alvos na mesma linha brigam pelo polegar. A caixa de seleção e o menu "…" do
 * protótipo ficam para a fase 2, junto com as ações em lote que eles servem: uma
 * caixa que não faz nada é pior que caixa nenhuma.
 */
export function LinhaNova({
  item,
  indice,
  somenteLeitura = false,
  previa = null,
  primeira = false,
}: {
  item: ItemDoDia;
  indice: number;
  /** Dia de outra pessoa: a linha leva só à ficha (ver `destinoDoItem`). */
  somenteLeitura?: boolean;
  /** A última mensagem do lead, já em uma linha (`textoDaPrevia`). */
  previa?: string | null;
  /** A primeira da fila na tela: ganha o selo "Comece por aqui". */
  primeira?: boolean;
}) {
  const revelar = useRevelarLinha(indice);
  const destino = destinoDoItem(item, { somenteLeitura });
  const quando = formatarQuando(item);
  const janela = pastilhaDaJanela(item);
  const acao = acaoDoItem(item, { somenteLeitura });

  const nome = item.organizacao ?? item.titulo;
  // O título só entra quando acrescenta: o aviso do sistema não tem parceiro e o
  // título dele já é o nome; e a conversa com a fala do lead não precisa do
  // "Responder no WhatsApp", que virou o botão.
  const oQueFazer =
    item.organizacao &&
    item.titulo !== item.organizacao &&
    !(item.tipo === 'conversa_esperando' && previa)
      ? item.titulo
      : null;
  // Os motivos de funil já NOMEIAM a etapa ("parado na etapa Contatado"): repetir a
  // etapa ao lado do nome só gastaria a largura.
  const motivoNomeiaEtapa =
    item.tipo === 'sem_proxima_acao' ||
    item.tipo === 'negocio_parado' ||
    item.tipo === 'desfecho_pendente';
  const mostrarMotivo = motivoNomeiaEtapa || item.tipo === 'conversa_esperando' || !oQueFazer;
  const motivoCru = mostrarMotivo ? motivoQueSobra(item) : null;
  const motivo =
    motivoCru && motivoCru !== nome && motivoCru !== oQueFazer && motivoCru !== previa
      ? motivoCru
      : null;
  const contexto = [
    item.categoria,
    motivoNomeiaEtapa ? null : item.etapa,
    formatarLocal(item.bairro, null),
  ]
    .filter(Boolean)
    .join(' · ');

  const letras = item.organizacao ? iniciais(item.organizacao) : '';
  const IconeDoMotivo = ICONE_DO_ITEM[iconeDoItem(item)];

  const miolo = (
    <>
      {letras ? (
        <span
          aria-hidden="true"
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-foreground',
            COR_DO_DISCO[corDoDisco(item.organizacao ?? '', COR_DO_DISCO.length)],
          )}
        >
          {letras}
        </span>
      ) : (
        // Sem parceiro (aviso do sistema, ou quem escreveu de fora da base): o
        // ícone do motivo no lugar das iniciais, que não existem.
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <IconeDoMotivo className="size-4.5" />
        </span>
      )}

      <div className="min-w-0 flex-1 sm:basis-56">
        {primeira ? (
          <span className="mb-1 inline-block rounded-full border border-menta/60 px-2 py-px text-[11px] font-bold tracking-[0.04em] text-menta-texto">
            COMECE POR AQUI
          </span>
        ) : null}
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="min-w-0 truncate font-semibold sm:text-base">{nome}</span>
          {contexto ? (
            <span className="min-w-0 truncate text-[13px] text-muted-foreground">{contexto}</span>
          ) : null}
        </p>
        {previa ? (
          <p className="mt-0.5 truncate text-sm text-foreground/80">{previa}</p>
        ) : oQueFazer ? (
          <p className="mt-0.5 truncate text-sm text-foreground/80">{oQueFazer}</p>
        ) : null}
        {motivo ? <p className="mt-0.5 text-xs text-muted-foreground">{motivo}</p> : null}
      </div>

      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
        {/* A QUEM A CONVERSA APONTA (ADR-17): a fila de quem respondeu é de todos,
            e o banco só manda o nome quando ele acrescenta. */}
        {item.atendente ? (
          <span
            title={`Endereçada a ${item.atendente}`}
            className="hidden rounded-full border px-2.5 py-1 text-[13px] text-muted-foreground sm:inline"
          >
            Para {item.atendente}
          </span>
        ) : null}

        {janela ? (
          // A conversa com janela aberta conta o que FALTA: "há 21 h" e "fecha em
          // 3 h" são o mesmo fato, mas só o segundo diz o que fazer.
          <span
            className={cn(
              PASTILHA,
              janela.pressa ? 'bg-menta-fundo text-menta-texto' : 'bg-muted text-foreground/80',
            )}
          >
            {janela.texto}
            <span className="numerico">{janela.numero}</span>
          </span>
        ) : quando.numero || quando.prefixo || quando.sufixo ? (
          <span
            title={quando.detalhe}
            className={cn(
              PASTILHA,
              quando.atencao
                ? 'bg-destructive/15 text-destructive-texto'
                : 'bg-muted text-foreground/80',
            )}
          >
            <span aria-hidden="true">
              {quando.prefixo}
              {quando.numero ? <span className="numerico">{quando.numero}</span> : null}
              {quando.sufixo}
            </span>
            <span className="sr-only">{`${quandoEmTexto(quando)}. ${quando.detalhe}`}</span>
          </span>
        ) : null}

        {destino ? (
          <>
            <span
              aria-hidden="true"
              className={cn(
                'hidden h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-bold whitespace-nowrap sm:inline-flex',
                acao.destaque
                  ? 'border-menta bg-menta text-menta-tinta'
                  : 'border-foreground/15 bg-muted/50 text-foreground',
              )}
            >
              <IconeDoBotao icone={acao.icone} />
              {acao.rotulo}
              {acao.icone === 'abrir' ? <ChevronRight className="size-4" /> : null}
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground sm:hidden"
              aria-hidden="true"
            />
          </>
        ) : null}
      </div>
    </>
  );

  // No celular a linha não quebra: o prazo fica à direita do nome, como no
  // protótipo do celular, e o texto do meio é que encurta. Do tablet para cima o
  // botão escrito entra, e aí a direita pode descer para baixo do texto.
  const molde =
    'flex items-center gap-x-3 gap-y-2 border-t px-4 py-3 transition-colors sm:flex-wrap sm:gap-x-3.5 sm:pr-5';

  return (
    <li {...revelar} className={revelar.className}>
      {destino ? (
        <Link
          href={destino.href}
          className={cn(
            molde,
            'outline-none active:bg-muted/60 focus-visible:bg-muted/60 md:hover:bg-muted/40',
          )}
        >
          {miolo}
          {/* Sem `aria-label` no link: ele apagaria a linha inteira para o leitor de
              tela. O destino entra no fim, depois do que já foi lido. */}
          <span className="sr-only">
            {acao.rotulo}: abrir {destino.onde}.
          </span>
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

const PASTILHA =
  'inline-flex items-center rounded-full px-2.5 py-1 text-[13px] font-semibold whitespace-nowrap';

/**
 * As quatro cores do disco de iniciais, misturadas no cartão para servirem aos
 * dois temas: o laranja da marca, o petróleo, o alerta e o neutro, todos fracos.
 */
const COR_DO_DISCO = ['bg-menta-fundo', 'bg-primary/15', 'bg-destructive/12', 'bg-muted'] as const;

const ICONE_DO_BOTAO: Record<Exclude<IconeDaAcao, 'abrir'>, LucideIcon> = {
  responder: MessageCircle,
  modelo: Send,
  ligar: Phone,
  registrar: ClipboardCheck,
  combinar: Flag,
};

function IconeDoBotao({ icone }: { icone: IconeDaAcao }) {
  if (icone === 'abrir') return null;
  const Icone = ICONE_DO_BOTAO[icone];
  return <Icone className="size-4" />;
}
