import { cn } from '@/lib/utils';

/**
 * A marca "Nova" na linha da lista: conversa com mensagem que esta pessoa ainda
 * não abriu.
 *
 * Janio, 02/10/2026: "quero que para todas as novas mensagens apareçam com uma
 * tag/identidade visual [...] que é uma nova mensagem e que ainda não foi aberta,
 * assim que for aberta essa tag ou identidade visual deve sair".
 *
 * É a mesma menta cheia do selo "Nova mensagem" do cartão (`pilha-de-avisos`):
 * quem viu o cartão reconhece a linha. Sem o ponto pulsando de lá — cinco linhas
 * pulsando na mesma lista é barulho, e a lista fica aberta o dia inteiro.
 *
 * NÃO É O "POR LER". O número branco ao lado conta mensagens e é do time inteiro
 * (`conversations.unread_count`, no banco). Esta marca é de cada pessoa: diz que
 * ELA ainda não abriu, e sai quando ela abre (`provedor-avisos`).
 */
export function MarcaDeNova({ className }: { className?: string }) {
  return (
    <span
      title="Mensagem nova, que você ainda não abriu"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-menta py-px pr-1.5 pl-1 text-[10px] leading-4 font-semibold tracking-[0.04em] text-menta-tinta uppercase',
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-menta-tinta" />
      Nova
    </span>
  );
}

/** A faixa de menta na borda esquerda da linha: a marca que se vê sem ler. */
export function FaixaDeNova() {
  return <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-menta" />;
}
