import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { podeCriarParceiro } from '@/lib/navegacao';
import { createClient } from '@/lib/supabase/server';
import { TelaImportacao } from '@/components/importacao/tela-importacao';

export const metadata: Metadata = { title: 'Importar planilha' };

/** Fonte "planilha" do catálogo, se por algum motivo a seed não tiver rodado. */
const ORIGEM_PADRAO = 8;

/**
 * Importar planilha (RF-BAS-07; PRD §11.2 D2; anexo R06 para a proveniência).
 *
 * O servidor faz duas coisas: descobre o papel de quem entrou (para não oferecer
 * uma tela que o RLS vai recusar) e resolve o id da fonte "planilha", que é o
 * `source_id` do lote em `import_batches`. Ler o arquivo, conferir a prévia e
 * gravar acontece no cliente, contra as funções do Postgres.
 */
export default async function Pagina() {
  const [sessao, supabase] = await Promise.all([requireSession(), createClient()]);

  const { data } = await supabase
    .from('sources')
    .select('id')
    .eq('slug', 'planilha')
    .maybeSingle();

  return (
    <TelaImportacao
      podeImportar={podeCriarParceiro(sessao.papel)}
      origemPlanilhaId={data?.id ?? ORIGEM_PADRAO}
    />
  );
}
