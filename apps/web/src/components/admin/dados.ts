'use client';

/**
 * Consultas da tela de Admin.
 *
 * NENHUMA consulta daqui traduz id de pessoa em nome: elas devolvem o id, e quem
 * resolve o nome é a tela, com o diretório do time que já está em memória. A primeira
 * versão passava o mapa de nomes como argumento e o resultado saía com "Pessoa
 * removida do CRM" sempre que a consulta terminava antes da lista de perfis — o mapa
 * viajava vazio dentro de um resultado que fica em cache.
 *
 * Tudo aqui roda no navegador, com o cliente Supabase da sessão: a autorização de
 * verdade é a RLS do Postgres, e não o papel que o JWT diz ter. Por isso a tela
 * SEMPRE trata "não tenho permissão" como um estado normal e não como um defeito —
 * `audit_log` e `allowed_users` são só de admin, `pii_access_log` é de admin e gestor,
 * e a mesma tela é aberta pelos dois papéis.
 *
 * As consultas juntam nomes no cliente em vez de usar `select` aninhado do PostgREST.
 * Motivo: `audit_log` e `pii_access_log` não têm chave estrangeira para `profiles`
 * (são registros append-only que sobrevivem ao perfil apagado), então não há relação
 * para o PostgREST embutir. Como as listas envolvidas são pequenas (o time tem 5
 * pessoas, a página tem 50 linhas), duas consultas extras custam menos que uma view
 * nova no banco.
 */
import { type AppRole } from '@/lib/auth/role';
import { createClient } from '@/lib/supabase/client';

import { intervaloDoDia, diferencas } from './formatos';
import {
  POR_PAGINA,
  type Categoria,
  type Cidade,
  type DadosCatalogos,
  type DadosPermitidos,
  type DadosPessoas,
  type Desfecho,
  type Feriado,
  type FiltroRegistro,
  type LinhaAuditoria,
  type LinhaSupressao,
  type LinhaTelefoneRevelado,
  type ModeloDeMensagem,
  type MotivoDePerda,
  type ParceiroSemContato,
  type Permitido,
} from './tipos';

/** Erro de permissão do Postgres, que na Admin é um estado da tela e não uma falha. */
export class SemAcessoAoRegistro extends Error {
  constructor(public readonly registro: string) {
    super(`Sem acesso a ${registro}`);
    this.name = 'SemAcessoAoRegistro';
  }
}

function ehErroDePermissao(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false;
  return erro.code === '42501' || /row-level security|permission denied/i.test(erro.message ?? '');
}

/** Conta ocorrências de um id numa lista de linhas, para as colunas de uso dos catálogos. */
function contar<T extends string | number>(valores: (T | null)[]): Map<T, number> {
  const mapa = new Map<T, number>();
  for (const valor of valores) {
    if (valor === null || valor === undefined) continue;
    mapa.set(valor, (mapa.get(valor) ?? 0) + 1);
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// Pessoas (RF-ADM-01, RF-ADM-06)
// ---------------------------------------------------------------------------

export async function carregarPessoas(): Promise<DadosPessoas> {
  const supabase = createClient();

  const [perfis, times] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, role, is_active, team_id, created_at')
      .order('full_name'),
    supabase.from('teams').select('id, name').order('name'),
  ]);

  if (perfis.error) throw new Error(perfis.error.message);
  if (times.error) throw new Error(times.error.message);

  const linhasTimes = (times.data ?? []) as unknown as { id: number; name: string }[];
  const nomeDoTime = new Map(linhasTimes.map((t) => [t.id, t.name]));

  const linhas = (perfis.data ?? []) as unknown as {
    id: string;
    full_name: string;
    role: AppRole;
    is_active: boolean;
    team_id: number | null;
    created_at: string;
  }[];

  return {
    pessoas: linhas.map((p) => ({
      id: p.id,
      nome: p.full_name,
      papel: p.role,
      ativo: p.is_active,
      timeId: p.team_id,
      time: p.team_id === null ? null : (nomeDoTime.get(p.team_id) ?? null),
      criadoEm: p.created_at,
    })),
    times: linhasTimes.map((t) => ({ id: t.id, nome: t.name })),
  };
}

