import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';

/** O Radar busca no cliente (fila e catálogo de fontes): precisa do provedor do TanStack Query. */
export default function LayoutRadar({ children }: { children: React.ReactNode }) {
  return <ProvedorConsultas>{children}</ProvedorConsultas>;
}
