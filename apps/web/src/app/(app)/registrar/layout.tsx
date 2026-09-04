import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';

/** A tela de registro busca parceiro e grava no cliente: precisa do TanStack Query. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ProvedorConsultas>{children}</ProvedorConsultas>;
}
