'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Bot, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useRevelarLinha } from '@/components/movimento';

import type { AutomaticaCrua } from './automaticas-dados';
import { DIAS_DO_FEED, LIMITE_DO_FEED } from './automaticas-dados';
import {
  ROTULO_DO_MODELO,
  agruparPorConversa,
  placarDoFeed,
  rotuloDoAutor,
  type GrupoAutomatico,
} from './automaticas-formatos';
import { dataCurta, dataHoraCompleta, hora, rotuloDoDia } from './formatos';

/**
 * A aba "Automáticas": o que o CRM mandou SOZINHO nos últimos sete dias.
 *
 * Rafael, 28/09/2026: "onde e como vemos as mensagens que foram enviadas
 * automáticas? como tá esse processo? deixe isso organizado". A mensagem
 * automática já era distinguível DENTRO da conversa (o balão diz "Texto fixo do
 * robô", "Rascunho da IA", "Confirmação automática") e invisível fora dela: para
 * saber o que o robô mandou ontem, só abrindo conversa por conversa.
 *
 * TRÊS LINHAS, NESTA ORDEM DE LEITURA — e a terceira é a razão de a tela existir:
 *
 *   1. o que saiu (o rótulo do modelo) · para quem · a hora, à direita
 *   2. o texto que saiu, cortado em duas linhas
 *   3. O QUE ACONTECEU DEPOIS, em pastilha
 *
 * Sem a linha 3 isto seria um log, e log ninguém lê. O cruzamento das duas
 * colunas do banco (`respondeu_em` e `gente_falou_em`) é justamente o que mostra
 * o fluxo novo parando no terceiro passo: a campanha manda "Bom dia!", o lead
 * responde, a introdução sai — e ninguém assume.
 *
 * NÃO É UMA FILA. Por isso a aba não tem contador: um número no rótulo diria
 * "trabalho parado", e a maior parte destas linhas não pede nada de ninguém.
 * Quem cobra ação é o Meu dia e a aba "Responderam".
 *
 * O PLACAR DO CABEÇALHO é outra coisa, e é a segunda pergunta do Rafael: "como
 * tá esse processo?". Ele descreve o período inteiro antes da rolagem — quantas
 * saíram, quantas tiveram resposta, quantas estão esperando alguém — porque
 * contar pastilha por pastilha em até 200 linhas não é leitura, é trabalho. Ele
 * mora DENTRO da tela, e não na aba, justamente para não virar cobrança.
 *
 * O cumprimento da campanha não está aqui: ele é `human`, assinado por quem
 * disparou, e mora em /envios. O cabeçalho diz isso, porque quem não achar o
 * "Bom dia!" aqui vai concluir que o feed está quebrado.
 */
