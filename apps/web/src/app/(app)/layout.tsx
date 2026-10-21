import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';
import { AppShell } from '@/components/layout/app-shell';
import { BancoDeOutraEmpresa } from '@/components/layout/banco-de-outra-empresa';
import { requireSession } from '@/lib/auth/session';
import { conferirEmpresaDoBanco } from '@/lib/conferir-empresa';
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
 *
 * A conferência de que o banco é desta empresa (`lib/conferir-empresa.ts`) vai no
 * mesmo `Promise.all`: na primeira tela de cada servidor ela pergunta ao banco, e
 * depois de confirmada não pergunta mais. Banco de outra empresa = o CRM não abre.
 *
 * O cache de consultas (`ProvedorConsultas`) é um só e fica acima da casca, para
 * sobreviver à troca de tela (20/10/2026; o porquê está no próprio provedor).
 */
export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const [sessao, filas, empresa] = await Promise.all([
    requireSession(),
    contarFilasDoMenu(),
    conferirEmpresaDoBanco(),
  ]);
  if (!empresa.ok) return <BancoDeOutraEmpresa empresaDoBanco={empresa.empresaDoBanco} />;
  return (
    <ProvedorConsultas>
      <AppShell sessao={sessao} filas={filas}>
        {children}
      </AppShell>
    </ProvedorConsultas>
  );
}
