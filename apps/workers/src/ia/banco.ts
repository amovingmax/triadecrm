/**
 * O banco visto pelo worker de IA: o que ele lê para montar a entrada e onde
 * ele põe o que voltou.
 *
 * Nenhuma regra de negócio mora aqui — o cérebro é o Postgres (ADR-03). O que
 * este arquivo carrega é uma decisão de ARRUMAÇÃO, e ela é a mesma nos quatro
 * fluxos:
 *
 *   · `ai_runs.output` guarda a saída **pseudonimizada**, como veio do modelo,
 *     com os marcadores `[[NOME_1]]` no lugar. É contabilidade e material de
 *     eval, e não pode virar um segundo lugar onde o telefone de alguém mora
 *     (ADR-09).
 *   · O lugar onde uma PESSOA lê guarda o texto **reidratado**:
 *     `messages.transcript`, `activities.metadata.resumo_ia`,
 *     `message_drafts.proposed_body`. `reidratar` é chamado na hora da leitura,
 *     campo a campo, e não automaticamente — devolver o nome real a um texto
 *     que voltaria ao modelo desfaria o guardrail.
 *
 * Onde a tela lê cada coisa:
 *   transcrição   → `messages.transcript` (o inbox e a linha do tempo)
 *   resumo        → `activities.metadata.resumo_ia` (a linha do tempo já lê `metadata`)
 *   follow-up     → `message_drafts` em `pendente` (a fila de aprovação, RF-CON-22)
 *   classificação → `conversations.ai_intent` / `ai_confidence`
 */
import { ErroDaEsteira, type ClienteDoBanco } from '../ingest/esteira';

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

export interface ContatoDaFicha {
  readonly organizationId: string | null;
  readonly contactId: string | null;
  readonly nome: string | null;
  readonly empresa: string | null;
  readonly telefones: string[];
  readonly emails: string[];
  readonly instagram: string | null;
}

export interface MensagemRecebida {
  readonly id: string;
  readonly conversationId: string;
  readonly organizationId: string | null;
  readonly contactId: string | null;
  readonly tipo: string;
  readonly corpo: string | null;
  readonly transcricao: string | null;
}

export interface ConversaDoFio {
  readonly id: string;
  readonly organizationId: string | null;
  readonly contactId: string | null;
  readonly telefone: string;
  readonly resumo: string | null;
  readonly ultimaIntencao: string | null;
  readonly confiancaAnterior: number | null;
  readonly roboPausado: boolean;
  readonly vip: boolean;
}

export interface NoDaLigacao {
  readonly id: string;
  readonly texto: string;
  readonly respostaEscolhida: string | null;
}

export interface TentativaDeLigacao {
  readonly id: string;
  readonly organizationId: string;
  readonly contactId: string | null;
  readonly activityId: string | null;
  readonly dealId: string | null;
  readonly variante: 'fornecedor' | 'produtor';
  readonly duracaoSeg: number;
  readonly caminho: NoDaLigacao[];
  readonly capturas: Record<string, string>;
  readonly anotacao: string | null;
  readonly desfecho: string;
  readonly segmento: string;
}

