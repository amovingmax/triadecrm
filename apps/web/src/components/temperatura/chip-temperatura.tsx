import { cn } from '@/lib/utils';

import { definicaoTemperatura, type Temperatura } from './escala-termica';

/**
 * Rótulo textual da temperatura, no preenchimento tênue da própria cor.
 *
 * Existe porque cor sozinha não sobrevive a daltonismo num traço de 3px: no claro o
 * par `quente` contra `cliente` (#c4472b contra #1a9a49) mede 1,35:1 entre si e é a
 * colisão clássica vermelho contra verde, justamente as duas leituras que mudam o
 * comportamento em campo (responder hoje contra fechou). A `BarraTermica` continua
 * sendo a marca de relance; o chip é o reforço que não depende de matiz.
 *
 * É também o único lugar que pinta a escala fora da barra: as três cores saem de
 * `escala-termica.ts` (`--frio-fundo`, `--frio-texto` e cia), nunca de hex na mão.
 * A variante `-texto` é a medida em pelo menos 4,5:1 sobre o próprio chip.
 */
export function ChipTemperatura({
  temperatura,
  className,
  comDescricao = true,
}: {
  temperatura: Temperatura | string | null | undefined;
  className?: string;
  /** Desligue quando o chip já estiver dentro de um alvo com `title` próprio. */
  comDescricao?: boolean;
}) {
  const definicao = definicaoTemperatura(temperatura);

  return (
    <span
      data-temperatura={definicao.valor}
      title={comDescricao ? definicao.descricao : undefined}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs font-medium',
        className,
      )}
      style={{ backgroundColor: definicao.corFundo, color: definicao.corTexto }}
    >
      {definicao.rotulo}
    </span>
  );
}
