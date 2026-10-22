import { SeletorDeEmpresa } from '@/components/layout/seletor-de-empresa';
import { DESTINOS_DO_SELETOR, destinosDaPessoa } from '@/lib/empresa';
import { lerMinhasOutrasEmpresas } from '@/lib/outras-empresas';

/**
 * O botão de trocar de empresa, já recortado para quem está logado.
 *
 * Saber se a pessoa entra na outra empresa é perguntar ao servidor de lá
 * (`lib/outras-empresas.ts`), uma ida à rede que pode demorar. Por isso este pedaço
 * chega depois do resto do cabeçalho, dentro de um `Suspense` sem esqueleto: a tela
 * nunca espera pela outra empresa, e o botão aparece quando a resposta chega.
 */
export async function SeletorDaPessoa() {
  if (DESTINOS_DO_SELETOR.length === 0) return null;
  const outras = await lerMinhasOutrasEmpresas();
  return <SeletorDeEmpresa destinos={destinosDaPessoa(DESTINOS_DO_SELETOR, outras)} />;
}
