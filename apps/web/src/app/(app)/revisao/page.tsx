import type { Metadata } from 'next';

import { requireRole } from '@/lib/auth/session';
import { PAPEIS_DO_CRM, podeCriarParceiro, podeMandarMensagemAutomatica } from '@/lib/navegacao';
import { carregarCatalogosDoRadar } from '@/components/revisao/catalogos';
import { TelaRevisao } from '@/components/revisao/tela-revisao';

export const metadata: Metadata = { title: 'Revisão' };

/**
 * Revisão (RF-RAD-04, 09, 11, 16; PRD §7.3).
 *
 * A fila de quem ainda não é parceiro, de QUALQUER origem. O nome mudou em
 * 25/09/2026, quando o coletor do Radar saiu: a fila nunca foi a saída do
 * coletor — é a saída de qualquer entrada que não deu certo sozinha, e
 * `public.importacao_gravar` manda linha para cá em cinco casos (sem_candidato,
 * ja_revisado, ja_existe_na_base, categoria_desconhecida, promocao_recusada).
 * Com o CSV do Maps, `categoria_desconhecida` é o que mais vai aparecer.
 *
 * O servidor faz duas coisas: lê os catálogos (categorias, cidades e as 13
 * origens, ligadas e desligadas) e resolve o papel de quem entrou. A fila, a
 * criação e a decisão rodam no cliente, contra as funções do Postgres.
 */
export default async function Pagina() {
  // Admin, gestor e SDR (de 06/10 a 20/10/2026 foi só a gestão). Os papéis antigos ficam fora.
  const [sessao, catalogos] = await Promise.all([
    requireRole(...PAPEIS_DO_CRM),
    carregarCatalogosDoRadar(),
  ]);

  return (
    <TelaRevisao
      catalogos={catalogos}
      podeDecidir={podeCriarParceiro(sessao.papel)}
      podeMandarMensagem={podeMandarMensagemAutomatica(sessao.papel)}
      podeAjustarTriagem={sessao.papel === 'admin' || sessao.papel === 'gestor'}
    />
  );
}
