import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';

/** A lista e a ficha de parceiros buscam no cliente; o provedor do TanStack Query vive aqui. */
export default function LayoutParceiros({ children }: { children: React.ReactNode }) {
  return <ProvedorConsultas>{children}</ProvedorConsultas>;
}
