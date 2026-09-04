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
 * O quadro é o das telas construídas: `flex w-full flex-col gap-4`, h1 de 24px e o
 * mesmo par título/subtítulo de `TelaParceiros`. Sete das oito rotas da lateral são
 * esta tela até o D10, então é ela que dita o ritmo do app — e com o `mx-auto
 * max-w-2xl` antigo o título saltava 304px para a direita e encolhia 4px a cada
 * clique da navegação. Uma âncora só (a goteira esquerda do conteúdo), e o
 * `max-w-2xl` fica apenas para segurar a medida de leitura.
 *
 * Sem a moldura de ícone que existia aqui: ela empurrava o h1 mais 48px para dentro,
 * e o desenho do módulo já está aceso ao lado, no item ativo da navegação. O que
 * esta tela tem de dizer é o nome, o que vem e quando.
 *
 * Paleta da repaginação: nada de cor cromática (aqui não há temperatura para ler),
 * o dia numa pílula e a divisória na linha translúcida do sistema, nunca numa borda
 * cheia.
 */
export function EmConstrucao({ titulo, dia, descricao }: Props) {
  const item = NAVEGACAO.find((entrada) => entrada.rotulo === titulo);
  const frase = descricao ?? item?.descricao;

  return (
    <section className="flex w-full max-w-2xl flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{titulo}</h1>
        {/* Envolve em vez de cortar: em 320px de largura o chip cai para a linha
            de baixo, e nunca some atrás do `overflow-hidden` do Badge. */}
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          Ainda não construído.
          <Badge variant="pilula" className="h-6 gap-1.5 px-2.5 text-[11px] font-normal">
            <CalendarClock className="text-muted-foreground" aria-hidden="true" />
            chega no <span className="numerico">{dia}</span>
          </Badge>
        </p>
      </header>

      {frase ? <p className="max-w-prose text-sm leading-relaxed">{frase}</p> : null}

      <div className="mt-1 h-px w-full bg-hairline" role="presentation" />

      {/* O mono fecha só em volta de número: "sexta" é palavra e fica na Poppins do
          resto da frase, senão o dia da semana aparece com o traço e o espaçamento
          da IBM Plex Mono no meio de uma linha de texto corrido. */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Calendário do MVP (PRD §11.2): de{' '}
        <span className="text-foreground">
          <span className="numerico">D1</span>, sexta <span className="numerico">04/09</span>
        </span>{' '}
        a{' '}
        <span className="text-foreground">
          <span className="numerico">D10</span>, sexta <span className="numerico">18/09/2026</span>
        </span>
        . Enquanto esta tela não chega, o registro segue na planilha-ponte.
      </p>
    </section>
  );
}
