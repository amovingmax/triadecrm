import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';

/** A Admin lê dez tabelas pequenas sob demanda, no cliente: o TanStack Query vive aqui. */
export default function LayoutAdmin({ children }: { children: React.ReactNode }) {
  return <ProvedorConsultas>{children}</ProvedorConsultas>;
}
