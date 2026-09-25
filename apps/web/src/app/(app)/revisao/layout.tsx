import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';

/** A Revisão busca a fila no cliente: precisa do provedor do TanStack Query. */
export default function LayoutRevisao({ children }: { children: React.ReactNode }) {
  return <ProvedorConsultas>{children}</ProvedorConsultas>;
}
