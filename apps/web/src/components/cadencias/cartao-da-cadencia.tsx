'use client';

import { useState } from 'react';
import { Loader2, Power, PowerOff } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { ligarCadencia, mensagemDaRecusa, mensagemDoErro } from './consultas';
import { PassoDaLinha } from './passo-da-cadencia';
import { contatosNaCadencia, type Cadencia } from './tipos';

/**
 * Uma cadência: a ficha em cima, a régua embaixo, o interruptor no canto.
 *
 * Sobre desligar: **não encerra ninguém**. `public.matricular_em_cadencia` já filtra
 * por `is_active`, então desligar fecha a porta de entrada e quem está dentro segue
 * até o fim da régua. A confirmação diz isso com o número de matrículas que
 * continuam correndo — é a diferença entre "parei a cadência" e "parei de matricular",
 * e confundir as duas é o tipo de engano que só aparece três dias depois.
 *
 * Quem não pode ligar nem desligar (a Heloísa é `sdr`) não vê botão nenhum, e quem
 * diz por quê é uma linha só, no alto da tela — repetir "é de gestor ou admin" nos
 * cinco cartões vira ruído sobre uma informação que não muda de cartão para cartão.
 * Botão desabilitado seria pior ainda: o `title` que explicaria o cinza não existe no
 * toque. Nada disso é a autorização — quem decide é a RLS de `cadences`
 * (`USING (is_manager())`), e é justamente por ela que a RPC existe: um UPDATE que não
 * casa com a política devolve zero linhas, sem erro nenhum.
 */
export function CartaoDaCadencia({
  cadencia,
  podeLigarDesligar,
  aoMudar,
}: {
  cadencia: Cadencia;
  podeLigarDesligar: boolean;
  /** Recarrega a visão inteira: o interruptor muda contadores de outras seções. */
  aoMudar: () => void;
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
        'scroll-mt-20 overflow-hidden rounded-xl border border-hairline bg-card',
        !cadencia.ativa && 'opacity-75',
      )}
    >
      <header className="flex flex-col gap-3 border-b border-hairline px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading font-medium">{cadencia.nome}</h3>
            <Badge variant="pilula" className="font-normal">
              {cadencia.ativa ? 'ligada' : 'desligada'}
            </Badge>
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
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            <span className="numerico">{cadencia.passos.length}</span>
            {cadencia.passos.length === 1 ? ' passo' : ' passos'}, no máximo{' '}
            <span className="numerico">{cadencia.max_toques}</span> toques · encerra por silêncio em{' '}
            <span className="numerico">D+{cadencia.limite_dias}</span>
            {cadencia.etapa_do_fim ? ` e move para "${cadencia.etapa_do_fim}"` : ''} · funil{' '}
            {cadencia.funil}
          </p>

          <p className="mt-1 text-sm">
            {dentro > 0 ? (
              <>
                <span className="numerico font-medium">{cadencia.matriculas.ativas}</span>{' '}
                {cadencia.matriculas.ativas === 1 ? 'organização dentro' : 'organizações dentro'}
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
              <span className="text-muted-foreground">Nenhuma organização passou por aqui.</span>
            )}
          </p>
        </div>

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
            className="toque h-11 shrink-0 md:h-9"
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
      </header>

      {cadencia.nota_de_entrada ? (
        <p className="border-b border-hairline bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          Entra aqui quem: {cadencia.nota_de_entrada}
        </p>
      ) : null}

      <ol className="flex flex-col">
        {cadencia.passos.map((passo, i) => (
          <PassoDaLinha
            key={passo.posicao}
            passo={passo}
            ultimo={i === cadencia.passos.length - 1}
          />
        ))}
      </ol>

      {cadencia.matriculas.esperando_o_primeiro > 0 ? (
        <p className="border-t border-hairline px-4 py-2 text-xs text-muted-foreground">
          <span className="numerico">{cadencia.matriculas.esperando_o_primeiro}</span> matrícula(s)
          aguardando o primeiro toque abrir.
        </p>
      ) : null}
    </article>
  );
}
