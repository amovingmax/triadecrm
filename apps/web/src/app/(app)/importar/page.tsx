import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { podeCriarParceiro } from '@/lib/navegacao';
import {
  ehEntradaPorArquivo,
  podeDesfazerLote,
  type OrigemDeArquivo,
} from '@/components/importacao/tipos';
import { createClient } from '@/lib/supabase/server';
import { TelaImportacao } from '@/components/importacao/tela-importacao';

// O título da aba diz a mesma coisa que o cabeçalho da tela ("Trazer uma lista
// para a base", `tela-importacao.tsx`): o CSV do Google Maps não é planilha, e
// a aba que continuava dizendo "Importar planilha" era a última sobra do nome
// antigo no caminho.
export const metadata: Metadata = { title: 'Trazer uma lista' };

/**
 * Fonte "planilha" do catálogo, se por algum motivo a seed não tiver rodado.
 *
 * O id 8 é a posição da linha `planilha` no `insert` de `supabase/seed.sql:159`
 * sobre a `serial` de `public.sources`. É um palpite de último recurso: num
 * banco em que a seed não rodou, `esteira_abrir_lote` responde `origem_invalida`
 * — que é o certo, e é mensagem de erro na tela, não lote com origem errada.
 */
const ORIGEM_PADRAO: OrigemDeArquivo = {
  id: 8,
  slug: 'planilha',
  nome: 'Planilha (importação)',
};

/**
 * Importar planilha (RF-BAS-07; PRD §11.2 D2; anexo R06 para a proveniência).
 *
 * O servidor faz duas coisas: descobre o papel de quem entrou (para não oferecer
 * uma tela — nem um botão — que o RLS vai recusar; importar e DESFAZER são dois
 * conjuntos de papéis diferentes, §3.7 do laudo) e lista as fontes que entram
 * por arquivo, que é o seletor de origem do lote. Não é mais a `planilha` fixa:
 * o CSV do Google Maps entra pela mesma porta (ADR-08) e precisa ficar
 * registrado como o que é (ADR-12). Ler o arquivo, conferir a prévia e gravar
 * acontece no cliente, contra as funções do Postgres.
 */
export default async function Pagina() {
  const [sessao, supabase] = await Promise.all([requireSession(), createClient()]);

  // `sources_select` é `for select to authenticated using (true)`
  // (`20260904000500:96`): qualquer papel que chegue aqui lê o catálogo.
  const [{ data }, { data: cats }] = await Promise.all([
    supabase.from('sources').select('id, slug, name, config').order('name'),
    // O catálogo de categorias alimenta a tela de resolver os nomes que a fonte
    // usou e o CRM não conhece. São 19 linhas, e `categories_select` é
    // `to authenticated using (true)`: qualquer papel que chegue aqui lê.
    supabase
      .from('categories')
      .select('id, name')
      .eq('is_active', true)
      .order('position')
      .order('name'),
  ]);

  // O filtro é aqui, e não no PostgREST: `config->>entrada_por_arquivo` não é
  // coluna, e o cliente tipado não conhece caminho dentro de jsonb. São treze
  // fontes no catálogo inteiro — filtrar em memória não custa nada.
  const origens: OrigemDeArquivo[] = (data ?? [])
    .filter((f) => ehEntradaPorArquivo(f.config))
    .map((f) => ({ id: f.id, slug: f.slug, nome: f.name }));

  return (
    <TelaImportacao
      podeImportar={podeCriarParceiro(sessao.papel)}
      podeDesfazer={podeDesfazerLote(sessao.papel)}
      origens={origens.length > 0 ? origens : [ORIGEM_PADRAO]}
      categorias={(cats ?? []).map((c) => ({ id: c.id, nome: c.name }))}
    />
  );
}
