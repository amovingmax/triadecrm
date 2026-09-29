'use client';

import { ICONE_CANAL } from '@/components/conversas/icones';
import { NotaRecolhida } from '@/components/ui/nota-recolhida';

import { agendaEmPortugues, vistoHa } from './formatos';
import { nomeDoCanal, type VisaoDasCadencias } from './tipos';

/**
 * O que a máquina faz sozinha, e o que ela NÃO faz.
 *
 * Cada frase sai de um dado real de `public.cadencias_visao()`, e não de texto fixo:
 *
 *  1. o `pg_cron` roda mesmo, e a nota mostra o horário dele;
 *  2. o trabalhador de WhatsApp bateu ponto ou não, e a nota diz quando foi a última
 *     batida em vez de afirmar genericamente que "falta integrar";
 *  3. o modo automático é uma linha em `app_settings`, lida do banco.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NASCE FECHADA, E NO PÉ DA TELA (29/09/2026)
 * ---------------------------------------------------------------------------
 * Até aqui este bloco ABRIA a tela, num cartão com título, três linhas com ícone e
 * um "por que ainda é assim" dentro. A intenção era boa (uma régua cheia de setas
 * sugere um robô que não existe), mas o preço era a primeira dobra inteira gasta
 * numa explicação que a pessoa lê uma vez na vida. Rafael, olhando a tela: "evite
 * muita informação junta, quero algo clean e organizado".
 *
 * A frase que importa todo dia — a cadência abre TAREFA, não manda mensagem —
 * continua a um clique, com todas as letras, na mesma nota recolhida que a Agenda
 * usa para "o que ainda não está ligado". Nada do que estava aqui foi apagado.
 */
export function AvisoDoEnvio({ visao }: { visao: VisaoDasCadencias }) {
  const agendar = visao.agendador.find((j) => j.job === 'cadencias_agendar');
  const silencio = visao.agendador.find((j) => j.job === 'cadencias_encerrar_silencio');
  const wa = visao.envio.worker_whatsapp;

  return (
    <NotaRecolhida titulo="Como a cadência funciona">
      <ul className="flex list-disc flex-col gap-1.5 pl-4">
        <li>
          {agendar ? (
            <>
              A cadência abre <strong className="font-medium text-foreground">tarefa</strong>, nunca
              mensagem: o banco confere as matrículas {agendaEmPortugues(agendar.agenda)} e abre
              uma tarefa quando o passo vence.
              {silencio ? (
                <>
                  {' '}
                  {agendaEmPortugues(silencio.agenda)} ele encerra por silêncio quem passou do
                  limite, sem avisar ninguém do outro lado.
                </>
              ) : null}
            </>
          ) : (
            <>
              O agendador das cadências não está no <span className="numerico">cron</span> deste
              banco: nenhum passo vence sozinho.
            </>
          )}
          {visao.dia_de_operacao ? null : <> Hoje é domingo ou feriado: a régua não roda.</>}
        </li>
        <li>
          {wa.ativo ? (
            <>O envio por WhatsApp está de pé (trabalhador visto {vistoHa(wa.visto_em)}).</>
          ) : (
            <>
              O WhatsApp <strong className="font-medium text-foreground">ainda não sai daqui</strong>
              : nenhum trabalhador bateu ponto ({vistoHa(wa.visto_em)}). Até lá, o toque vira
              tarefa e a mensagem sai à mão.
            </>
          )}
        </li>
        <li>
          Modo automático{' '}
          <strong className="font-medium text-foreground">
            {visao.envio.modo_automatico ? 'ligado' : 'desligado'}
          </strong>
          {visao.envio.modo_automatico
            ? '.'
            : ': quem aprova o primeiro contato e cada resposta é gente.'}
        </li>
        <li>
          Passo, condição e atraso não se editam por esta tela: a régua vive no banco, e a edição
          pelo gestor está prevista para a v1.
        </li>
      </ul>
    </NotaRecolhida>
  );
}

/**
 * Os tetos do dia, por canal (RF-CON-10).
 *
 * É o número que explica por que um toque pronto pode ficar para amanhã, e por isso
 * fica no alto da tela e não escondido em Admin. `hoje` conta por data de
 * vencimento do toque, que é como `app.toques_do_dia` conta. A ordem é a do R13 §7
 * (voz primeiro), decidida no banco.
 *
 * UM CARTÃO POR CANAL (29/09/2026), no mesmo desenho dos cartões do Meu dia: ícone
 * num disco, o número grande e o teto ao lado. Era uma faixa só, dividida por
 * filetes verticais — desenho de tabela, e a única faixa desse tipo que sobrava no
 * CRM. A barra de baixo é a parte do teto já usada, em menta: é a cor de destaque
 * do sistema, e aqui ela diz "quanto do dia já andou", nunca temperatura.
 */
export function TetosDoDia({ visao }: { visao: VisaoDasCadencias }) {
  if (visao.canais.length === 0) return null;

  return (
    <section aria-label="Tetos de toques por canal, hoje">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {visao.canais.map((canal) => {
          const Icone = ICONE_CANAL[canal.canal];
          const usado = canal.teto > 0 ? Math.min(100, Math.round((canal.hoje / canal.teto) * 100)) : 0;
          return (
            <li key={canal.canal} className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-5">
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                  <Icone className="size-3.5" aria-hidden="true" strokeWidth={1.75} />
                </span>
                <span className="truncate">{nomeDoCanal(canal.canal)}</span>
              </p>
              <p className="flex items-baseline gap-1.5">
                <span className="numerico text-[40px] leading-none font-medium tracking-[-0.03em]">
                  {canal.hoje}
                </span>
                <span className="text-sm text-muted-foreground">
                  de <span className="numerico">{canal.teto}</span> hoje
                </span>
              </p>
              <span
                role="progressbar"
                aria-label={`${nomeDoCanal(canal.canal)}: ${canal.hoje} de ${canal.teto} toques hoje`}
                aria-valuenow={usado}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <span className="block h-full rounded-full bg-menta" style={{ width: `${usado}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
