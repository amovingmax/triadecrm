import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { podeCriarParceiro } from '@/lib/navegacao';
import { carregarCatalogosDoRadar } from '@/components/radar/catalogos';
import { TelaRadar } from '@/components/radar/tela-radar';

export const metadata: Metadata = { title: 'Radar' };

/**
 * Radar (RF-RAD-01, 04, 09, 11, 16; PRD §7.3; anexo R03).
 *
 * O servidor faz três coisas: lê os catálogos (categorias, cidades e as 11 fontes),
 * traduz `?aba=fontes` na superfície inicial (um link para a regra de uma fonte abre
 * direto nela) e resolve o papel de quem entrou. A fila, a criação e a decisão rodam no cliente,
 * contra as funções do Postgres.
 *
 * O que esta tela NÃO tem, de propósito: nenhum candidato coletado por robô. O
 * worker de coleta é o D4 do calendário e ainda não existe — a tela diz isso em vez
 * de encher a fila com dado inventado.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sessao, catalogos, params] = await Promise.all([
    requireSession(),
    carregarCatalogosDoRadar(),
    searchParams,
  ]);

  return (
    <TelaRadar
      catalogos={catalogos}
      abaInicial={params.aba === 'fontes' ? 'fontes' : 'fila'}
      podeDecidir={podeCriarParceiro(sessao.papel)}
      podeLigarFonte={sessao.papel === 'admin' || sessao.papel === 'gestor'}
    />
  );
}
