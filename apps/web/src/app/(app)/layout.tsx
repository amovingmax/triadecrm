import { AppShell } from '@/components/layout/app-shell';
import { requireSession } from '@/lib/auth/session';
import { contarFilasDoMenu } from '@/lib/filas-do-menu';

/**
 * Área autenticada: exige sessão (o proxy já barra antes; aqui é a segunda
 * camada) e monta a casca.
 *
 * A contagem das filas do menu sobe junto com a sessão, em paralelo: é um
 * `count exact, head` que o Postgres resolve pelo índice, e como espera ao lado
 * do `requireSession` não acrescenta uma ida à rede em série. É isso que permite
 * o número aparecer na lateral sem estado de carregamento — ver a regra em
 * `lib/filas-do-menu.ts`. O número de Conversas não vem daqui: ele muda sozinho,
 * e quem o mantém é o aviso de resposta (`components/avisos`).
 */
export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const [sessao, filas] = await Promise.all([requireSession(), contarFilasDoMenu()]);
  return (
    <AppShell sessao={sessao} filas={filas}>
      {children}
    </AppShell>
  );
}