function erroSe(operacao: string, error: { message: string } | null): void {
  if (error) throw new ErroDaEsteira(operacao, error.message);
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

export async function buscarMensagem(
  cliente: ClienteDoBanco,
  id: string,
): Promise<MensagemRecebida | null> {
  const { data, error } = await cliente
    .from('messages')
    .select('id, conversation_id, organization_id, contact_id, type, body, transcript, direction')
    .eq('id', id)
    .maybeSingle();
  erroSe('messages.select', error);
  if (data === null) return null;
  const linha = data as Record<string, unknown>;
  return {
    id: String(linha.id),
    conversationId: String(linha.conversation_id),
    organizationId: texto(linha.organization_id),
    contactId: texto(linha.contact_id),
    tipo: String(linha.type),
    corpo: texto(linha.body),
    transcricao: texto(linha.transcript),
  };
}

export async function buscarConversa(
  cliente: ClienteDoBanco,
  id: string,
): Promise<ConversaDoFio | null> {
  const { data, error } = await cliente
    .from('conversations')
    .select(
      'id, organization_id, contact_id, peer_phone_e164, ai_summary, ai_intent, ai_confidence, bot_paused',
    )
    .eq('id', id)
    .maybeSingle();
  erroSe('conversations.select', error);
  if (data === null) return null;
  const linha = data as Record<string, unknown>;
  const organizationId = texto(linha.organization_id);

  let vip = false;
  if (organizationId !== null) {
    const { data: org, error: erroOrg } = await cliente
      .from('organizations')
      .select('vip')
      .eq('id', organizationId)
      .maybeSingle();
    erroSe('organizations.select', erroOrg);
    vip = (org as { vip: boolean } | null)?.vip === true;
  }

  const confianca = linha.ai_confidence;
  return {
    id: String(linha.id),
    organizationId,
    contactId: texto(linha.contact_id),
    telefone: String(linha.peer_phone_e164),
    resumo: texto(linha.ai_summary),
    ultimaIntencao: texto(linha.ai_intent),
    confiancaAnterior: confianca === null || confianca === undefined ? null : Number(confianca),
    roboPausado: linha.bot_paused === true,
    vip,
  };
}

/**
 * O contexto do contato para a pseudonimização: tudo o que o CRM já sabe e que
 * NÃO pode chegar ao modelo. Quanto mais completo, mais a regra tem o que
 * esconder — telefone do cadastro é casamento por substring, e é o caminho que
 * não pode falhar.
 */
export async function buscarContatoDaFicha(
  cliente: ClienteDoBanco,
  organizationId: string | null,
  contactId: string | null,
  telefoneDaConversa: string | null = null,
): Promise<ContatoDaFicha> {
  const telefones = new Set<string>();
  const emails = new Set<string>();
  let nome: string | null = null;
  let empresa: string | null = null;
  let instagram: string | null = null;

  if (telefoneDaConversa !== null) telefones.add(telefoneDaConversa);

  if (contactId !== null) {
    const { data, error } = await cliente
      .from('contacts')
      .select('full_name, first_name, phone_e164, email, instagram_handle')
      .eq('id', contactId)
      .maybeSingle();
    erroSe('contacts.select', error);
    const linha = (data ?? {}) as Record<string, unknown>;
    nome = texto(linha.full_name) ?? texto(linha.first_name);
    const telefone = texto(linha.phone_e164);
    if (telefone !== null) telefones.add(telefone);
    const email = texto(linha.email);
    if (email !== null) emails.add(email);
    instagram = texto(linha.instagram_handle);
  }

  if (organizationId !== null) {
    const { data, error } = await cliente
      .from('organizations')
      .select('name, phone_e164, email, instagram_handle')
      .eq('id', organizationId)
      .maybeSingle();
    erroSe('organizations.select', error);
    const linha = (data ?? {}) as Record<string, unknown>;
    empresa = texto(linha.name);
    const telefone = texto(linha.phone_e164);
    if (telefone !== null) telefones.add(telefone);
    const email = texto(linha.email);
    if (email !== null) emails.add(email);
    instagram = instagram ?? texto(linha.instagram_handle);
  }

  return {
    organizationId,
    contactId,
    nome,
    empresa,
    telefones: [...telefones],
    emails: [...emails],
    instagram,
  };
}

/**
 * O caminho percorrido, com a fala de cada nó.
 *
 * `call_attempts.caminho_script` guarda só os ids, na ordem. A fala está na
 * árvore do roteiro (`call_scripts.arvore`), e a resposta escolhida em cada nó
 * é DEDUZIDA: é a saída daquele nó cujo destino é o próximo id do caminho. É
 * dedução honesta — a convenção do roteiro garante o destino —, e quando duas
 * saídas apontam para o mesmo destino (o roteiro tem, em `abertura`), fica a
 * primeira. O último nó não tem resposta: `null`.
 */
export function reconstruirCaminho(
  arvore: unknown,
  ids: readonly string[],
): NoDaLigacao[] {
  const nos = new Map<string, { texto: string; saidas: { rotulo: string; destino: string }[] }>();
  if (Array.isArray(arvore)) {
    for (const bruto of arvore) {
      if (typeof bruto !== 'object' || bruto === null) continue;
      const no = bruto as Record<string, unknown>;
      const id = texto(no.id);
      const fala = texto(no.texto);
      if (id === null || fala === null) continue;
      const saidas: { rotulo: string; destino: string }[] = [];
      if (Array.isArray(no.saidas)) {
        for (const brutaSaida of no.saidas) {
          if (typeof brutaSaida !== 'object' || brutaSaida === null) continue;
          const saida = brutaSaida as Record<string, unknown>;
          const rotulo = texto(saida.rotulo);
          const destino = texto(saida.destino);
          if (rotulo !== null && destino !== null) saidas.push({ rotulo, destino });
        }
      }
      nos.set(id, { texto: fala, saidas });
    }
  }

  const caminho: NoDaLigacao[] = [];
  ids.forEach((id, indice) => {
    const no = nos.get(id);
    if (no === undefined) return;
    const proximo = ids[indice + 1];
    const escolhida =
      proximo === undefined ? null : (no.saidas.find((s) => s.destino === proximo)?.rotulo ?? null);
    caminho.push({ id, texto: no.texto.slice(0, 600), respostaEscolhida: escolhida });
  });
  return caminho;
}

export async function buscarTentativa(
  cliente: ClienteDoBanco,
  id: string,
): Promise<TentativaDeLigacao | null> {
  const { data, error } = await cliente
    .from('call_attempts')
    .select(
      'id, organization_id, contact_id, activity_id, variante, duracao_seg, caminho_script, capturas, script_id, outcome_id',
    )
    .eq('id', id)
    .maybeSingle();
  erroSe('call_attempts.select', error);
  if (data === null) return null;
  const linha = data as Record<string, unknown>;

  const idsDoCaminho = Array.isArray(linha.caminho_script)
    ? (linha.caminho_script as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];

  let arvore: unknown = [];
  const scriptId = texto(linha.script_id);
  if (scriptId !== null) {
    const { data: roteiro, error: erroRoteiro } = await cliente
      .from('call_scripts')
      .select('arvore')
      .eq('id', scriptId)
      .maybeSingle();
    erroSe('call_scripts.select', erroRoteiro);
    arvore = (roteiro as { arvore: unknown } | null)?.arvore ?? [];
  }

  let desfecho = 'lig_sem_desfecho';
  if (linha.outcome_id !== null && linha.outcome_id !== undefined) {
    const { data: saida, error: erroSaida } = await cliente
      .from('interaction_outcomes')
      .select('slug')
      .eq('id', linha.outcome_id)
      .maybeSingle();
    erroSe('interaction_outcomes.select', erroSaida);
    desfecho = texto((saida as { slug: string } | null)?.slug) ?? desfecho;
  }

  let anotacao: string | null = null;
  let dealId: string | null = null;
  const activityId = texto(linha.activity_id);
  if (activityId !== null) {
    const { data: atividade, error: erroAtividade } = await cliente
      .from('activities')
      .select('body, deal_id')
      .eq('id', activityId)
      .maybeSingle();
    erroSe('activities.select', erroAtividade);
    const linhaDaAtividade = (atividade ?? {}) as Record<string, unknown>;
    anotacao = texto(linhaDaAtividade.body);
    dealId = texto(linhaDaAtividade.deal_id);
  }

  const organizationId = String(linha.organization_id);
  const segmento = await buscarSegmento(cliente, organizationId);

  const capturas: Record<string, string> = {};
  const brutas = linha.capturas;
  if (typeof brutas === 'object' && brutas !== null && !Array.isArray(brutas)) {
    for (const [chave, valor] of Object.entries(brutas as Record<string, unknown>)) {
      if (valor !== null && valor !== undefined) capturas[chave] = String(valor);
    }
  }

  const variante = linha.variante === 'produtor' ? 'produtor' : 'fornecedor';
  return {
    id: String(linha.id),
    organizationId,
    contactId: texto(linha.contact_id),
    activityId,
    dealId,
    variante,
    duracaoSeg: Number(linha.duracao_seg ?? 0),
    caminho: reconstruirCaminho(arvore, idsDoCaminho),
    capturas,
    anotacao: anotacao === null ? null : anotacao.slice(0, 500),
    desfecho,
    segmento,
  };
}

/**
 * O segmento do R08 §"Segmentos" (`AEB`, `INF`, `PRE`, `ESP`, `CER`, `FOR`, `GEN`)
 * a partir da categoria da ficha.
 *
 * `categories.segment` não existe: está na lista de pendências do D1 no
 * CHANGELOG, e criá-la é migração de outro dono. Enquanto não existir, o mapa é
 * aqui, por slug quando a correspondência é exata (cerimonialista e formatura
 * são segmentos próprios) e por grupo no resto. Ficha sem categoria mapeada vira
 * `GEN`, que é o segmento genérico do próprio playbook — nunca um palpite.
 */
const SEGMENTO_POR_SLUG: Readonly<Record<string, string>> = {
  cerimonialistas_assessorias: 'CER',
  empresas_formatura: 'FOR',
};

const SEGMENTO_POR_GRUPO: Readonly<Record<string, string>> = {
  alimentos_bebidas: 'AEB',
  infraestrutura: 'INF',
  locais: 'ESP',
  servicos: 'PRE',
  recreacao: 'PRE',
  producao: 'GEN',
};

async function buscarSegmento(cliente: ClienteDoBanco, organizationId: string): Promise<string> {
  const { data, error } = await cliente
    .from('organization_categories')
    .select('categories(slug, group)')
    .eq('organization_id', organizationId)
    .limit(1);
  if (error) return 'GEN';
  const primeira = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  const categoria = primeira?.categories as { slug?: unknown; group?: unknown } | null | undefined;
  const slug = texto(categoria?.slug);
  const grupo = texto(categoria?.group);
  return (
    (slug === null ? undefined : SEGMENTO_POR_SLUG[slug]) ??
    (grupo === null ? undefined : SEGMENTO_POR_GRUPO[grupo]) ??
    'GEN'
  );
}

// ---------------------------------------------------------------------------
// Escritas
// ---------------------------------------------------------------------------

/** A transcrição limpa, já reidratada: é uma pessoa que lê isto. */
export async function gravarTranscricao(
  cliente: ClienteDoBanco,
  messageId: string,
  transcricao: string,
): Promise<void> {
  const { error } = await cliente
    .from('messages')
    .update({ transcript: transcricao })
    .eq('id', messageId);
  erroSe('messages.update', error);
}

/**
 * O robô para e a conversa volta para a fila de gente (RF-CON-20).
 *
 * É a única consequência que o worker de IA tira sozinho, e ela é sempre na
 * direção segura: pausar. Despausar é ato de pessoa.
 */
export async function escalarConversa(
  cliente: ClienteDoBanco,
  conversationId: string,
): Promise<void> {
  const { error } = await cliente
    .from('conversations')
    .update({ bot_paused: true, status: 'aguardando_nos' })
    .eq('id', conversationId);
  erroSe('conversations.update', error);
}

export async function gravarClassificacao(
  cliente: ClienteDoBanco,
  conversationId: string,
  intencao: string,
  confianca: number,
): Promise<void> {
  const { error } = await cliente
    .from('conversations')
    .update({ ai_intent: intencao, ai_confidence: confianca })
    .eq('id', conversationId);
  erroSe('conversations.update', error);
}

export interface ResumoParaAFicha {
  readonly resumo: string;
  readonly combinado: string | null;
  readonly objecoes: readonly string[];
  readonly fatos: readonly string[];
  readonly noDeVirada: string | null;
  readonly noDeViradaPorRegra: string | null;
  readonly precisaDeRevisao: boolean;
  readonly promptVersion: string;
  readonly aiRunId: number;
}

/**
 * O resumo entra em `activities.metadata`, que é o que a linha do tempo já lê.
 *
 * `metadata` é jsonb livre e tem dono compartilhado (o gatilho
 * `app.activities_apply_outcome` escreve `outcome_slug`, `door_opened` e
 * companhia). Por isso a escrita é MERGE de uma chave só — `resumo_ia` —, nunca
 * substituição do objeto.
 */
export async function gravarResumoDaLigacao(
  cliente: ClienteDoBanco,
  activityId: string,
  resumo: ResumoParaAFicha,
): Promise<void> {
  const { data, error } = await cliente
    .from('activities')
    .select('metadata')
    .eq('id', activityId)
    .maybeSingle();
  erroSe('activities.select', error);
  const atual = ((data as { metadata?: unknown } | null)?.metadata ?? {}) as Record<string, unknown>;

  const { error: erroDoUpdate } = await cliente
    .from('activities')
    .update({
      metadata: {
        ...atual,
        resumo_ia: {
          resumo: resumo.resumo,
          combinado: resumo.combinado,
          objecoes: resumo.objecoes,
          fatos: resumo.fatos,
          no_de_virada: resumo.noDeVirada,
          no_de_virada_por_regra: resumo.noDeViradaPorRegra,
          precisa_de_revisao: resumo.precisaDeRevisao,
          prompt_version: resumo.promptVersion,
          ai_run_id: resumo.aiRunId,
          gerado_em: new Date().toISOString(),
        },
      },
    })
    .eq('id', activityId);
  erroSe('activities.update', erroDoUpdate);
}

export interface RascunhoAGravar {
  readonly organizationId: string;
  readonly conversationId: string | null;
  readonly contactId: string | null;
  readonly dealId: string | null;
  readonly tipo: 'followup_ligacao' | 'resposta' | 'objecao' | 'onboarding' | 'reativacao' | 'outro';
  readonly aiRunId: number;
  readonly promptVersion: string;
  readonly corpo: string;
  readonly audio: string | null;
  readonly claims: readonly string[];
  readonly validador: Record<string, unknown>;
}

/**
 * A fila de aprovação (ADR-05). O rascunho NASCE pendente — o gatilho
 * `app.message_drafts_guard` recusa qualquer outra coisa —, e quem o aprova
 * precisa de `auth.uid()`, que este worker, com chave de serviço, não tem.
 * A automação não aprova a si mesma nem em teoria.
 */
export async function criarRascunho(
  cliente: ClienteDoBanco,
  rascunho: RascunhoAGravar,
): Promise<string> {
  const { data, error } = await cliente
    .from('message_drafts')
    .insert({
      organization_id: rascunho.organizationId,
      conversation_id: rascunho.conversationId,
      contact_id: rascunho.contactId,
      deal_id: rascunho.dealId,
      kind: rascunho.tipo,
      ai_run_id: rascunho.aiRunId,
      prompt_version: rascunho.promptVersion,
      proposed_body: rascunho.corpo,
      proposed_audio_slug: rascunho.audio,
      proposed_claims: rascunho.claims,
      validator: rascunho.validador,
    })
    .select('id')
    .single();
  erroSe('message_drafts.insert', error);
  return (data as { id: string }).id;
}

/** Já existe rascunho pendente para esta ficha e este tipo? */
export async function temRascunhoPendente(
  cliente: ClienteDoBanco,
  organizationId: string,
  tipo: string,
): Promise<boolean> {
  const { count, error } = await cliente
    .from('message_drafts')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('kind', tipo)
    .eq('status', 'pendente');
  erroSe('message_drafts.count', error);
  return (count ?? 0) > 0;
}
