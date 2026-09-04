import { CalendarClock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
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
 *
 * Paleta da repaginação: nada de cor cromática (aqui não há temperatura para ler),
 * a moldura do ícone na base muted com hairline, o dia numa pílula e a divisória
 * na linha translúcida do sistema, e não numa borda cheia.
 */
export function EmConstrucao({ titulo, dia, descricao }: Props) {
  const item = NAVEGACAO.find((entrada) => entrada.rotulo === titulo);
  const Icone = item?.icone ?? CalendarClock;
  const frase = descricao ?? item?.descricao;

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-6 md:py-10">
      <div className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <Icone className="size-4.5" />
        </span>

        <div className="flex min-w-0 flex-col items-start gap-2">
          <h1 className="font-heading text-xl leading-none font-semibold tracking-tight">
            {titulo}
          </h1>
          {/* Envolve em vez de cortar: em 320px de largura o chip cai para a linha
              de baixo, e nunca some atrás do `overflow-hidden` do Badge. */}
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            Ainda não construído.
            <Badge variant="pilula" className="h-6 gap-1.5 px-2.5 text-[11px] font-normal">
              <CalendarClock className="text-muted-foreground" aria-hidden="true" />
              chega no <span className="numerico">{dia}</span>
            </Badge>
          </p>
        </div>
      </div>

      {frase ? <p className="max-w-prose text-sm leading-relaxed">{frase}</p> : null}

      <div className="h-px w-full bg-hairline" role="presentation" />

      <p className="text-xs leading-relaxed text-muted-foreground">
        Calendário do MVP (PRD §11.2): de{' '}
        <span className="numerico text-foreground">D1, sexta 04/09</span> a{' '}
        <span className="numerico text-foreground">D10, sexta 18/09/2026</span>. Enquanto esta tela
        não chega, o registro segue na planilha-ponte.
      </p>
    </section>
  );
}
