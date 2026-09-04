import { MessageSquareDashed } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * O que esta tela ainda NÃO faz, dito na própria tela.
 *
 * O RF-CON-05 promete um inbox de WhatsApp. Ele depende de três coisas que não estão
 * no código: a verificação do CNPJ da Komune no Meta Business, o Coexistence do número
 * "Heloísa · Komune" e a aprovação dos modelos de mensagem (RF-CON-02, anexo R04 §2 e
 * §5). Nenhuma delas é trabalho de front-end e nenhuma tem data garantida: a
 * verificação de empresa na Meta leva semanas.
 *
 * Enquanto isso, o honesto é dizer isso aqui, no lugar onde a pessoa esperaria as
 * mensagens, e não inventar uma caixa de entrada com conversa de mentira. O texto
 * também diz o que acontece depois, porque quem lê precisa saber que o que ela
 * registra hoje não vai ser jogado fora.
 *
 * Sem cor cromática: a escala térmica é a única cromia da interface, e um aviso não
 * tem temperatura. Ele é hairline, base e texto secundário.
 */
export function AvisoWhatsapp({
  compacto = false,
  className,
}: {
  /** No cabeçalho da conversa o aviso vira uma linha só; na tela vazia ele é inteiro. */
  compacto?: boolean;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        'flex gap-3 rounded-xl border border-hairline bg-card/50 px-3 py-2.5',
        className,
      )}
    >
      <MessageSquareDashed
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-1">
        <p className="text-sm leading-snug font-medium">
          As mensagens de WhatsApp ainda não chegam aqui.
        </p>
        {/* Duas versões, e não uma frase com remendo no meio: no celular esta caixa
            fica logo acima da linha do tempo, e o texto inteiro empurrava o primeiro
            evento para fora da tela. A versão curta diz a mesma coisa em três linhas. */}
        {compacto ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            O número <span className="text-foreground">Heloísa &middot; Komune</span> espera
            a verificação do CNPJ no Meta Business e a aprovação dos modelos de mensagem.
            Quando sair, cada mensagem entra nesta mesma coluna.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            O número <span className="text-foreground">Heloísa &middot; Komune</span> depende
            da verificação do CNPJ da Komune no Meta Business e da aprovação dos modelos de
            mensagem, que levam semanas e não dependem do CRM. Até lá, esta coluna mostra o
            que o time registra à mão: ligação, visita, reunião, nota e cada mudança de
            etapa, com quem fez e o desfecho. Quando o número for aprovado, cada mensagem
            enviada e recebida entra nesta mesma coluna, na mesma ordem, sem apagar nada do
            que já está registrado.
          </p>
        )}
      </div>
    </aside>
  );
}