/** Lista de permitidos e domínios: só admin lê (política `allowed_users_admin_select`). */
export async function carregarPermitidos(): Promise<DadosPermitidos> {
  const supabase = createClient();

  const [usuarios, dominios] = await Promise.all([
    supabase
      .from('allowed_users')
      .select('id, email, role, note, created_at, created_by')
      .order('email'),
    supabase.from('allowed_domains').select('id, domain, default_role, is_active').order('domain'),
  ]);

  if (ehErroDePermissao(usuarios.error) || ehErroDePermissao(dominios.error)) {
    throw new SemAcessoAoRegistro('lista de permitidos');
  }
  if (usuarios.error) throw new Error(usuarios.error.message);
  if (dominios.error) throw new Error(dominios.error.message);

  const linhas = (usuarios.data ?? []) as unknown as {
    id: number;
    email: string;
    role: AppRole;
    note: string | null;
    created_at: string;
    created_by: string | null;
  }[];

  const permitidos: Permitido[] = linhas.map((u) => ({
    id: u.id,
    email: u.email,
    papel: u.role,
    nota: u.note,
    criadoEm: u.created_at,
    criadoPorId: u.created_by,
  }));

  const linhasDominios = (dominios.data ?? []) as unknown as {
    id: number;
    domain: string;
    default_role: AppRole;
    is_active: boolean;
  }[];

  return {
    permitidos,
    dominios: linhasDominios.map((d) => ({
      id: d.id,
      dominio: d.domain,
      papelPadrao: d.default_role,
      ativo: d.is_active,
    })),
  };
}

export async function trocarPapel(pessoaId: string, papel: AppRole): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('profiles').update({ role: papel }).eq('id', pessoaId);
  if (error) throw new Error(error.message);
}

export async function trocarAcesso(pessoaId: string, ativo: boolean): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('profiles').update({ is_active: ativo }).eq('id', pessoaId);
  if (error) throw new Error(error.message);
}

export async function adicionarPermitido(
  email: string,
  papel: AppRole,
  nota: string | null,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('allowed_users')
    .insert({ email: email.trim().toLowerCase(), role: papel, note: nota?.trim() || null });
  if (error) throw new Error(error.message);
}

