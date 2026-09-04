import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';

/** A fila e o resumo do dia são buscados no cliente: o provedor do TanStack Query vive aqui. */
export default function LayoutMeuDia({ children }: { children: React.ReactNode }) {
  return <ProvedorConsultas>{children}</ProvedorConsultas>;
}
