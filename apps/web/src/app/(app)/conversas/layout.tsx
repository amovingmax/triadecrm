import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';

/** A lista de conversas e a linha do tempo buscam no cliente: precisam do TanStack Query. */
export default function LayoutConversas({ children }: { children: React.ReactNode }) {
  return <ProvedorConsultas>{children}</ProvedorConsultas>;
}
