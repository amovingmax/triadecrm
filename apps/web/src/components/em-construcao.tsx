import { CalendarClock } from 'lucide-react';

import { Separator } from '@/components/ui/separator';
import { NAVEGACAO } from '@/lib/navegacao';

type Props = {
  titulo: string;
  /** Dia do calendário do PRD §11.2 (ex.: "D3", "D1/D2"). */
  dia: string;
  /** O que o módulo vai fazer, em uma frase (PRD §7). */
  descricao?: string;
};

/**
 * Estado vazio dos módulos que ainda não existem. Não é um cartão de aviso: é a
 * tela do módulo antes de ter conteúdo, com o nome, o que ele vai fazer (PRD §7)
 * e o dia em que chega (PRD §11.2). Assim quem abre entende o lugar onde está.
 *
 * O ícone vem da própria navegação, casando pelo rótulo, para que a tela e o item
 * da lateral nunca mostrem desenhos diferentes do mesmo módulo.
 */
export function EmConstrucao({ titulo, dia, descricao }: Props) {
  const item = NAVEGACAO.find((entrada) => entrada.rotulo === titulo);
  const Icone = item?.icone ?? CalendarClock;
  const frase = descricao ?? item?.descricao;

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-6 md:py-10">
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border text-muted-foreground"
          aria-hidden="true"
        >
          <Icone className="size-4.5" />
        </span>

        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-heading text-xl leading-none font-semibold tracking-tight">
            {titulo}
          </h1>
          <p className="text-xs text-muted-foreground">
            Ainda não construído. Chega no <span className="numerico text-foreground">{dia}</span>.
          </p>
        </div>
      </div>

      {frase ? <p className="max-w-prose text-sm leading-relaxed">{frase}</p> : null}

      <Separator />

      <p className="text-xs leading-relaxed text-muted-foreground">
        Calendário do MVP (PRD §11.2): de{' '}
        <span className="numerico text-foreground">D1, sexta 04/09</span> a{' '}
        <span className="numerico text-foreground">D10, sexta 18/09/2026</span>. Enquanto esta tela
        não chega, o registro segue na planilha-ponte.
      </p>
    </section>
  );
}
