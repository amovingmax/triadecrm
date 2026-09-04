'use client';

import { prepararConsulta } from '@/components/parceiros/busca';
import { createClient } from '@/lib/supabase/client';

import { diaEmFortaleza, instanteEmFortaleza, MAX_SUGESTOES } from './tipos';
import type { AlvoDoRegistro, OrigemDoAlvo, SugestaoDeAlvo } from './tipos';

/**
 * De onde a tela tira o parceiro do passo 1.
 *
 * A busca por texto é a MESMA `public.search_organizations` da tela de Parceiros
 * (RPC `security definer`, com telefone mascarado por papel e o ranking por nome,
 * telefone, @instagram, CNPJ e bairro): `prepararConsulta` é importado de
 * `components/parceiros/busca` justamente para as duas telas normalizarem o que a
 * pessoa digita do mesmo jeito. Aqui a RPC é usada só pelo id e pela ORDEM que ela
 * devolve; o resto de cada linha sai da hidratação abaixo, que é o que a tela de
 * registro precisa e a lista de parceiros não: o negócio, a etapa, a janela de
 * recontato e o `do_not_contact`.
 */

/** Colunas da linha do negócio aberto, com o nome da etapa embutido pela FK. */
const COLUNAS_NEGOCIO =
  'id, organization_id, pipeline_id, stage_id, status, temperature, needs_attention, last_activity_at, stages(name)';

type LinhaNegocio = {
  id: string;
  organization_id: string;
  pipeline_id: number;
  stage_id: number;
  status: string;
  temperature: AlvoDoRegistro['temperatura'];
  needs_attention: boolean;
  last_activity_at: string | null;
  stages: { name: string } | null;
};

/** A janela de recontato só existe enquanto está aberta; vencida, é `null`. */
function cooldownAberto(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const fim = Date.parse(iso);
  return Number.isNaN(fim) || fim <= Date.now() ? null : iso;
}

function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  const quando = Date.parse(iso);
  if (Number.isNaN(quando)) return null;
  return Math.max(0, Math.floor((Date.now() - quando) / 86_400_000));
}

/**
 * Completa uma lista de ids de organização com tudo o que o registro precisa saber
 * antes de gravar. Três consultas em paralelo, todas sob a RLS de quem está logado:
 *
 * - `organizations_view` (e não `organizations`: a política `organizations_select` é
 *   `is_manager() or reads_base_pii()`, e a Heloísa é `sdr`, que não é nenhum dos dois);
 * - `deals` do funil, com a etapa embutida — é o `deal_id` e o `stage_id` que viajam
 *   como `p_deal_id` e `p_expected_stage_id` e pegam duas pessoas mexendo no mesmo
 *   negócio;
 * - `v_contact_cooldown`, a janela de recontato do RF-FUN-13.
 *
 * A ordem de `ids` é preservada: quem manda na ordenação é a RPC de busca (ranking)
 * ou a fila do dia, nunca esta função.
 */
export async function hidratarAlvos(ids: readonly string[]): Promise<AlvoDoRegistro[]> {
  if (ids.length === 0) return [];
  const supabase = createClient();
  const lista = [...ids];

  const [orgs, negocios, cooldowns] = await Promise.all([
    supabase
      .from('organizations_view')
      .select(
        'id, name, neighborhood, city_name, primary_category_name, temperature, do_not_contact',
      )
      .in('id', lista),
    // Sem filtro por status DE PROPÓSITO: um negócio perdido ou em opt-out precisa
    // aparecer COMO perdido no cabeçalho do registro. Filtrando por `open`, a ficha
    // que ela acabou de dar como perdida voltaria à lista como se não tivesse funil
    // nenhum: sem etapa, sem dias sem contato e com a barra da organização.
    supabase.from('deals').select(COLUNAS_NEGOCIO).in('organization_id', lista),
    supabase
      .from('v_contact_cooldown')
      .select('organization_id, cooldown_until, blocked_forever')
      .in('organization_id', lista),
  ]);

  const porNegocio = new Map<string, LinhaNegocio>();
  for (const linha of (negocios.data ?? []) as unknown as LinhaNegocio[]) {
    // Uma organização pode ter negócio em mais de um funil (fornecedor e produtor).
    // Ganha o negócio ABERTO; entre dois do mesmo status, o mais recentemente tocado,
    // que é o que ela está trabalhando.
    const atual = porNegocio.get(linha.organization_id);
    const melhor =
      !atual ||
      (linha.status === 'open' && atual.status !== 'open') ||
      (linha.status === atual.status &&
        (linha.last_activity_at ?? '') > (atual.last_activity_at ?? ''));
    if (melhor) porNegocio.set(linha.organization_id, linha);
  }
  const porCooldown = new Map((cooldowns.data ?? []).map((c) => [c.organization_id, c] as const));
  const porOrg = new Map((orgs.data ?? []).map((o) => [o.id, o] as const));

  return lista.flatMap((id) => {
    const org = porOrg.get(id);
    if (!org) return [];
    const negocio = porNegocio.get(id);
    const cooldown = porCooldown.get(id);
    return [
      {
        id,
        nome: org.name,
        bairro: org.neighborhood,
        cidade: org.city_name,
        categoria: org.primary_category_name,
        temperatura: negocio?.temperature ?? org.temperature,
        etapa: negocio?.stages?.name ?? null,
        etapaId: negocio?.stage_id ?? null,
        dealId: negocio?.id ?? null,
        pipelineId: negocio?.pipeline_id ?? null,
        diasSemContato: diasDesde(negocio?.last_activity_at ?? null),
        precisaAtencao: negocio?.needs_attention ?? false,
        cooldownAte: cooldownAberto(cooldown?.cooldown_until),
        bloqueado: cooldown?.blocked_forever ?? false,
        naoContatar: org.do_not_contact,
      } satisfies AlvoDoRegistro,
    ];
  });
}

