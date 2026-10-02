import type { OrgKind, Temperature } from '@komune/schema';

import { createClient } from '@/lib/supabase/server';

import type { ConversaDaFicha, EtapaDoFunil } from './resumo-da-ficha';

/**
 * Leitura da ficha do parceiro, no servidor.
 *
 * Fonte: `public.organizations_view` (telefone mascarado por papel, RF-BAS-14) mais
 * as tabelas-filha. São consultas separadas em vez de um embed do PostgREST porque
 * `organizations_view` é uma view: o PostgREST não infere relação a partir dela, e
 * um embed que às vezes funciona é pior do que quatro consultas que sempre funcionam.
 */

export type NegocioDaFicha = {
  id: string;
  funil: string;
  /** O id do funil e o da etapa: é com eles que a régua do cabeçalho se monta. */
  funilId: number;
  etapaId: number;
  etapa: string;
  status: string;
  temperatura: Temperature;
  precisaAtencao: boolean;
  responsavel: string | null;
  /** `team_directory.role` de quem responde: "sdr", "gestor". */
  responsavelPapel: string | null;
  proximaAcao: string | null;
  proximaAcaoEm: string | null;
  ultimoContatoEm: string | null;
  naEtapaDesde: string;
  tier: string | null;
};

export type Ficha = {
  id: string;
  nome: string;
  razaoSocial: string | null;
  /**
   * Os ids de cidade e de categoria primária existem só para a folha de edição:
   * a tela de leitura mostra os NOMES. Sem eles, abrir "Editar ficha" com a
   * cidade já escolhida obrigaria a casar por nome — e dois municípios do RN
   * com o mesmo nome fariam a escolha errada em silêncio.
   */
  cidadeId: number | null;
  categoriaId: number | null;
  tipo: OrgKind;
  cnpj: string | null;
  telefone: string | null;
  telefoneMascarado: boolean;
  email: string | null;
  instagram: string | null;
  site: string | null;
  cidade: string | null;
  bairro: string | null;
  endereco: string | null;
  temperatura: Temperature;
  temperaturaManual: number | null;
  temperaturaMotivo: string | null;
  responsavel: string | null;
  responsavelPapel: string | null;
  categorias: string[];
  categoriaPrimaria: string | null;
  origem: string | null;
  origemUrl: string | null;
  coletadoEm: string;
  coletadoPor: string;
  pessoaFisica: boolean;
  vip: boolean;
  naoContatar: boolean;
  descricao: string | null;
  negocios: NegocioDaFicha[];
  /**
   * A nota e o número de avaliações que a coleta trouxe. Vazios na maior parte
   * da base: a ficha só mostra a linha quando existem.
   */
  nota: number | null;
  avaliacoes: number | null;
  /**
   * Todas as etapas de cada funil em que o parceiro tem negócio, por id do
   * funil. A régua do cabeçalho precisa do caminho inteiro, não só da etapa atual.
   */
  etapasPorFunil: Record<number, EtapaDoFunil[]>;
  /**
   * A conversa de WhatsApp mais recente do parceiro: janela de 24 h, por ler e
   * quem atende. `null` quando não há conversa — ou quando a RLS não deixa este
   * papel vê-la, que para a ficha dá no mesmo.
   */
  conversa: ConversaDaFicha | null;
};

/**
 * `null` significa uma coisa só: a linha não está lá — não existe, ou está fora do que
 * a RLS deixa este papel ver, que para quem olha dá no mesmo. Falha de leitura lança.
 */
