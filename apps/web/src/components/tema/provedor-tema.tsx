'use client';

import { ThemeProvider, useTheme } from 'next-themes';
import { useEffect } from 'react';

/**
 * Cor da barra do navegador (e da barra de status quando o CRM roda instalado),
 * por tema. São os mesmos dois fundos do Ocean Breeze do `globals.css`.
 */
const COR_DA_BARRA = {
  dark: '#0f172a',
  light: '#f0f8ff',
} as const;

/**
 * O `themeColor` do `layout.tsx` é estático e nasce escuro, que é o padrão do
 * produto. Quem troca para o claro precisa que a barra do navegador troque junto,
 * senão a moldura fica escura em volta de uma tela clara. Só mexe no DOM, nunca em
 * estado, então não há segunda renderização nem risco de divergência de hidratação.
 */
function CorDaBarraDoNavegador() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== 'dark' && resolvedTheme !== 'light') return;
    const cor = COR_DA_BARRA[resolvedTheme];
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = cor;
    }
  }, [resolvedTheme]);

  return null;
}

/**
 * Modo claro e escuro do CRM. Os dois existem porque o time usa o celular na rua
 * (claro, sob sol) e no fim do dia (escuro, dentro do carro). O tema entra como
 * classe no <html>, que é o que o `@custom-variant dark` do globals.css espera.
 *
 * `defaultTheme="dark"` porque o escuro é o padrão da direção visual (Ocean Breeze
 * mais o acabamento do template). O claro continua cidadão de primeira classe, a um
 * toque no alternador do cabeçalho, e "Do aparelho" continua na lista para quem
 * quiser seguir o sistema. O next-themes escreve a classe no <html> por script,
 * antes da hidratação, então nada pisca na primeira renderização.
 */
export function ProvedorTema({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      storageKey="komune-crm-tema"
    >
      <CorDaBarraDoNavegador />
      {children}
    </ThemeProvider>
  );
}
