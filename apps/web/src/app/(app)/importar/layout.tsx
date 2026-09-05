import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';

/** A tela de importação lê os lotes anteriores no cliente, então precisa do TanStack Query. */
export default function LayoutImportar({ children }: { children: React.ReactNode }) {
  return <ProvedorConsultas>{children}</ProvedorConsultas>;
}
