import { cn } from '@/lib/utils';

/**
 * A ETAPA NO LUGAR DA TEMPERATURA (28/09/2026, ADR-16).
 *
 * Até hoje o cartão, a lista de parceiros, a lista de conversas e o Meu dia
 * mostravam a TEMPERATURA — e a temperatura é derivada da etapa por
 * `app.compute_temperature`, com uma cor colada em cada etapa na seed
 * (`respondeu` = morno). As 12 etapas do funil fornecedor apareciam, na tela,
 * como três cores. Rafael: "o fato de só o lead responder e ele já virar morno
 * não faz sentido e tá errado".
 *
 * Aqui a etapa volta a ser ela mesma: o NOME, onde a etapa não é o agrupamento
 * da tela, e uma barra NEUTRA de progresso onde ela é (o cartão já vive dentro
 * da coluna da própria etapa — escrever o nome ali repetiria o cabeçalho).
 *
 * O TOTAL É PARÂMETRO, e nunca constante: cada funil tem a sua quantidade de
 * etapas de trabalho (bloco de `stages` da seed), e ela muda — mudou em
 * 07/10/2026, quando "Em conversa" e "Autorizou" saíram. Um número cravado aqui
 * encheria a barra errado.
 *
 * (A barra não é desenhada desde o cartão limpo de 29/09/2026. Se voltar: a
 * POSIÇÃO do banco tem buracos — as etapas aposentadas continuam donas da delas
 * —, então quem a religar deve contar pelo índice na lista de etapas do quadro,
 * e não por `stage_position / total`.)
 *
 * A barra é acromática de propósito. A única cromia do produto continua sendo a
 * escala térmica, que segue existindo nos relatórios: um segundo sistema de cor
 * competindo com ela destruiria os dois.
 */
export function rotuloDaEtapa(etapa: string | null | undefined): string {
  return etapa?.trim() || 'Sem etapa';
}

/** Etapas de trabalho ficam em 1..N; nutrição/perdido/opt-out moram em 90/98/99. */
const PRIMEIRA_POSICAO_DE_SAIDA = 90;

export function preenchimentoDaEtapa(posicao: number | null | undefined, total: number): number {
  if (posicao === null || posicao === undefined) return 0;
  if (posicao >= PRIMEIRA_POSICAO_DE_SAIDA || total <= 0) return 0;
  return Math.min(1, Math.max(0, posicao / total));
}

/** O nome da etapa, onde a tela não agrupa por etapa (listas e Meu dia). */
export function EtiquetaEtapa({ etapa, className }: { etapa: string | null; className?: string }) {
  return (
    <span
      title={etapa ? `Etapa do funil: ${etapa}.` : 'Sem negócio aberto no funil.'}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center overflow-hidden rounded-lg',
        'border border-hairline bg-muted px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        !etapa && 'text-muted-foreground',
        className,
      )}
    >
      {rotuloDaEtapa(etapa)}
    </span>
  );
}

/**
 * A barra da borda esquerda do cartão do funil, no lugar da `BarraTermica`.
 *
 * Ela não repete o nome da etapa: o cartão já vive dentro da coluna dela. O que
 * a coluna não diz é QUÃO LONGE no funil o negócio está — e é só isso que a
 * barra diz, enchendo de baixo para cima.
 */
export function BarraEtapa({
  posicao,
  total,
  className,
}: {
  posicao: number | null;
  total: number;
  className?: string;
}) {
  const cheio = preenchimentoDaEtapa(posicao, total);
  return (
    <span
      aria-hidden="true"
      className={cn('absolute top-0 bottom-0 left-0 w-1 rounded-l-xl bg-hairline', className)}
    >
      <span
        className="absolute bottom-0 left-0 w-full rounded-l-xl bg-muted-foreground/60"
        style={{ height: `${Math.round(cheio * 100)}%` }}
      />
    </span>
  );
}
