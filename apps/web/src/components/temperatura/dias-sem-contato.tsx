import { cn } from '@/lib/utils';

/**
 * Dias desde o último contato, em IBM Plex Mono. Ao lado da barra térmica, é o par que
 * a Heloísa lê de relance: a cor diz o calor, o número diz o quanto está parado.
 *
 * Mono com `tabular-nums` (utilitário `numerico`) para as colunas alinharem na
 * vertical; a unidade vem menor para o olho cair primeiro no número. A hierarquia é
 * só de tamanho: cor de texto nunca leva `opacity-NN` nem `/NN`, porque a rampa de
 * grafite não tem degrau abaixo do 500 que ainda passe em 4,5:1 no modo claro.
 */
export function DiasSemContato({
  dias,
  className,
  atencao = false,
  curto = false,
}: {
  /** Dias inteiros desde `last_activity_at`. `null` quando nunca houve contato. */
  dias: number | null | undefined;
  className?: string;
  /**
   * `deals.needs_attention`. Pesa a fonte, e só isso: cor cromática nesta interface
   * pertence à escala térmica, e o rótulo em palavra fica no `ChipTemperatura`, que
   * é quem anuncia "esfriando" ao leitor de tela.
   */
  atencao?: boolean;
  /**
   * Troca "sem contato" por um traço curto. Serve ao cartão do celular, onde a frase
   * ocupava 75px fixos ao lado de uma coluna de nome de 219px que já truncava 14 dos
   * 50 nomes. O texto completo continua indo para o leitor de tela e para o `title`.
   */
  curto?: boolean;
}) {
  const { visivel, descricao, mono, vazio } = formatarDiasSemContato(dias);

  return (
    <span
      title={descricao}
      className={cn(
        'inline-flex items-baseline whitespace-nowrap text-muted-foreground',
        // O número é o sinal: fica em 14px e em mono. "hoje", "ontem" e "sem contato"
        // são palavra, não número, e caem para 12px. Poppins é larga, e no cartão do
        // celular "sem contato" em 14px comia a coluna do nome; a hierarquia continua
        // sendo de tamanho, nunca de uma cor de texto mais clara.
        mono ? 'numerico text-sm' : 'text-xs',
        atencao && 'font-medium text-foreground',
        className,
      )}
    >
      <span aria-hidden="true">
        {curto && vazio ? '-' : visivel.numero}
        {visivel.unidade ? <span className="text-[0.8em]">{visivel.unidade}</span> : null}
      </span>
      <span className="sr-only">{descricao}</span>
    </span>
  );
}

/**
 * Regra de texto, separada do componente para poder ser testada e reaproveitada
 * (célula de tabela, ficha, digest). Zero travessão, como manda o guia de cópia.
 */
export function formatarDiasSemContato(dias: number | null | undefined) {
  if (dias === null || dias === undefined || Number.isNaN(dias)) {
    return {
      visivel: { numero: 'sem contato', unidade: '' },
      descricao: 'Sem contato registrado.',
      mono: false,
      vazio: true,
    };
  }

  const inteiro = Math.max(0, Math.trunc(dias));

  if (inteiro === 0) {
    return {
      visivel: { numero: 'hoje', unidade: '' },
      descricao: 'Último contato hoje.',
      mono: false,
      vazio: false,
    };
  }

  if (inteiro === 1) {
    return {
      visivel: { numero: 'ontem', unidade: '' },
      descricao: 'Último contato ontem.',
      mono: false,
      vazio: false,
    };
  }

  return {
    visivel: { numero: String(inteiro), unidade: 'd' },
    descricao: `${inteiro} dias desde o último contato.`,
    mono: true,
    vazio: false,
  };
}
