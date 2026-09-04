'use client';

import { ThemeProvider } from 'next-themes';

/**
 * Modo claro e escuro do CRM. Os dois existem porque o time usa o celular na rua
 * (claro, sob sol) e no fim do dia (escuro, dentro do carro). O tema entra como
 * classe no <html>, que é o que o `@custom-variant dark` do globals.css espera.
 *
 * `defaultTheme="system"` respeita a escolha que a pessoa já fez no aparelho.
 */
export function ProvedorTema({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="komune-crm-tema"
    >
      {children}
    </ThemeProvider>
  );
}
