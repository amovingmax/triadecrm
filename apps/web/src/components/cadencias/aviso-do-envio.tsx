'use client';

import { CircleAlert, Clock, Hand, Send } from 'lucide-react';

import { agendaEmPortugues, vistoHa } from './formatos';
import { nomeDoCanal, type VisaoDasCadencias } from './tipos';

/**
 * O bloco que diz o que a máquina faz sozinha e o que ela NÃO faz.
 *
 * Ele abre a tela de propósito. Uma tela de cadências cheia de passos e setas passa,
 * sem querer, a impressão de que existe um robô mandando mensagem — e hoje não
 * existe. As três frases não são texto decorativo: cada uma sai de um dado real de
 * `public.cadencias_visao()`.
 *
 *  1. o `pg_cron` roda mesmo, e a tela mostra o horário dele;
 *  2. nenhum trabalhador de WhatsApp bateu ponto, e a tela mostra quando foi a última
 *     batida (hoje: nunca) em vez de afirmar genericamente que "falta integrar";
 *  3. o modo automático é uma linha em `app_settings` que o banco RECUSA ligar
 *     (ADR-05) — não é uma promessa de tela.
 *
 * **Cada frase cabe em uma linha, e o porquê fica dentro do `details`.** A primeira
 * versão gastava a dobra inteira do celular com três parágrafos: honestidade que
 * ninguém lê porque empurrou a régua para baixo não é honestidade, é ruído. O aviso
 * tem de caber acima das cadências, no telefone, sem rolar.
 *
 * O tom importa: são duas pessoas usando isto. O bloco informa e não alarma — por
 * isso não usa a cor de destrutivo nem ícone de perigo.
 */
export function AvisoDoEnvio({ visao }: { visao: VisaoDasCadencias }) {
  const agendar = visao.agendador.find((j) => j.job === 'cadencias_agendar');
  const silencio = visao.agendador.find((j) => j.job === 'cadencias_encerrar_silencio');
  const wa = visao.envio.worker_whatsapp;

  return (
    <section
      aria-label="O que a cadência faz sozinha"
      className="flex flex-col gap-2.5 rounded-xl border border-hairline bg-card px-4 py-3.5"
    >
      <h2 className="font-heading text-sm font-medium">A cadência agenda. Quem manda é gente.</h2>

      <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
        <Linha icone={<Clock className="size-4" aria-hidden="true" />}>
          {agendar ? (
            <>
              Ela abre <strong className="font-medium text-foreground">tarefa</strong>, nunca
              mensagem — {agendaEmPortugues(agendar.agenda)}.
            </>
          ) : (
            <>
              O agendador das cadências não está no <span className="numerico">cron</span> deste
              banco: nenhum passo vence sozinho.
            </>
          )}
        </Linha>

        <Linha icone={<Send className="size-4" aria-hidden="true" />}>
          {wa.ativo ? (
            <>
              Envio por WhatsApp de pé (trabalhador visto {vistoHa(wa.visto_em)}).
            </>
          ) : (
            <>
              Envio por WhatsApp{' '}
              <strong className="font-medium text-foreground">ainda não sai daqui</strong>: depende
              da Meta.
            </>
          )}
        </Linha>

        <Linha icone={<Hand className="size-4" aria-hidden="true" />}>
          Modo automático{' '}
          <strong className="font-medium text-foreground">
            {visao.envio.modo_automatico ? 'ligado' : 'desligado'}
          </strong>{' '}
          por decisão do projeto ({visao.envio.modo_automatico_decisao}).
        </Linha>
      </ul>

      <details className="text-xs text-muted-foreground">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 sm:min-h-8">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="underline underline-offset-4">Por que ainda é assim</span>
        </summary>
        <ul className="mt-1 flex list-disc flex-col gap-1.5 pl-8 sm:pl-5">
          {agendar ? (
            <li>
              O banco confere as matrículas {agendaEmPortugues(agendar.agenda)} e abre uma tarefa
              quando o passo vence.
              {silencio ? (
                <> {agendaEmPortugues(silencio.agenda)} ele encerra por silêncio quem passou do
                limite — sem avisar ninguém do outro lado.</>
              ) : null}
              {visao.dia_de_operacao ? null : (
                <> Hoje é domingo ou feriado: a régua não roda, por regra.</>
              )}
            </li>
          ) : null}
          <li>
            A mensagem de WhatsApp depende do número aprovado na Meta e do trabalhador que fala com
            a Cloud API.{' '}
            {wa.ativo
              ? `O trabalhador está de pé, visto ${vistoHa(wa.visto_em)}.`
              : `Nenhum trabalhador bateu ponto (${vistoHa(wa.visto_em)}); até lá o toque vira tarefa e a mensagem sai à mão.`}
          </li>
          <li>
            O modo automático (RF-CON-09) está fora do MVP: quem aprova o primeiro contato e cada
            resposta é gente ({visao.envio.modo_automatico_decisao}). O banco recusa ligar essa
            chave.
          </li>
          <li>
            Passo, condição e atraso não se editam por esta tela: a régua vive nas migrações do
            banco, e a edição pelo gestor está prevista para a v1 (RF-ADM-02).
          </li>
        </ul>
      </details>
    </section>
  );
}

function Linha({ icone, children }: { icone: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icone}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * Os tetos do dia, por canal (RF-CON-10).
 *
 * É o número que explica por que um toque pronto pode ficar para amanhã, e por isso
 * fica ao lado do aviso e não escondido em Admin. `hoje` conta por data de
 * vencimento do toque, que é como `app.toques_do_dia` conta. A ordem é a do R13 §7
 * (voz primeiro), decidida no banco.
 */
export function TetosDoDia({ visao }: { visao: VisaoDasCadencias }) {
  if (visao.canais.length === 0) return null;

  return (
    <section aria-label="Tetos de toques por canal, hoje">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {visao.canais.map((canal) => (
          <li
            key={canal.canal}
            className="flex flex-col gap-1 rounded-lg border border-hairline bg-card px-3 py-2.5"
          >
            <p className="truncate text-xs text-muted-foreground">{nomeDoCanal(canal.canal)}</p>
            <p className="flex items-baseline gap-1.5">
              <span className="numerico text-2xl leading-none font-medium">{canal.hoje}</span>
              <span className="text-xs text-muted-foreground">
                de <span className="numerico">{canal.teto}</span> hoje
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
