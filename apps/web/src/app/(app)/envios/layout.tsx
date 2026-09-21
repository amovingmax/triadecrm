import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';

/** Os envios são lidos e acompanhados no cliente: o provedor do TanStack Query vive aqui. */
export default function LayoutEnvios({ children }: { children: React.ReactNode }) {
  return <ProvedorConsultas>{children}</ProvedorConsultas>;
}
