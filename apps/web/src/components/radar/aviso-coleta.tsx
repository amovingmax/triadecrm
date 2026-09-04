'use client';

import { Unplug } from 'lucide-react';

/**
 * O aviso mais importante desta tela: a coleta automática NÃO está ligada.
 *
 * Não é um erro nem um aviso temporário de sistema — é o estado real do produto
 * hoje, e esconder isso faria a fila vazia parecer defeito. O texto diz o que
 * falta, de quem depende e o que funciona enquanto isso.
 *
 * Sem cor cromática: verde e vermelho aqui significariam temperatura, e não há
 * temperatura nenhuma para ler num aviso.
 */
export function AvisoDeColeta({ fontesLigadas }: { fontesLigadas: number | null }) {
  return (
    <section
      aria-labelledby="radar-aviso-coleta"
      className="flex max-w-3xl gap-3 rounded-lg border border-hairline bg-muted/40 p-4"
    >
      <span
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground"
        aria-hidden="true"
      >
        <Unplug className="size-4" />
      </span>

      <div className="min-w-0 space-y-2">
        <h2 id="radar-aviso-coleta" className="font-heading text-sm font-medium">
          A coleta automática ainda não está ligada
        </h2>

        <p className="text-sm leading-relaxed text-muted-foreground">
          Nenhuma fonte está sendo lida por robô. O{' '}
          <span className="font-medium text-foreground">worker de coleta</span> é o{' '}
          <span className="numerico">D4</span> do calendário e depende de duas coisas que ainda não
          aconteceram: a máquina dedicada no ar (Luiz) e o parecer do advogado sobre o
          Casamentos.com.br (Dennis, PRD §13).
        </p>

        <p className="text-sm leading-relaxed text-muted-foreground">
          Enquanto isso o Radar funciona à mão:{' '}
          <span className="text-foreground">
            o que você achar no Instagram, no Google ou na rua entra por aqui
          </span>{' '}
          e passa pela mesma esteira que o robô vai usar — higiene do dado, checagem de supressão,
          dedup contra a base e revisão. Nada aparece aqui sozinho, e nada vira parceiro sem alguém
          decidir.
        </p>

        {fontesLigadas !== null ? (
          <p className="text-xs text-muted-foreground">
            <span className="numerico">{fontesLigadas}</span> de{' '}
            <span className="numerico">11</span> fontes estão ligadas no catálogo — ligada aqui quer
            dizer <span className="text-foreground">liberada como origem</span>, não “coletando”.
          </p>
        ) : null}
      </div>
    </section>
  );
}
