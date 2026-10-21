'use client';

import { Search } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { type AppRole } from '@/lib/auth/role';
import { useTeclaMeta } from '@/lib/usar-cliente';
import { cn } from '@/lib/utils';

/**
 * Paleta de comandos (⌘K, ou Ctrl+K fora do Mac). O que ela mostra e por que está
 * em `paleta-comandos-lista.tsx`.
 *
 * O botão e o atalho ficam aqui, na casca de toda página; a lista, que leva o `cmdk`,
 * é um pedaço à parte (20/10/2026). Ela é baixada quando o navegador fica ocioso
 * depois de a página abrir, ou antes, no primeiro sinal de uso (ponteiro, foco ou
 * toque na lupa). Assim a página nasce sem ela e a primeira abertura não espera.
 */
const carregarLista = () => import('./paleta-comandos-lista');
const ListaDaPaleta = dynamic(() => carregarLista().then((m) => m.ListaDaPaleta), {
  ssr: false,
});

function preCarregar() {
  void carregarLista();
}

export function PaletaComandos({ papel }: { papel: AppRole }) {
  const [aberta, setAberta] = useState(false);
  // A lista só monta na primeira abertura e depois fica montada: é o que deixa o
  // diálogo animar ao fechar.
  const [usada, setUsada] = useState(false);
  // A dica de tecla depende do aparelho, então só existe depois da hidratação.
  const teclaMeta = useTeclaMeta();

  const mudar = useCallback((abrir: boolean) => {
    if (abrir) setUsada(true);
    setAberta(abrir);
  }, []);

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key.toLowerCase() !== 'k' || !(evento.metaKey || evento.ctrlKey)) return;
      evento.preventDefault();
      setUsada(true);
      setAberta((estava) => !estava);
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, []);

  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const pedido = window.requestIdleCallback(preCarregar, { timeout: 5_000 });
      return () => window.cancelIdleCallback(pedido);
    }
    const relogio = window.setTimeout(preCarregar, 2_000);
    return () => window.clearTimeout(relogio);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => mudar(true)}
        // Sinal de que a paleta vai ser aberta: baixa a lista já, se o ocioso ainda
        // não tiver baixado.
        onPointerEnter={preCarregar}
        onFocus={preCarregar}
        onPointerDown={preCarregar}
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          // No celular é só a lupa, e ela precisa dos 44px de alvo de toque; no
          // desktop vira o campo largo com a dica da tecla. O `h-11` vence o `h-7`
          // do tamanho `sm` porque os dois são utilitários de mesma especificidade
          // e o tailwind-merge fica com o último.
          'toque size-11 justify-center gap-2 px-0 text-muted-foreground hover:text-foreground',
          'md:h-8 md:w-64 md:justify-start md:px-2 md:pr-1.5',
        )}
      >
        <Search aria-hidden="true" />
        <span className="hidden md:inline">Buscar ou ir para</span>
        <span className="sr-only md:hidden">Buscar ou ir para</span>
        <kbd
          className="numerico pilula ml-auto hidden h-5 min-w-10 items-center justify-center px-1.5 text-[11px] md:inline-flex"
          aria-hidden="true"
        >
          {teclaMeta ? `${teclaMeta} K` : ''}
        </kbd>
      </Button>

      {usada ? <ListaDaPaleta papel={papel} aberta={aberta} aoMudar={mudar} /> : null}
    </>
  );
}
