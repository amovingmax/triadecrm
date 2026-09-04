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
 *
 * `esfriando` (`deals.needs_attention`) entra no PRÓPRIO rótulo, em texto. Antes esse
 * estado existia só como espessura da barra térmica (3px contra 6px) e não chegava a
 * leitor de tela nenhum: comparar duas espessuras de traço a 16px da borda da linha,
 * no sol, é justamente o que decide quem a Heloísa procura hoje. Em palavra ele
 * sobrevive ao daltonismo, ao sol e ao leitor de tela.
 */
export function ChipTemperatura({
  temperatura,
  className,
  comDescricao = true,
  esfriando = false,
}: {
  temperatura: Temperatura | string | null | undefined;
  className?: string;
  /** Desligue quando o chip já estiver dentro de um alvo com `title` próprio. */
  comDescricao?: boolean;
  /** `deals.needs_attention`: acrescenta "esfriando" ao rótulo. */
  esfriando?: boolean;
}) {
  const definicao = definicaoTemperatura(temperatura);
  const descricao = esfriando
    ? `${definicao.descricao} Esfriando por falta de contato.`
    : definicao.descricao;

  return (
    <span
      data-temperatura={definicao.valor}
      data-atencao={esfriando ? '' : undefined}
      title={comDescricao ? descricao : undefined}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1.5 overflow-hidden rounded-lg px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
      style={{ backgroundColor: definicao.corFundo, color: definicao.corTexto }}
    >
      {/* Uma string só, dentro de um chip `whitespace-nowrap`: o "·" não é item de
          layout e não tem como sobrar sozinho no fim de uma linha. */}
      {esfriando ? `${definicao.rotulo} · esfriando` : definicao.rotulo}
    </span>
  );
}
