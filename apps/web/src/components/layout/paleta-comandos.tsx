'use client';

import { Plus, Search } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { TEMAS } from '@/components/tema/alternador-tema';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { type AppRole } from '@/lib/auth/role';
import { HREF_NOVO_PARCEIRO, navegacaoPara, podeCriarParceiro } from '@/lib/navegacao';
import { useTeclaMeta } from '@/lib/usar-cliente';
import { cn } from '@/lib/utils';

/**
 * Paleta de comandos (⌘K, ou Ctrl+K fora do Mac): ir para qualquer módulo, abrir o
 * cadastro rápido de parceiro e trocar o tema, sem tirar a mão do teclado. No desktop
 * ela substitui o caminho "olhar a lateral, mirar, clicar"; no celular o botão é só
 * a lupa, porque a navegação de campo é a barra inferior.
 *
 * A lista de módulos é a mesma da lateral e já vem filtrada pelo papel.
 */
export function PaletaComandos({ papel }: { papel: AppRole }) {
  const [aberta, setAberta] = useState(false);
  // A dica de tecla depende do aparelho, então só existe depois da hidratação.
  const teclaMeta = useTeclaMeta();
  const router = useRouter();
  const { setTheme } = useTheme();

  const itens = navegacaoPara(papel);

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key.toLowerCase() !== 'k' || !(evento.metaKey || evento.ctrlKey)) return;
      evento.preventDefault();
      setAberta((estava) => !estava);
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, []);

  /** Fecha antes de navegar: a paleta não pode ficar por cima da tela que ela abriu. */
  const executar = useCallback((acao: () => void) => {
    setAberta(false);
    acao();
  }, []);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setAberta(true)}
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          'toque h-8 gap-2 px-2 text-muted-foreground hover:text-foreground',
          'md:w-64 md:justify-start md:pr-1.5',
        )}
      >
        <Search aria-hidden="true" />
        <span className="hidden md:inline">Buscar ou ir para</span>
        <span className="sr-only md:hidden">Buscar ou ir para</span>
        <kbd
          className="numerico ml-auto hidden h-5 min-w-10 items-center justify-center rounded-lg border px-1.5 text-[11px] md:inline-flex"
          aria-hidden="true"
        >
          {teclaMeta ? `${teclaMeta} K` : ''}
        </kbd>
      </Button>

      <CommandDialog
        open={aberta}
        onOpenChange={setAberta}
        titulo="Paleta de comandos"
        descricao="Busque um módulo ou uma ação e confirme com Enter."
      >
        <CommandInput placeholder="Buscar módulo ou ação" />
        <CommandList>
          <CommandEmpty>
            Nada com esse nome. Busque pelo módulo (parceiros, funis) ou pela ação.
          </CommandEmpty>

          <CommandGroup heading="Ir para">
            {itens.map((item) => {
              const Icone = item.icone;
              return (
                <CommandItem
                  key={item.href}
                  value={item.rotulo}
                  keywords={[item.href.replace('/', ''), item.descricao]}
                  onSelect={() => executar(() => router.push(item.href))}
                >
                  <Icone aria-hidden="true" />
                  <span>{item.rotulo}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    chega no <span className="numerico">{item.dia}</span>
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>

          {podeCriarParceiro(papel) ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Ações">
                <CommandItem
                  value="Novo parceiro"
                  keywords={['cadastrar', 'criar', 'organizacao', 'fornecedor', 'contato']}
                  onSelect={() => executar(() => router.push(HREF_NOVO_PARCEIRO))}
                >
                  <Plus aria-hidden="true" />
                  <span>Novo parceiro</span>
                </CommandItem>
              </CommandGroup>
            </>
          ) : null}

          <CommandSeparator />
          <CommandGroup heading="Aparência">
            {TEMAS.map(({ valor, rotulo, icone: Icone }) => (
              <CommandItem
                key={valor}
                value={`Tema ${rotulo}`}
                keywords={['tema', 'cor', 'claro', 'escuro', 'noite']}
                onSelect={() => executar(() => setTheme(valor))}
              >
                <Icone aria-hidden="true" />
                <span>Tema {rotulo.toLowerCase()}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
