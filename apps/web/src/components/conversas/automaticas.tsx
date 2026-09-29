'use client';

import Link from 'next/link';
import { Bot, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useRevelarLinha } from '@/components/movimento';

import type { AutomaticaCrua } from './automaticas-dados';
import { DIAS_DO_FEED, LIMITE_DO_FEED } from './automaticas-dados';
import {
  ROTULO_DO_MODELO,
  placarDoFeed,
  resumoDoQueAconteceu,
  rotuloDoAutor,
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
  const placar = placarDoFeed(linhas);
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
            {noTeto ? 'mais recentes' : placar.sairam === 1 ? 'saiu' : 'saíram'} ·{' '}
            <span className="numerico text-foreground">{placar.responderam}</span>{' '}
            {placar.responderam === 1 ? 'teve resposta' : 'tiveram resposta'}
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
          {linhas.map((linha, i) => (
            <LinhaAutomatica
              key={linha.message_id ?? `${i}`}
              linha={linha}
              indice={i}
              aoAbrir={aoAbrir}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LinhaAutomatica({
  linha,
  indice,
  aoAbrir,
}: {
  linha: AutomaticaCrua;
  indice: number;
  aoAbrir: (destino: { organizacaoId: string | null; conversaId: string | null }) => void;
}) {
  const revelar = useRevelarLinha(indice);
  const desfecho = resumoDoQueAconteceu({
    entrega: linha.entrega,
    respondeuEm: linha.respondeu_em,
    genteFalouEm: linha.gente_falou_em,
  });
  // O rótulo do FLUXO na frente do nome do banco: "GEN-SYS-INTRO" não diz nada
  // para quem atende. Um modelo que o mapa não conhece cai no nome do banco, e
  // um texto livre da IA não tem modelo nenhum — aí sobra quem escreveu.
  const oQue =
    (linha.modelo ? ROTULO_DO_MODELO[linha.modelo] : undefined) ??
    linha.rotulo ??
    rotuloDoAutor(linha.autor);
  // Quem escreveu de fora da base não tem ficha, e a linha não pode ficar sem
  // dizer para quem a mensagem foi.
  const paraQuem = linha.organizacao ?? 'Número fora da base';
  const dia = linha.quando ? rotuloDoDia(linha.quando) : null;

  return (
    <li {...revelar} className={revelar.className}>
      <button
        type="button"
        onClick={() =>
          aoAbrir({ organizacaoId: linha.organization_id, conversaId: linha.conversation_id })
        }
        className="flex w-full min-h-[76px] items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors outline-none active:bg-muted/60 focus-visible:bg-muted/60 md:hover:bg-muted/50"
      >
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <Bot className="size-4.5" />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{oQue}</span>
            {linha.quando ? (
              <span
                title={dataHoraCompleta(linha.quando)}
                className="shrink-0 text-xs text-muted-foreground"
              >
                {dia && dia.palavra !== 'hoje' ? (
                  <>
                    {dia.palavra}
                    {dia.numero ? <span className="numerico">{dia.numero}</span> : null}{' '}
                  </>
                ) : null}
                <span className="numerico">{hora(linha.quando)}</span>
              </span>
            ) : null}
          </span>

          <span className="truncate text-[0.8125rem] text-muted-foreground">{paraQuem}</span>

          {linha.corpo ? (
            <span className="line-clamp-2 text-[0.8125rem] text-foreground/80">{linha.corpo}</span>
          ) : null}

          <span className="mt-1 flex flex-wrap items-center gap-2">
            {/* O TOM DE ALERTA SÓ NO CASO QUE PEDE AÇÃO. Pintar a linha mais
                comum da tela ("ninguém respondeu", que é o desfecho normal)
                ensinaria a pessoa a ignorar a cor em três dias. */}
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs',
                desfecho.alerta
                  ? 'bg-destructive/15 font-medium text-destructive-texto'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {desfecho.texto}
            </span>
            {/* Quem atende a conversa: é para essa pessoa que o item aponta, e
                quem abrir daqui vai encontrá-la no cabeçalho da conversa. */}
            {linha.atendente ? (
              <span className="text-xs text-muted-foreground">
                Endereçada a {linha.atendente}
              </span>
            ) : null}
            {linha.erro ? (
              <span className="truncate text-xs text-muted-foreground">{linha.erro}</span>
            ) : null}
          </span>
        </span>

        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  );
}