/** Um parceiro só, para o link direto `/registrar?org=<id>` vindo da ficha. */
export async function carregarAlvo(id: string): Promise<AlvoDoRegistro | null> {
  const [alvo] = await hidratarAlvos([id]);
  return alvo ?? null;
}

/** Resultado da busca por texto, na ordem da RPC. */
export async function buscarAlvos(texto: string): Promise<SugestaoDeAlvo[]> {
  const consulta = prepararConsulta(texto);
  if (!consulta) return [];

  const supabase = createClient();
  const { data, error } = await supabase.rpc('search_organizations', {
    q: consulta,
    p_limit: MAX_SUGESTOES,
  });
  if (error) throw new Error(error.message);

  // A RPC devolve todas as colunas da lista de Parceiros; aqui só interessam o id e a
  // ORDEM (o ranking por nome, telefone, @, CNPJ e bairro), e o resto vem da hidratação.
  const ids = ((data ?? []) as unknown as { id: string }[]).map((linha) => linha.id);
  const alvos = await hidratarAlvos(ids);
  return alvos.map((alvo) => ({ ...alvo, origem: 'busca' as OrigemDoAlvo, motivo: null }));
}

/**
 * A lista "Agora": o que ela ia fazer mesmo sem esta tela.
 *
 * Primeiro as tarefas de hoje que são dela (`tasks_select` já filtra por
 * `assignee_id`, então nem precisa de cláusula extra — mas ela vai explícita, para a
 * consulta continuar certa se a política mudar); depois os últimos parceiros que ela
 * registrou, que é o caminho de quem visita três lojas na mesma rua.
 */
export async function carregarSugestoes(usuarioId: string): Promise<SugestaoDeAlvo[]> {
  const supabase = createClient();
  const fimDeHoje = instanteEmFortaleza(diaEmFortaleza(new Date()), 23);

  const [tarefas, recentes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, organization_id, due_at')
      .eq('assignee_id', usuarioId)
      .eq('status', 'todo')
      .not('organization_id', 'is', null)
      .lte('due_at', fimDeHoje)
      .order('due_at')
      .limit(MAX_SUGESTOES),
    supabase
      .from('activities')
      .select('organization_id, occurred_at')
      .eq('user_id', usuarioId)
      .not('organization_id', 'is', null)
      .order('occurred_at', { ascending: false })
      .limit(30),
  ]);

  const motivo = new Map<string, string>();
  const ordem: string[] = [];
  const origem = new Map<string, OrigemDoAlvo>();

  for (const t of tarefas.data ?? []) {
    const org = t.organization_id;
    if (!org || motivo.has(org)) continue;
    motivo.set(org, t.title);
    origem.set(org, 'tarefa');
    ordem.push(org);
  }
  for (const a of recentes.data ?? []) {
    const org = a.organization_id;
    if (!org || origem.has(org) || ordem.length >= MAX_SUGESTOES) continue;
    origem.set(org, 'recente');
    ordem.push(org);
  }

  // Fundo de fila: quando não há tarefa marcada para hoje nem registro recente, a
  // tela não pode abrir vazia. Mostra quem está há mais tempo sem contato, que é o
  // estado da base hoje e é a fila de campo mais honesta que existe sem inventar
  // ordenação nova (`deals.last_activity_at` é o mesmo dado da coluna "dias sem
  // contato" da lista de Parceiros).
  if (ordem.length === 0) {
    const parados = await supabase
      .from('deals')
      .select('organization_id, last_activity_at')
      .eq('status', 'open')
      .order('last_activity_at', { ascending: true, nullsFirst: true })
      .limit(MAX_SUGESTOES);
    for (const d of parados.data ?? []) {
      if (origem.has(d.organization_id)) continue;
      origem.set(d.organization_id, 'parado');
      ordem.push(d.organization_id);
    }
  }

  const alvos = await hidratarAlvos(ordem);
  return alvos.map((alvo) => ({
    ...alvo,
    origem: origem.get(alvo.id) ?? 'recente',
    motivo: motivo.get(alvo.id) ?? null,
  }));
}
