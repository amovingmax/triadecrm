'use client';

import { useState } from 'react';
import { ChevronRight, Loader2, Power, PowerOff, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ICONE_CANAL } from '@/components/conversas/icones';

import { ligarCadencia, mensagemDaRecusa, mensagemDoErro } from './consultas';
import { PassoDaLinha } from './passo-da-cadencia';
import {
  contatosNaCadencia,
  nomeDoCanal,
  quandoOPassoVence,
  type Cadencia,
  type PassoDaCadencia,
} from './tipos';

/**
 * Uma cadência: a ficha em cima, a régua embaixo, o interruptor no canto.
 *
 * Sobre desligar: **não encerra ninguém**. `public.matricular_em_cadencia` já filtra
 * por `is_active`, então desligar fecha a porta de entrada e quem está dentro segue
 * até o fim da régua. A confirmação diz isso com o número de matrículas que
 * continuam correndo — é a diferença entre "parei a cadência" e "parei de matricular",
 * e confundir as duas é o tipo de engano que só aparece três dias depois.
 *
 * Sobre o estado da régua: até 09/09 o cartão dizia "ligada", e "ligada" era verdade
 * sobre a chave e mentira sobre a porta — `matricular_em_cadencia` existia no banco e
 * NINGUÉM a chamava, então nenhuma régua ligada podia receber ninguém. Agora a porta
 * existe (o botão "Matricular"), e o rótulo diz o que a chave realmente controla:
 * **aceitar matrícula nova**. É o que muda quando alguém liga ou desliga, e é a única
 * coisa que muda — quem está dentro segue.
 *
 * Quem não pode ligar nem desligar (a Heloísa é `sdr`) não vê botão nenhum, e quem
 * diz por quê é uma linha só, no alto da tela — repetir "é de gestor ou admin" nos
 * cinco cartões vira ruído sobre uma informação que não muda de cartão para cartão.
 * Botão desabilitado seria pior ainda: o `title` que explicaria o cinza não existe no
 * toque. Nada disso é a autorização — quem decide é a RLS de `cadences`
 * (`USING (is_manager())`), e é justamente por ela que a RPC existe: um UPDATE que não
 * casa com a política devolve zero linhas, sem erro nenhum.
 *
 * ---------------------------------------------------------------------------
 * A RÉGUA FECHADA (29/09/2026)
 * ---------------------------------------------------------------------------
 * Cada cartão abria com TODOS os passos por extenso: condição, código do modelo,
 * nota de janela, contagem. Cinco réguas davam 3.300px de tela, e o que a pessoa
 * queria saber de relance (por onde a régua passa, e se tem gente dentro) ficava
 * enterrado no meio de "só se último desfecho: lig_nao_atendeu". Rafael: "evite
 * muita informação junta, quero algo clean e organizado".
 *
 * Agora o cartão diz, fechado: o nome, se a porta está aberta, o tamanho da régua e
 * a TRILHA — os canais em ordem, numa pílula por passo, com a pílula em menta onde
 * houver gente parada. O detalhe de cada passo continua inteiro, um clique abaixo,
 * em "Ver os passos".
 */
