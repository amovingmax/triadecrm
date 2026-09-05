import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';

/** As cadências e o resumo são lidos no cliente: o provedor do TanStack Query vive aqui. */
export default function LayoutCadencias({ children }: { children: React.ReactNode }) {
  return <ProvedorConsultas>{children}</ProvedorConsultas>;
}
