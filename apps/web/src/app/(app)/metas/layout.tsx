import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';

/** A tela de Metas busca no cliente (uma RPC por pessoa e período); o provedor do TanStack Query vive aqui. */
export default function LayoutMetas({ children }: { children: React.ReactNode }) {
  return <ProvedorConsultas>{children}</ProvedorConsultas>;
}
