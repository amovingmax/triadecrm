'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMontado } from '@/lib/usar-cliente';

/**
 * Os três temas, num lugar só: o alternador do cabeçalho e a paleta de comandos
 * leem desta lista, para que o rótulo seja o mesmo nos dois.
 */
export const TEMAS = [
  { valor: 'light', rotulo: 'Claro', icone: Sun },
  { valor: 'dark', rotulo: 'Escuro', icone: Moon },
  { valor: 'system', rotulo: 'Do aparelho', icone: Monitor },
] as const satisfies readonly { valor: string; rotulo: string; icone: LucideIcon }[];

/**
 * Troca de tema no cabeçalho. Discreto de propósito: um ícone, sem rótulo, à
 * esquerda do usuário. O time usa o celular no sol (claro) e no fim do dia,
 * dentro do carro (escuro), então a troca precisa estar a um toque.
 *
 * O tema real só é conhecido depois da hidratação (o next-themes escreve a classe
 * no <html> por script, antes do React). Até lá o botão renderiza o ícone neutro
 * e fica desabilitado: assim nada pisca nem diverge entre servidor e navegador.
 */
export function AlternadorTema() {
  const { theme, setTheme } = useTheme();
  const montado = useMontado();

  const atual = TEMAS.find((t) => t.valor === theme) ?? TEMAS[2];
  const Icone = montado ? atual.icone : Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="toque text-muted-foreground hover:text-foreground"
          disabled={!montado}
          aria-label={montado ? `Tema: ${atual.rotulo}. Trocar tema` : 'Trocar tema'}
        >
          <Icone aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {TEMAS.map(({ valor, rotulo, icone: IconeItem }) => (
          <DropdownMenuItem
            key={valor}
            onSelect={() => setTheme(valor)}
            aria-checked={theme === valor}
            className={theme === valor ? 'font-medium' : undefined}
          >
            <IconeItem aria-hidden="true" />
            {rotulo}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
