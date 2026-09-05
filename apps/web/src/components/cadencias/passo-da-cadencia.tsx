'use client';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ICONE_CANAL } from '@/components/conversas/icones';

import {
  condicoesDoPasso,
  nomeDoCanal,
  quandoOPassoVence,
  type PassoDaCadencia,
} from './tipos';

/**
 * Um passo da régua.
 *
 * A linha responde, nesta ordem, às três perguntas que a Heloísa faz olhando para
 * uma cadência: **por onde** (o canal, que no R13 §7 é atributo do passo — é o que
 * deixa a ligação vir primeiro e o WhatsApp virar apoio), **quando** (o atraso, e de
 * onde ele conta) e **para quem** (a condição; quem não bate não recebe o toque, ele
 * nasce pulado e a régua avança).
 *
 * A contagem à direita é o que a tela existe para mostrar: quantas organizações
 * estão paradas neste passo agora. `aqui` é matrícula ativa cujo último passo aberto
 * é este; `pendentes` é toque esperando alguém executar. Os dois são diferentes e os
 * dois importam — pode haver gente parada num passo sem toque pendente (o toque foi
 * feito e o próximo ainda não venceu).
 */
export function PassoDaLinha({ passo, ultimo }: { passo: PassoDaCadencia; ultimo: boolean }) {
  const Icone = ICONE_CANAL[passo.canal];
  const condicoes = condicoesDoPasso(passo.condicao);
  const temGente = passo.aqui > 0 || passo.pendentes > 0;

  return (
    <li
      className={cn(
        'flex items-start gap-3 px-4 py-3',
        !ultimo && 'border-b border-hairline',
        temGente && 'bg-muted/40',
      )}
    >
      {/* A posição é o eixo da leitura: o passo 1 vem antes do 2, sempre. */}
      <span
        className="numerico mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground"
        aria-hidden="true"
      >
        {passo.posicao}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="sr-only">Passo {passo.posicao}: </span>
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Icone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {nomeDoCanal(passo.canal)}
          </span>
          <span className="min-w-0 text-sm text-muted-foreground">{passo.titulo}</span>
        </div>

        <p className="text-xs text-muted-foreground">
          Vence {quandoOPassoVence(passo)}.
          {passo.dica_de_janela ? ` ${passo.dica_de_janela}.` : ''}
        </p>

        {(condicoes.length > 0 || passo.tiers.length > 0 || passo.modelo || passo.audio) && (
          <ul className="flex flex-wrap gap-1.5">
            {condicoes.map((texto) => (
              <li key={texto}>
                <Badge
                  variant="pilula"
                  className="h-auto max-w-full py-0.5 font-normal whitespace-normal"
                >
                  só se {texto}
                </Badge>
              </li>
            ))}
            {passo.tiers.length > 0 ? (
              <li>
                <Badge variant="pilula" className="font-normal">
                  só tier <span className="numerico">{passo.tiers.join(', ')}</span>
                </Badge>
              </li>
            ) : null}
            {passo.modelo ? (
              <li>
                <Badge variant="pilula" className="numerico font-normal">
                  {passo.modelo}
                </Badge>
              </li>
            ) : null}
            {passo.audio ? (
              <li>
                <Badge variant="pilula" className="font-normal">
                  áudio da Heloísa
                </Badge>
              </li>
            ) : null}
            {passo.ultimo_automatico ? (
              <li>
                <Badge variant="pilula" className="font-normal">
                  último toque da régua
                </Badge>
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <ContagemDoPasso passo={passo} />
    </li>
  );
}

/**
 * Quantos contatos estão neste passo.
 *
 * Zero não vira travessão nem some: numa régua que ninguém percorreu ainda, o zero é
 * a informação. O que muda com gente dentro é o peso da tinta.
 */
function ContagemDoPasso({ passo }: { passo: PassoDaCadencia }) {
  const partes: string[] = [];
  if (passo.pendentes > 0) partes.push(`${passo.pendentes} toque(s) esperando execução`);
  if (passo.feitos > 0) partes.push(`${passo.feitos} feito(s)`);
  if (passo.pulados > 0) partes.push(`${passo.pulados} pulado(s) por condição`);

  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
      <p
        className={cn(
          'text-xs',
          passo.aqui > 0 ? 'text-foreground' : 'text-muted-foreground',
        )}
        title={
          partes.length > 0
            ? `${passo.aqui} parada(s) neste passo · ${partes.join(' · ')}`
            : `${passo.aqui} parada(s) neste passo`
        }
      >
        <span className={cn('numerico text-base', passo.aqui > 0 && 'font-medium')}>
          {passo.aqui}
        </span>
        <span className="ml-1 text-muted-foreground">aqui</span>
      </p>
      {passo.pendentes > 0 ? (
        <p className="text-[0.6875rem] text-muted-foreground">
          <span className="numerico">{passo.pendentes}</span> a fazer
        </p>
      ) : null}
      {passo.pulados > 0 ? (
        <p className="text-[0.6875rem] text-muted-foreground">
          <span className="numerico">{passo.pulados}</span> pulados
        </p>
      ) : null}
    </div>
  );
}
