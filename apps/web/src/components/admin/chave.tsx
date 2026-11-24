'use client';

import { cn } from '@/lib/utils';

/**
 * A chave de ligar e desligar de Ajustes (e da IA que atende).
 *
 * O DESENHO É O DE SEMPRE (44 × 24 px, menta quando ligada); O QUE MUDOU É A
 * CAIXA (24/11/2026, protótipo responsivo da Imova). Até aqui o botão tinha a
 * altura do desenho, 24 px, e um `after` invisível esticava o toque: o dedo
 * acertava, mas o botão medido continuava pequeno, e o leitor de tela e o
 * navegador anunciavam um alvo de 24 px. Agora o botão tem 52 × 44 px e o
 * desenho fica dentro, centrado. Quem põe a chave numa linha usa margem negativa
 * para ela ocupar no layout só o espaço do desenho.
 */
export function Chave({
  id,
  ligada,
  aoMudar,
  desabilitada = false,
  rotulo,
  className,
}: {
  id?: string;
  ligada: boolean;
  aoMudar: (v: boolean) => void;
  desabilitada?: boolean;
  /** Nome para o leitor de tela quando não há `<label htmlFor>` apontando para o `id`. */
  rotulo?: string;
  className?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={ligada}
      aria-label={rotulo}
      disabled={desabilitada}
      onClick={() => aoMudar(!ligada)}
      className={cn(
        'group/chave relative inline-grid h-11 w-13 shrink-0 place-items-center rounded-full outline-none disabled:opacity-50',
        className,
      )}
    >
      <span className="sr-only">{ligada ? 'Ligado' : 'Desligado'}</span>
      <span
        aria-hidden="true"
        className={cn(
          'relative h-6 w-11 rounded-full transition-colors group-focus-visible/chave:ring-3 group-focus-visible/chave:ring-ring/50',
          // Ligado é MENTA (29/09/2026): o interruptor ligado era tinta, e um
          // painel de cinco interruptores pretos lia como cinco "desligados"
          // de relance. Menta é o "sim" da interface.
          ligada ? 'bg-menta' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow transition-transform',
            ligada && 'translate-x-5',
          )}
        />
      </span>
    </button>
  );
}