export function FeedAutomaticas({
  linhas,
  marcoZero = null,
  aoAbrir,
}: {
  linhas: readonly AutomaticaCrua[];
  /** A data em que o feed passa a contar, quando há uma (ver `carregarMarcoZero`). */
  marcoZero?: string | null;
  /** Abre a conversa daquela mensagem: por ficha quando há, senão pelo fio. */
  aoAbrir: (destino: { organizacaoId: string | null; conversaId: string | null }) => void;
}) {
  // UM CARTÃO POR CONVERSA (29/09/2026). Ver `agruparPorConversa` para o porquê.
  const grupos = useMemo(() => agruparPorConversa(linhas), [linhas]);
  const placar = placarDoFeed(grupos);
  // NO TETO, o placar deixa de falar do período e passa a falar das linhas que
  // couberam. Dizer "200 saíram" numa semana de 900 não é resumo, é número
  // errado — e é o tipo de erro que ninguém percebe, porque o número existe.
  const noTeto = linhas.length >= LIMITE_DO_FEED;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-hairline px-4 py-3">
        <h2 className="font-heading text-base font-medium">O que o CRM mandou sozinho</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Os últimos <span className="numerico">{DIAS_DO_FEED}</span> dias: o cumprimento
          automático, a introdução, o menu do bot, o aviso de fora do horário, os rascunhos da
          IA aprovados e as confirmações de saída. O cumprimento das campanhas não está aqui — ele é
          assinado por quem disparou e mora em{' '}
          {/* O LINK, e não só o nome da tela. A frase já dizia onde estava o
              cumprimento da campanha; quem lê isto está justamente procurando por
              ele, e fazer a pessoa achar o menu depois de ler onde é são dois
              passos para uma resposta que já está na mão. */}
          <Link href="/envios" className="underline underline-offset-2 hover:text-foreground">
            Envios
          </Link>
          .
        </p>

        {/* A DATA DE CORTE, dita. Rafael pediu em 29/09/2026 para tirar da tela o
            menu do bot e o aviso de ausência de 22–24/09 ("funcionava da maneira
            errada"), e o corte é uma data em `app_settings`, não um DELETE: as
            mensagens saíram de verdade e continuam no fio do parceiro, que é o
            registro do que aconteceu. Mas um feed que corta em silêncio mente
            por omissão — "2 saíram nos últimos 7 dias" é falso quando ele só
            olha os últimos dois. Então a tela diz de onde conta. */}
        {marcoZero ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Contando a partir de <span className="numerico">{dataCurta(marcoZero)}</span>. O que
            saiu antes disso continua no fio de cada parceiro — só não entra neste placar.
          </p>
        ) : null}

        {/* O PLACAR — a segunda pergunta do Rafael ("como tá esse processo?"),
            respondida antes da rolagem. A lista sozinha só a responde se a
            pessoa contar pastilha por pastilha, e o feed vai até
            LIMITE_DO_FEED linhas.

            NÃO É UM CONTADOR DE FILA: por isso ele mora DENTRO da tela e não na
            aba. O único número com peso é "esperando alguém", que é o mesmo caso
            que a pastilha pinta de alerta; os outros são volume e desfecho. */}
        {linhas.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {noTeto ? 'Nas ' : ''}
            <span className="numerico text-foreground">{placar.sairam}</span>{' '}
            {noTeto ? 'mais recentes' : placar.sairam === 1 ? 'saiu' : 'saíram'}{' '}
            {/* OS DOIS NÚMEROS, e não um. O fluxo manda três mensagens à mesma
                pessoa: dizer só "6 saíram" faz parecer seis parceiros, e dizer
                só "2 parceiros" esconde o volume que a Meta cobra. */}
            para <span className="numerico text-foreground">{placar.parceiros}</span>{' '}
            {placar.parceiros === 1 ? 'parceiro' : 'parceiros'} ·{' '}
            <span className="numerico text-foreground">{placar.responderam}</span>{' '}
            {placar.responderam === 1 ? 'respondeu' : 'responderam'}
            {placar.esperando > 0 ? (
              <>
                {' '}
                ·{' '}
                <span className="font-medium text-destructive-texto">
                  <span className="numerico">{placar.esperando}</span> esperando alguém
                </span>
              </>
            ) : null}
            {placar.naoSairam > 0 ? (
              <>
                {' '}
                · <span className="numerico">{placar.naoSairam}</span>{' '}
                {placar.naoSairam === 1 ? 'não saiu' : 'não saíram'}
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      {linhas.length === 0 ? (
        <p className="px-4 py-8 text-sm text-muted-foreground">
          O CRM não mandou nada sozinho nos últimos{' '}
          <span className="numerico">{DIAS_DO_FEED}</span> dias.
        </p>
      ) : (
        <ul className="px-2 py-2">
          {grupos.map((grupo, i) => (
            <CartaoDaConversa key={grupo.chave} grupo={grupo} indice={i} aoAbrir={aoAbrir} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Um cartão por conversa: quem é, o que aconteceu, e as mensagens que saíram.
 *
 * O desenho segue o do fio: a bolinha do robô à esquerda, o nome do parceiro em
 * cima (e não o código do modelo, que é detalhe de quem programou), o desfecho
 * UMA vez, e as mensagens embaixo, cada uma com o seu rótulo e a sua hora. Três
 * mensagens da mesma pessoa passaram a custar um cartão, e não três.
 */
function CartaoDaConversa({
  grupo,
  indice,
  aoAbrir,
}: {
  grupo: GrupoAutomatico;
  indice: number;
  aoAbrir: (destino: { organizacaoId: string | null; conversaId: string | null }) => void;
}) {
  const revelar = useRevelarLinha(indice);
  // Quem escreveu de fora da base não tem ficha, e o cartão não pode ficar sem
  // dizer para quem a mensagem foi.
  const paraQuem = grupo.organizacao ?? 'Cliente (não é parceiro)';
  const dia = grupo.quando ? rotuloDoDia(grupo.quando) : null;

  return (
    <li {...revelar} className={revelar.className}>
      <button
        type="button"
        onClick={() =>
          aoAbrir({ organizacaoId: grupo.organizationId, conversaId: grupo.conversationId })
        }
        className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors outline-none active:bg-muted/60 focus-visible:bg-muted/60 md:hover:bg-muted/50"
      >
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <Bot className="size-4.5" />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex min-w-0 items-baseline gap-2">
            {/* O NOME DO PARCEIRO NO LUGAR DO MODELO. Quem abre esta tela
                pergunta "com quem o CRM falou", não "qual template saiu" — o
                template vira uma linha miúda embaixo, onde ele é consulta. */}
            <span className="min-w-0 flex-1 truncate font-medium">{paraQuem}</span>
            {grupo.quando ? (
              <span
                title={dataHoraCompleta(grupo.quando)}
                className="shrink-0 text-xs text-muted-foreground"
              >
                {dia && dia.palavra !== 'hoje' ? (
                  <>
                    {dia.palavra}
                    {dia.numero ? <span className="numerico">{dia.numero}</span> : null}{' '}
                  </>
                ) : null}
                <span className="numerico">{hora(grupo.quando)}</span>
              </span>
            ) : null}
          </span>

          {/* AS MENSAGENS, da mais antiga para a mais nova: é a ordem em que a
              pessoa do outro lado leu, e ler de trás para a frente uma conversa
              de três linhas não ajuda ninguém. */}
          <span className="flex flex-col gap-1">
            {[...grupo.mensagens].reverse().map((m, i) => (
              <span key={m.message_id ?? `${i}`} className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">
                  {(m.modelo ? ROTULO_DO_MODELO[m.modelo] : undefined) ??
                    m.rotulo ??
                    rotuloDoAutor(m.autor)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-foreground/80">
                  {m.corpo}
                </span>
                {m.quando ? (
                  <span
                    className="numerico shrink-0 text-xs text-muted-foreground"
                    title={dataHoraCompleta(m.quando)}
                  >
                    {hora(m.quando)}
                  </span>
                ) : null}
              </span>
            ))}
          </span>

          <span className="flex flex-wrap items-center gap-2">
            {/* UM DESFECHO, DA CONVERSA INTEIRA. Por mensagem, o mesmo parceiro
                aparecia dizendo "Respondeu" numa linha e "Ninguém respondeu" na
                de baixo — as duas verdadeiras, e juntas uma contradição.

                O TOM DE ALERTA SÓ NO CASO QUE PEDE AÇÃO: pintar o desfecho mais
                comum da tela ensinaria a pessoa a ignorar a cor em três dias. */}
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs',
                grupo.desfecho.alerta
                  ? 'bg-destructive/15 font-medium text-destructive-texto'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {grupo.desfecho.texto}
            </span>
            {grupo.atendente ? (
              <span className="text-xs text-muted-foreground">
                Endereçada a {grupo.atendente}
              </span>
            ) : null}
            {grupo.erro ? (
              <span className="truncate text-xs text-muted-foreground">{grupo.erro}</span>
            ) : null}
          </span>
        </span>

        {/* O chevron diz que o cartão LEVA para a conversa: quem vê "esperando
            alguém" precisa de um clique, não de uma segunda tela para procurar. */}
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  );
}