export async function carregarFicha(id: string): Promise<Ficha | null> {
  const supabase = await createClient();

  const { data: org, error } = await supabase
    .from('organizations_view')
    // Uma string literal só: o supabase-js deduz o tipo do retorno a partir dela, e
    // uma concatenação em tempo de execução apagaria essa dedução.
    .select(
      'id, name, legal_name, kind, cnpj, phone_e164, phone_is_masked, email, instagram_handle, website, city_id, city_name, neighborhood, address, temperature, temperature_override, temperature_override_reason, owner_id, source_id, source_url, collected_at, collector, is_natural_person, vip, do_not_contact, description, primary_category_name, rating, reviews_count',
    )
    .eq('id', id)
    .maybeSingle();

  // "Deu erro" e "não tem" são coisas diferentes, e trocar uma pela outra sai caro:
  // engolindo o erro e devolvendo `null`, a página caía no `notFound()` e escrevia
  // "este parceiro não existe" — para um parceiro que existe — toda vez que a sessão
  // expirava, a RLS barrava ou a rede caía no meio da rua. Quem lê isso conclui que o
  // cadastro sumiu e recadastra por cima, criando a duplicata que a esteira de
  // ingestão existe para evitar. Lançando, o limite de erro do segmento assume a falha
  // como do CRM e oferece "Tentar de novo", que é a saída certa para os três casos.
  if (error) {
    throw new Error(`Não foi possível ler a ficha do parceiro: ${error.message}`);
  }
  if (!org) return null;

  const [categorias, negocios, origem, time, conversas] = await Promise.all([
    supabase
      .from('organization_categories')
      .select('is_primary, category_id, categories(name)')
      .eq('organization_id', id),
    supabase
      .from('deals')
      .select(
        'id, status, temperature, needs_attention, owner_id, next_action, next_action_at, last_activity_at, entered_stage_at, tier, stage_id, pipeline_id',
      )
      .eq('organization_id', id)
      .order('updated_at', { ascending: false }),
    org.source_id
      ? supabase.from('sources').select('name').eq('id', org.source_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('team_directory').select('id, full_name, role'),
    // A conversa mais recente, só para LER o estado do WhatsApp (janela de 24 h,
    // por ler, quem atende). A ficha não escreve em `conversations` nem fala com
    // a Meta; se a leitura falhar, o cabeçalho diz "Sem conversa" e a ficha abre.
    supabase
      .from('conversations')
      .select('window_expires_at, unread_count, assignee_id, last_message_at')
      .eq('organization_id', id)
      .is('arquivada_em', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1),
  ]);

  const nomeDoTime = new Map((time.data ?? []).map((p) => [p.id, p.full_name]));
  const papelDoTime = new Map((time.data ?? []).map((p) => [p.id, p.role as string | null]));

  // As etapas do FUNIL inteiro, e não só as dos negócios: a régua do cabeçalho
  // desenha o caminho todo. Continua uma consulta só, agora pelo funil.
  const idsDeFunil = [...new Set((negocios.data ?? []).map((d) => d.pipeline_id))];
  const { data: etapas } = idsDeFunil.length
    ? await supabase
        .from('stages')
        .select('id, name, pipeline_id, position')
        .in('pipeline_id', idsDeFunil)
        .order('position')
    : { data: [] };
  const { data: funis } = await supabase.from('pipelines').select('id, name');

  const etapaPorId = new Map((etapas ?? []).map((e) => [e.id, e.name]));
  const funilPorId = new Map((funis ?? []).map((f) => [f.id, f.name]));
  const etapasPorFunil: Record<number, EtapaDoFunil[]> = {};
  for (const e of etapas ?? []) {
    (etapasPorFunil[e.pipeline_id] ??= []).push({ id: e.id, nome: e.name, posicao: e.position });
  }

  const fio = conversas.error ? null : (conversas.data?.[0] ?? null);
  const conversa: ConversaDaFicha | null = fio
    ? {
        janelaExpiraEm: fio.window_expires_at,
        porLer: fio.unread_count,
        atendente: nomeDoTime.get(fio.assignee_id) ?? null,
        ultimaMensagemEm: fio.last_message_at,
      }
    : null;

  const listaDeCategorias = (categorias.data ?? [])
    // O PostgREST devolve o embed como lista mesmo quando a relação é para um só.
    .map((c) => {
      const ligado = Array.isArray(c.categories) ? c.categories[0] : c.categories;
      return { nome: ligado?.name ?? null, primaria: c.is_primary };
    })
    .filter((c): c is { nome: string; primaria: boolean } => c.nome !== null)
    // A primária primeiro: é a que responde "isso aqui é o quê?".
    .sort((a, b) => Number(b.primaria) - Number(a.primaria));

  return {
    id: org.id,
    nome: org.name,
    razaoSocial: org.legal_name,
    cidadeId: org.city_id,
    categoriaId: (categorias.data ?? []).find((c) => c.is_primary)?.category_id ?? null,
    tipo: org.kind,
    cnpj: org.cnpj,
    telefone: org.phone_e164,
    telefoneMascarado: org.phone_is_masked ?? true,
    email: org.email,
    instagram: org.instagram_handle,
    site: org.website,
    cidade: org.city_name,
    bairro: org.neighborhood,
    endereco: org.address,
    temperatura: org.temperature,
    temperaturaManual: org.temperature_override,
    temperaturaMotivo: org.temperature_override_reason,
    responsavel: org.owner_id ? (nomeDoTime.get(org.owner_id) ?? null) : null,
    responsavelPapel: org.owner_id ? (papelDoTime.get(org.owner_id) ?? null) : null,
    categorias: listaDeCategorias.map((c) => c.nome),
    categoriaPrimaria: org.primary_category_name,
    origem: origem.data?.name ?? null,
    origemUrl: org.source_url,
    coletadoEm: org.collected_at,
    coletadoPor: org.collector,
    pessoaFisica: org.is_natural_person,
    vip: org.vip,
    naoContatar: org.do_not_contact,
    descricao: org.description,
    nota: org.rating,
    avaliacoes: org.reviews_count,
    etapasPorFunil,
    conversa,
    negocios: (negocios.data ?? []).map((d) => ({
      id: d.id,
      funil: funilPorId.get(d.pipeline_id) ?? 'Funil',
      funilId: d.pipeline_id,
      etapaId: d.stage_id,
      etapa: etapaPorId.get(d.stage_id) ?? 'Etapa',
      status: d.status,
      temperatura: d.temperature,
      precisaAtencao: d.needs_attention,
      responsavel: d.owner_id ? (nomeDoTime.get(d.owner_id) ?? null) : null,
      responsavelPapel: d.owner_id ? (papelDoTime.get(d.owner_id) ?? null) : null,
      proximaAcao: d.next_action,
      proximaAcaoEm: d.next_action_at,
      ultimoContatoEm: d.last_activity_at,
      naEtapaDesde: d.entered_stage_at,
      tier: d.tier,
    })),
  };
}

/** Dias inteiros desde uma data ISO; `null` quando não há data. */
export function diasDesde(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** Rótulo do status do negócio (enum `app.deal_status`). */
export const ROTULO_STATUS: Record<string, string> = {
  open: 'Em aberto',
  won: 'Ganho',
  lost: 'Perdido',
  paused: 'Pausado',
  nurturing: 'Em nutrição',
};
