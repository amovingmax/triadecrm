import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';

/** A tela de ligar puxa a fila, abre a chamada e tabula no cliente: precisa do TanStack Query. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ProvedorConsultas>{children}</ProvedorConsultas>;
}
