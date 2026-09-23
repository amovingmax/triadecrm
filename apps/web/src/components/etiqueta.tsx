import { cn } from '@/lib/utils';

/**
 * A etiqueta do parceiro, com a cor dela de verdade.
 *
 * ===========================================================================
 * POR QUE A COR VAI NA PÍLULA INTEIRA, E NÃO NUM PONTINHO
 * ===========================================================================
 * A etiqueta nasceu com um ponto de 8 px ao lado do nome, dentro de uma pílula
 * cinza igual a todas as outras da tela. O resultado é que a cor — a única
 * coisa que faz "fundador" se distinguir de "vip" de relance — ficava com 64
 * pixels de área, e a pílula competia com os selos de etapa, setor e estado,
 * que são cinzas e querem ser cinzas.
 *
 * Aqui a cor pinta o fundo (18%) e o texto (45% misturado com a cor do tema),
 * nos dois temas, pelo `color-mix`: no claro o texto escurece, no escuro ele
 * clareia, e o contraste se mantém sem uma tabela de cores por tema. Continua
 * sendo a cor que o gestor escolheu em Ajustes, não uma paleta inventada aqui.
 *
 * Isso NÃO fere a regra de que cor cromática é temperatura: etiqueta é o único
 * outro lugar onde a cor é dado do banco, escolhido por gente, e não decoração.
 */
export function Etiqueta({
  nome,
  cor,
  className,
}: {
  nome: string;
  /** `tags.color` do banco. Sem cor, a etiqueta fica no cinza do tema. */
  cor?: string | null;
  className?: string;
}) {
  const base = cor ?? 'var(--muted-foreground)';
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-32 shrink-0 items-center truncate rounded-full px-2 text-[11px] leading-none font-medium',
        className,
      )}
      style={{
        backgroundColor: `color-mix(in oklab, ${base} 18%, transparent)`,
        color: `color-mix(in oklab, ${base} 45%, var(--foreground))`,
      }}
    >
      {nome}
    </span>
  );
}
