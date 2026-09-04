import { cn } from '@/lib/utils';

/**
 * Barra de progresso da meta. NEUTRA, e isso é uma decisão, não um esquecimento:
 * a única cromia da interface é a escala térmica do negócio (frio, morno, quente,
 * cliente, cliente_ativo). Pintar de verde quem bateu a meta e de vermelho quem não
 * bateu inventaria um sexto significado para a cor e apagaria o primeiro — e, do
 * lado humano, transformaria a tela de metas num painel de call center.
 *
 * Quem carrega a informação é a extensão do preenchimento, o número em mono ao lado
 * e a frase embaixo ("faltam 2, ritmo de 0,7 por dia útil").
 *
 * A marca de ritmo é o segundo elemento: um traço fino na fração do período que já
 * passou em dias úteis. Estar à esquerda dela é estar atrás; à direita, adiantado.
 * O traço é tinta com anel na cor da base, então ele aparece tanto sobre o
 * preenchimento quanto sobre o trilho vazio, nos dois temas.
 */
export function BarraProgresso({
  percentual,
  rotulo,
  ritmo,
  grossa = false,
  className,
}: {
  /** 0 a 100; acima de 100 a barra fica cheia (o excedente aparece no texto). */
  percentual: number;
  /** Lido pelo leitor de tela ("Portas abertas: 12 de 15"). */
  rotulo: string;
  /** Fração do período já decorrida em dias úteis (0 a 1); ausente = não desenha. */
  ritmo?: number | null;
  grossa?: boolean;
  className?: string;
}) {
  const largura = Math.max(0, Math.min(100, percentual));
  const marca = typeof ritmo === 'number' && ritmo > 0 && ritmo < 1 ? ritmo * 100 : null;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(largura)}
      aria-label={rotulo}
      className={cn(
        'relative w-full overflow-visible rounded-full bg-muted',
        grossa ? 'h-2.5' : 'h-1.5',
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-out"
        style={{ width: `${largura}%` }}
      />
      {marca !== null ? (
        <span
          aria-hidden="true"
          title="Onde o ritmo do período pede que o número esteja hoje."
          className="absolute -top-1 -bottom-1 w-[2px] rounded-full bg-foreground ring-2 ring-background"
          style={{ left: `calc(${marca}% - 1px)` }}
        />
      ) : null}
    </div>
  );
}