export function CartaoDaCadencia({
  cadencia,
  podeLigarDesligar,
  podeMatricular,
  aoMudar,
  aoMatricular,
}: {
  cadencia: Cadencia;
  podeLigarDesligar: boolean;
  /** `app.pode_matricular()`, lido do banco: admin, gestor e sdr. */
  podeMatricular: boolean;
  /** Recarrega a visão inteira: o interruptor muda contadores de outras seções. */
  aoMudar: () => void;
  /** Abre a escolha de quem entra nesta régua. */
  aoMatricular: () => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const dentro = contatosNaCadencia(cadencia);

  async function alternar() {
    setSalvando(true);
    try {
      const resposta = await ligarCadencia(cadencia.slug, !cadencia.ativa);
      if (!resposta.ok) {
        toast.error(mensagemDaRecusa(resposta.motivo));
        return;
      }
      if (resposta.ativa) {
        toast.success(`${cadencia.nome} ligada. Novas matrículas voltam a entrar.`);
      } else {
        toast.success(
          resposta.matriculasAtivas > 0
            ? `${cadencia.nome} desligada: ninguém novo entra. As ${resposta.matriculasAtivas} matrículas ativas seguem até o fim.`
            : `${cadencia.nome} desligada. Ninguém novo entra.`,
        );
      }
      aoMudar();
    } catch (erro) {
      toast.error(mensagemDoErro(erro));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <article
      id={`cadencia-${cadencia.slug}`}
      className={cn(
        'scroll-mt-20 sombra-base flex flex-col gap-4 rounded-xl bg-card p-5',
        !cadencia.ativa && 'opacity-75',
      )}
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] leading-5 font-semibold tracking-[-0.01em]">
              {cadencia.nome}
            </h3>
            {/* A porta em MENTA quando aberta: é o estado que se quer ver de
                relance, e o único sinal de cor do cartão fechado além da trilha. */}
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                cadencia.ativa
                  ? 'bg-menta-fundo text-menta-texto'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {cadencia.ativa ? 'Aceita matrícula' : 'Fechada para matrícula nova'}
            </span>
          </div>

          <p className="mt-1 text-[13px] text-muted-foreground">
            <span className="numerico">{cadencia.passos.length}</span>
            {cadencia.passos.length === 1 ? ' passo' : ' passos'} · até{' '}
            <span className="numerico">{cadencia.max_toques}</span> toques · encerra em{' '}
            <span className="numerico">D+{cadencia.limite_dias}</span> · funil {cadencia.funil}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {podeMatricular && cadencia.ativa ? (
            <Button
              variant="outline"
              onClick={aoMatricular}
              title={`Escolher quem entra em ${cadencia.nome}.`}
              className="toque h-11 md:h-9"
            >
              <UserPlus aria-hidden="true" />
              Matricular
            </Button>
          ) : null}

          {podeLigarDesligar ? (
            <Button
              variant="outline"
              onClick={() => void alternar()}
              disabled={salvando}
              title={
                cadencia.ativa
                  ? 'Desligar fecha a entrada; quem já está dentro segue até o fim.'
                  : 'Ligar volta a aceitar matrículas novas.'
              }
              className="toque h-11 md:h-9"
            >
              {salvando ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : cadencia.ativa ? (
                <PowerOff aria-hidden="true" />
              ) : (
                <Power aria-hidden="true" />
              )}
              {cadencia.ativa ? 'Desligar' : 'Ligar'}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TrilhaDosPassos passos={cadencia.passos} />
        <p className="shrink-0 text-[13px] text-muted-foreground">
          {dentro > 0 ? (
            <>
              <span className="numerico font-medium text-foreground">
                {cadencia.matriculas.ativas}
              </span>{' '}
              dentro
              {cadencia.matriculas.pausadas > 0 ? (
                <>
                  {' · '}
                  <span className="numerico">{cadencia.matriculas.pausadas}</span> pausadas
                </>
              ) : null}
              {cadencia.matriculas.concluidas > 0 ? (
                <>
                  {' · '}
                  <span className="numerico">{cadencia.matriculas.concluidas}</span> concluídas
                </>
              ) : null}
              {cadencia.matriculas.encerradas > 0 ? (
                <>
                  {' · '}
                  <span className="numerico">{cadencia.matriculas.encerradas}</span> encerradas
                </>
              ) : null}
            </>
          ) : (
            'Ninguém dentro'
          )}
        </p>
      </div>

      <details className="group/passos border-t border-hairline pt-1">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground sm:min-h-9">
          <ChevronRight
            className="size-3.5 shrink-0 transition-transform group-open/passos:rotate-90"
            aria-hidden="true"
          />
          Ver os passos
        </summary>

        <div className="mt-2 flex flex-col gap-3">
          {cadencia.nota_de_entrada || cadencia.exige_autorizacao || cadencia.exige_gancho ? (
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              {cadencia.nota_de_entrada ? <p>Entra aqui quem: {cadencia.nota_de_entrada}</p> : null}
              {cadencia.exige_autorizacao || cadencia.exige_gancho ? (
                <p className="flex flex-wrap gap-1.5">
                  {cadencia.exige_autorizacao ? (
                    <Badge variant="pilula" className="font-normal">
                      exige autorização registrada
                    </Badge>
                  ) : null}
                  {cadencia.exige_gancho ? (
                    <Badge variant="pilula" className="font-normal">
                      exige gancho de gente
                    </Badge>
                  ) : null}
                </p>
              ) : null}
            </div>
          ) : null}

          <ol className="flex flex-col overflow-hidden rounded-lg border border-hairline">
            {cadencia.passos.map((passo, i) => (
              <PassoDaLinha
                key={passo.posicao}
                passo={passo}
                ultimo={i === cadencia.passos.length - 1}
              />
            ))}
          </ol>

          {cadencia.etapa_do_fim ? (
            <p className="text-xs text-muted-foreground">
              Ao encerrar por silêncio, o negócio vai para a etapa &ldquo;{cadencia.etapa_do_fim}
              &rdquo;.
            </p>
          ) : null}

          {cadencia.matriculas.esperando_o_primeiro > 0 ? (
            <p className="text-xs text-muted-foreground">
              <span className="numerico">{cadencia.matriculas.esperando_o_primeiro}</span>{' '}
              matrícula(s) aguardando o primeiro toque abrir.
            </p>
          ) : null}
        </div>
      </details>
    </article>
  );
}

/**
 * A régua de relance: um passo por pílula, na ordem, com o canal escrito.
 *
 * Canal e ordem são as duas coisas que a pessoa pergunta a uma régua ("começa
 * ligando? quando entra o WhatsApp?"), e as duas cabem numa linha. A pílula vira
 * MENTA quando há gente parada naquele passo, com a contagem dentro — é onde a
 * régua pede atenção, e o único lugar onde ela precisa de cor. O resto (quando
 * vence, para quem vale) fica no `title` e, por extenso, em "Ver os passos".
 */
function TrilhaDosPassos({ passos }: { passos: readonly PassoDaCadencia[] }) {
  return (
    <ol aria-label="Os passos, em ordem" className="flex min-w-0 flex-wrap items-center gap-y-2">
      {passos.map((passo, i) => {
        const Icone = ICONE_CANAL[passo.canal];
        const temGente = passo.aqui > 0;
        return (
          <li key={passo.posicao} className="flex items-center">
            {i > 0 ? <span aria-hidden="true" className="h-px w-3 shrink-0 bg-border" /> : null}
            <span
              title={`Passo ${passo.posicao}: ${passo.titulo}. Vence ${quandoOPassoVence(passo)}.`}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs',
                temGente ? 'bg-menta font-medium text-menta-tinta' : 'bg-muted text-muted-foreground',
              )}
            >
              <span className="sr-only">Passo {passo.posicao}: </span>
              <Icone className="size-3.5 shrink-0" aria-hidden="true" strokeWidth={1.75} />
              {nomeDoCanal(passo.canal)}
              {temGente ? (
                <span className="numerico" aria-label={`${passo.aqui} parada(s) aqui`}>
                  {passo.aqui}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
