import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BancoDeOutraEmpresa } from '@/components/layout/banco-de-outra-empresa';
import { requireRole } from '@/lib/auth/session';
import { conferirEmpresaDoBanco } from '@/lib/conferir-empresa';
import { EMPRESA } from '@/lib/empresa';
import { PAGINA_PRONTA_DA_INTELIGENCIA, PAPEIS_DA_INTELIGENCIA } from '@/lib/supabase/middleware';

import { AbrirPaginaPronta } from './abrir-pagina-pronta';

export const metadata: Metadata = {
  title: 'Inteligência de mercado',
  robots: { index: false, follow: false },
};

/**
 * A Inteligência de mercado (18/11/2026), só na Imova: a porta do CRM para a página
 * pronta do protótipo (a "opção B" do plano de integração).
 *
 * Fica num grupo de rotas próprio, fora de `(app)`, porque não é uma tela do CRM: é
 * um ambiente à parte, em tela cheia, com o próprio menu e o "Voltar ao CRM". Assim
 * a casca do CRM (lateral, contagens do menu, avisos) nem chega a ser montada. Por
 * estar fora de `(app)`, a conferência de que o banco é desta empresa é feita aqui
 * (e de novo na rota da página pronta).
 *
 * Na KOMUNE a rota não existe (404), como a "IA que atende". Sem login, o proxy já
 * mandou para o login; papel fora da lista vai para `/sem-permissao`. A página pronta
 * em si é entregue por `/inteligencia/painel` (`painel/route.ts`), que confere tudo de
 * novo no servidor, inclusive o perfil no banco, e diz "ainda sem página" quando a
 * cópia ainda não foi publicada.
 *
 * POR QUE NÃO UM `redirect()` DAQUI. O menu adianta as telas (`prefetch` do link e
 * `consultas/adiantar-dados.tsx`). Um `redirect()` no servidor faria o adiantamento
 * seguir até a página pronta, e cada abertura do CRM baixaria quase 1 MB sem ninguém
 * clicar. Aqui o adiantamento leva só esta casca, e quem troca de página é o
 * navegador, depois do clique (`AbrirPaginaPronta`).
 */
export default async function Pagina() {
  if (!EMPRESA.modulos.inteligenciaMercado) notFound();
  await requireRole(...PAPEIS_DA_INTELIGENCIA);
  const empresa = await conferirEmpresaDoBanco();
  if (!empresa.ok) return <BancoDeOutraEmpresa empresaDoBanco={empresa.empresaDoBanco} />;
  return <AbrirPaginaPronta endereco={PAGINA_PRONTA_DA_INTELIGENCIA} />;
}