export async function removerPermitido(id: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('allowed_users').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function trocarDominioAtivo(id: number, ativo: boolean): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('allowed_domains')
    .update({ is_active: ativo })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Catálogos (RF-ADM-02)
// ---------------------------------------------------------------------------

export async function carregarCatalogos(): Promise<DadosCatalogos> {
  const supabase = createClient();

  const [
    categorias,
    cidades,
    feriados,
    motivos,
    desfechos,
    modelos,
    usoCategorias,
    usoCidades,
    usoMotivos,
    usoDesfechos,
    etapas,
  ] = await Promise.all([
    supabase
      .from('categories')
      .select('id, slug, name, group, priority, is_active, position')
      .order('position')
      .order('name'),
    supabase
      .from('cities')
      .select('id, name, state, is_metro_natal')
      .order('is_metro_natal', { ascending: false })
      .order('name'),
    supabase.from('holidays').select('id, date, name, scope').order('date'),
    supabase
      .from('lost_reasons')
      .select('id, slug, name, is_active, position')
      .order('position')
      .order('name'),
    supabase
      .from('interaction_outcomes')
      .select(
        'id, slug, name, surfaces, position, is_active, cooldown_days, can_reactivate, ' +
          'next_action_label, next_action_offset_days, target_stage_slug, sets_temperature, ' +
          'requires_lost_reason, counts_as',
      )
      .order('position'),
    supabase
      .from('message_templates')
      .select(
        'id, template_code, name, channel, category, segment, variant, body, variables, ' +
          'version, is_active, meta_status',
      )
      .order('template_code'),
    supabase.from('organization_categories').select('category_id'),
    supabase.from('organizations_view').select('city_id'),
    supabase.from('deals').select('lost_reason_id'),
    supabase.from('activities').select('outcome_id'),
    // As etapas entram só para trocar o slug do desfecho ("nutricao") pelo nome que
    // aparece no kanban ("Nutrição"): é o mesmo lugar do funil, escrito como o time fala.
    supabase.from('stages').select('slug, name'),
  ]);

  for (const resposta of [categorias, cidades, feriados, motivos, desfechos, modelos]) {
    if (resposta.error) throw new Error(resposta.error.message);
  }

  const porCategoria = contar(
    ((usoCategorias.data ?? []) as unknown as { category_id: number }[]).map((l) => l.category_id),
  );
  const porCidade = contar(
    ((usoCidades.data ?? []) as unknown as { city_id: number | null }[]).map((l) => l.city_id),
  );
  const porMotivo = contar(
    ((usoMotivos.data ?? []) as unknown as { lost_reason_id: number | null }[]).map(
      (l) => l.lost_reason_id,
    ),
  );
  const porDesfecho = contar(
    ((usoDesfechos.data ?? []) as unknown as { outcome_id: number | null }[]).map(
      (l) => l.outcome_id,
    ),
  );

  const nomeDaEtapa = new Map(
    ((etapas.data ?? []) as unknown as { slug: string; name: string }[]).map((e) => [
      e.slug,
      e.name,
    ]),
  );

  const linhasCategorias = (categorias.data ?? []) as unknown as {
    id: number;
    slug: string;
    name: string;
    group: string;
    priority: number;
    is_active: boolean;
  }[];

  const linhasCidades = (cidades.data ?? []) as unknown as {
    id: number;
    name: string;
    state: string;
    is_metro_natal: boolean;
  }[];

  const linhasFeriados = (feriados.data ?? []) as unknown as {
    id: number;
    date: string;
    name: string;
    scope: string;
  }[];

  const linhasMotivos = (motivos.data ?? []) as unknown as {
    id: number;
    slug: string;
    name: string;
    is_active: boolean;
    position: number;
  }[];

  const linhasDesfechos = (desfechos.data ?? []) as unknown as {
    id: number;
    slug: string;
    name: string;
    surfaces: string[];
    is_active: boolean;
    cooldown_days: number;
    can_reactivate: boolean;
    next_action_label: string | null;
    next_action_offset_days: number | null;
    target_stage_slug: string | null;
    sets_temperature: string | null;
    requires_lost_reason: boolean;
    counts_as: string;
  }[];

  const linhasModelos = (modelos.data ?? []) as unknown as {
    id: number;
    template_code: string;
    name: string;
    channel: string;
    category: string;
    segment: string | null;
    variant: string | null;
    body: string;
    variables: unknown;
    version: number;
    is_active: boolean;
    meta_status: string | null;
  }[];

  const paraCategoria = (c: (typeof linhasCategorias)[number]): Categoria => ({
    id: c.id,
    slug: c.slug,
    nome: c.name,
    grupo: c.group,
    prioridade: c.priority,
    ativo: c.is_active,
    parceiros: porCategoria.get(c.id) ?? 0,
  });

  const paraCidade = (c: (typeof linhasCidades)[number]): Cidade => ({
    id: c.id,
    nome: c.name,
    uf: c.state,
    grandeNatal: c.is_metro_natal,
    parceiros: porCidade.get(c.id) ?? 0,
  });

  const paraFeriado = (f: (typeof linhasFeriados)[number]): Feriado => ({
    id: f.id,
    data: f.date,
    nome: f.name,
    escopo: f.scope,
  });

  const paraMotivo = (m: (typeof linhasMotivos)[number]): MotivoDePerda => ({
    id: m.id,
    slug: m.slug,
    nome: m.name,
    ativo: m.is_active,
    posicao: m.position,
    negocios: porMotivo.get(m.id) ?? 0,
  });

  const paraDesfecho = (d: (typeof linhasDesfechos)[number]): Desfecho => ({
    id: d.id,
    slug: d.slug,
    nome: d.name,
    superficies: d.surfaces ?? [],
    ativo: d.is_active,
    silencioDias: d.cooldown_days,
    podeReativar: d.can_reactivate,
    proximaAcaoRotulo: d.next_action_label,
    proximaAcaoDias: d.next_action_offset_days,
    etapaDestino: d.target_stage_slug
      ? (nomeDaEtapa.get(d.target_stage_slug) ?? d.target_stage_slug)
      : null,
    temperatura: d.sets_temperature,
    exigeMotivoDePerda: d.requires_lost_reason,
    contaComo: d.counts_as,
    usos: porDesfecho.get(d.id) ?? 0,
  });

  const paraModelo = (m: (typeof linhasModelos)[number]): ModeloDeMensagem => ({
    id: m.id,
    codigo: m.template_code,
    nome: m.name,
    canal: m.channel,
    categoria: m.category,
    segmento: m.segment,
    variante: m.variant,
    corpo: m.body,
    variaveis: Array.isArray(m.variables) ? (m.variables as string[]) : [],
    versao: m.version,
    ativo: m.is_active,
    statusMeta: m.meta_status,
  });

  return {
    categorias: linhasCategorias.map(paraCategoria),
    cidades: linhasCidades.map(paraCidade),
    feriados: linhasFeriados.map(paraFeriado),
    motivos: linhasMotivos.map(paraMotivo),
    desfechos: linhasDesfechos.map(paraDesfecho),
    modelos: linhasModelos.map(paraModelo),
  };
}

/** Liga e desliga uma linha de catálogo. A RLS exige admin ou gestor (`app.is_manager`). */
export async function trocarAtivo(
  tabela: 'categories' | 'lost_reasons' | 'interaction_outcomes' | 'message_templates',
  id: number,
  ativo: boolean,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(tabela).update({ is_active: ativo }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function trocarGrandeNatal(id: number, dentro: boolean): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('cities').update({ is_metro_natal: dentro }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function adicionarFeriado(data: string, nome: string, escopo: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('holidays')
    .insert({ date: data, name: nome.trim(), scope: escopo });
  if (error) throw new Error(error.message);
}

export async function removerFeriado(id: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('holidays').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// LGPD (RF-ADM-03, RF-ADM-04)
// ---------------------------------------------------------------------------

/** Nome dos parceiros de uma lista de ids, pela view (que já respeita a RLS). */
async function nomesDeParceiros(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const supabase = createClient();
  const { data, error } = await supabase
    .from('organizations_view')
    .select('id, name')
    .in('id', ids);
  if (error) return new Map();
  const linhas = (data ?? []) as unknown as { id: string; name: string }[];
  return new Map(linhas.map((o) => [o.id, o.name]));
}

export async function carregarSupressao(): Promise<LinhaSupressao[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('suppression_list')
    .select('id, hash, kind, reason, channel, created_at, created_by, source_event_id')
    .order('created_at', { ascending: false })
    .limit(POR_PAGINA);

  if (ehErroDePermissao(error)) throw new SemAcessoAoRegistro('lista de supressão');
  if (error) throw new Error(error.message);

  const linhas = (data ?? []) as unknown as {
    id: number;
    hash: string;
    kind: string;
    reason: string | null;
    channel: string | null;
    created_at: string;
    created_by: string | null;
    source_event_id: string | null;
  }[];

  const eventos = linhas.map((l) => l.source_event_id).filter((id): id is string => Boolean(id));
  const porEvento = new Map<string, { organizationId: string | null; evidencia: string | null }>();

  if (eventos.length > 0) {
    const { data: dadosEventos } = await supabase
      .from('consent_events')
      .select('id, organization_id, evidence_text')
      .in('id', eventos);
    const linhasEventos = (dadosEventos ?? []) as unknown as {
      id: string;
      organization_id: string | null;
      evidence_text: string | null;
    }[];
    for (const evento of linhasEventos) {
      porEvento.set(evento.id, {
        organizationId: evento.organization_id,
        evidencia: evento.evidence_text,
      });
    }
  }

  const idsParceiros = [...porEvento.values()]
    .map((e) => e.organizationId)
    .filter((id): id is string => Boolean(id));
  const nomeDoParceiro = await nomesDeParceiros(idsParceiros);

  return linhas.map((l) => {
    const evento = l.source_event_id ? porEvento.get(l.source_event_id) : undefined;
    const parceiroId = evento?.organizationId ?? null;
    return {
      id: l.id,
      hash: l.hash,
      tipo: l.kind,
      motivo: l.reason,
      canal: l.channel,
      quando: l.created_at,
      quemId: l.created_by,
      parceiro: parceiroId ? (nomeDoParceiro.get(parceiroId) ?? null) : null,
      parceiroId,
      evidencia: evento?.evidencia ?? null,
    };
  });
}

/** Parceiros marcados "não contatar": a face legível da supressão, que guarda só hash. */
export async function carregarSemContato(): Promise<ParceiroSemContato[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('organizations_view')
    .select('id, name, neighborhood, city_name')
    .eq('do_not_contact', true)
    .order('name');

  if (error) throw new Error(error.message);
  const linhas = (data ?? []) as unknown as {
    id: string;
    name: string;
    neighborhood: string | null;
    city_name: string | null;
  }[];

  return linhas.map((o) => ({
    id: o.id,
    nome: o.name,
    bairro: o.neighborhood,
    cidade: o.city_name,
  }));
}

export async function carregarTelefonesRevelados(
  filtro: FiltroRegistro,
): Promise<LinhaTelefoneRevelado[]> {
  const supabase = createClient();

  let consulta = supabase
    .from('pii_access_log')
    .select('id, actor_id, actor_role, action, entity_type, entity_id, created_at')
    .order('created_at', { ascending: false })
    .limit(POR_PAGINA);

  if (filtro.pessoaId) consulta = consulta.eq('actor_id', filtro.pessoaId);
  if (filtro.dia) {
    const { de, ate } = intervaloDoDia(filtro.dia);
    consulta = consulta.gte('created_at', de).lt('created_at', ate);
  }

  const { data, error } = await consulta;
  if (ehErroDePermissao(error)) throw new SemAcessoAoRegistro('registro de acesso a telefone');
  if (error) throw new Error(error.message);

  const linhas = (data ?? []) as unknown as {
    id: number;
    actor_id: string;
    actor_role: string | null;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    created_at: string;
  }[];

  const idsParceiros = linhas
    .filter((l) => l.entity_type === 'organization' && l.entity_id)
    .map((l) => l.entity_id as string);
  const nomeDoParceiro = await nomesDeParceiros([...new Set(idsParceiros)]);

  return linhas.map((l) => ({
    id: l.id,
    quemId: l.actor_id,
    papel: l.actor_role,
    acao: l.action,
    parceiro:
      l.entity_type === 'organization' && l.entity_id
        ? (nomeDoParceiro.get(l.entity_id) ?? null)
        : null,
    parceiroId: l.entity_type === 'organization' ? l.entity_id : null,
    quando: l.created_at,
  }));
}

export async function carregarAuditoria(
  filtro: FiltroRegistro,
  pagina: number,
): Promise<{ linhas: LinhaAuditoria[]; temMais: boolean }> {
  const supabase = createClient();

  const inicio = (Math.max(1, pagina) - 1) * POR_PAGINA;

  let consulta = supabase
    .from('audit_log')
    .select('id, actor_id, actor_role, action, table_name, row_id, old_data, new_data, created_at')
    .order('id', { ascending: false })
    // Uma linha a mais só para saber se existe próxima página, sem pedir contagem.
    .range(inicio, inicio + POR_PAGINA);

  if (filtro.pessoaId) consulta = consulta.eq('actor_id', filtro.pessoaId);
  if (filtro.dia) {
    const { de, ate } = intervaloDoDia(filtro.dia);
    consulta = consulta.gte('created_at', de).lt('created_at', ate);
  }

  const { data, error } = await consulta;
  if (ehErroDePermissao(error)) throw new SemAcessoAoRegistro('registro de auditoria');
  if (error) throw new Error(error.message);

  const brutas = (data ?? []) as unknown as {
    id: number;
    actor_id: string | null;
    actor_role: string | null;
    action: string;
    table_name: string;
    row_id: string;
    old_data: Record<string, unknown> | null;
    new_data: Record<string, unknown> | null;
    created_at: string;
  }[];

  const temMais = brutas.length > POR_PAGINA;
  const pagina50 = brutas.slice(0, POR_PAGINA);

  // Nome do registro tocado, quando dá para resolver: parceiro pelo próprio id,
  // negócio pelo parceiro dele, pessoa pelo diretório do time.
  const idsOrg = pagina50.filter((l) => l.table_name === 'organizations').map((l) => l.row_id);
  const idsNegocio = pagina50.filter((l) => l.table_name === 'deals').map((l) => l.row_id);

  const parceiroDoNegocio = new Map<string, string>();
  if (idsNegocio.length > 0) {
    const { data: negocios } = await supabase
      .from('deals')
      .select('id, organization_id')
      .in('id', [...new Set(idsNegocio)]);
    const linhasNegocios = (negocios ?? []) as unknown as {
      id: string;
      organization_id: string;
    }[];
    for (const negocio of linhasNegocios) {
      parceiroDoNegocio.set(negocio.id, negocio.organization_id);
    }
  }

  const idsParaNome = [...new Set([...idsOrg, ...[...parceiroDoNegocio.values()]])];
  const nomeDoParceiro = await nomesDeParceiros(idsParaNome);

  return {
    linhas: pagina50.map((l) => {
      let registro: string | null = null;
      if (l.table_name === 'organizations') {
        registro = nomeDoParceiro.get(l.row_id) ?? null;
      } else if (l.table_name === 'deals') {
        const orgId = parceiroDoNegocio.get(l.row_id);
        registro = orgId ? (nomeDoParceiro.get(orgId) ?? null) : null;
      } else if (l.new_data && typeof l.new_data.name === 'string') {
        registro = l.new_data.name;
      }

      return {
        id: l.id,
        quemId: l.actor_id,
        papel: l.actor_role,
        acao: l.action,
        tabela: l.table_name,
        registroId: l.row_id,
        registro,
        mudancas: l.action === 'UPDATE' ? diferencas(l.old_data, l.new_data) : [],
        quando: l.created_at,
      };
    }),
    temMais,
  };
}
