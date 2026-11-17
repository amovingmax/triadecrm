/**
 * Ajustes → Integrações: as regras sem tela (17/11/2026).
 *
 * O que dá para decidir sem React e sem banco: o endereço da API desta empresa,
 * a situação de cada chave e de cada webhook em português, a conferência do
 * endereço do webhook antes de mandar ao banco (o banco confere de novo; aqui é
 * para a pessoa saber na hora) e o resumo das entregas.
 */

export type Escopo = { id: string; nome: string; descricao: string };
export type Evento = { id: string; descricao: string };
export type PessoaDaGestao = { id: string; nome: string; papel: string };
export type Pessoa = { id: string; nome: string } | null;

export type Chave = {
  id: string;
  nome: string;
  prefixo: string;
  escopos: string[];
  em_nome_de: Pessoa;
  em_nome_de_tem_acesso: boolean;
  criada_por: Pessoa;
  criada_em: string;
  usada_em: string | null;
  revogada_em: string | null;
  revogada_por: Pessoa;
  limite_por_minuto: number;
  chamadas_24h: number;
  erros_24h: number;
};

export type Webhook = {
  id: string;
  url: string;
  eventos: string[];
  descricao: string | null;
  segredo_prefixo: string;
  ativo: boolean;
  pausado_em: string | null;
  pausado_motivo: string | null;
  falhas_seguidas: number;
  ultima_entrega_em: string | null;
  ultima_falha_em: string | null;
  origem: 'api' | 'ajustes';
  chave: { id: string; nome: string } | null;
  criado_por: Pessoa;
  criado_em: string;
  pendentes: number;
  entregues_7d: number;
  falharam_7d: number;
};

export type Entrega = {
  id: string;
  evento: string;
  situacao: 'pendente' | 'enviando' | 'entregue' | 'falhou';
  tentativas: number;
  ultimo_status: number | null;
  ultimo_erro: string | null;
  criado_em: string;
  entregue_em: string | null;
  proxima_em: string;
};

export type Integracoes = {
  empresa: string | null;
  escopos: Escopo[];
  eventos: Evento[];
  pessoas: PessoaDaGestao[];
  chaves: Chave[];
  webhooks: Webhook[];
};

/** O endereço da API desta empresa: o projeto Supabase dela, função `api`. */
export function enderecoDaApi(urlDoSupabase: string): string {
  return `${urlDoSupabase.replace(/\/+$/, '')}/functions/v1/api`;
}

export type SituacaoDaChave = { texto: string; tom: 'ok' | 'apagado' | 'problema' };

/** Revogada vence tudo; depois, a pessoa da chave sem acesso (a chave já não abre). */
export function situacaoDaChave(chave: Chave): SituacaoDaChave {
  if (chave.revogada_em) return { texto: 'Revogada', tom: 'apagado' };
  if (!chave.em_nome_de_tem_acesso) {
    return { texto: 'Parada: a pessoa da chave não é mais admin ou gestor', tom: 'problema' };
  }
  if (!chave.usada_em) return { texto: 'Ativa, nunca usada', tom: 'ok' };
  return { texto: 'Ativa', tom: 'ok' };
}

/** "Fichas: ler e escrever · Funil: ler" — curto, na ordem da tela de criar. */
export function resumoDosEscopos(escopos: readonly string[], catalogo: readonly Escopo[]): string {
  const nomes = catalogo.filter((e) => escopos.includes(e.id)).map((e) => e.nome);
  if (nomes.length === catalogo.length && catalogo.length > 0) return 'Tudo';
  return nomes.join(' · ');
}

const MOTIVOS_DA_PAUSA: Record<string, string> = {
  falhas_seguidas: 'Pausado: falhou 25 vezes seguidas sem nenhuma entrega em 24 h',
  destino_respondeu_410: 'Pausado: o destino respondeu 410 (não quer mais receber)',
  pausado_na_tela: 'Pausado na tela',
};

export function situacaoDoWebhook(w: Webhook): SituacaoDaChave {
  if (!w.ativo) {
    return {
      texto: MOTIVOS_DA_PAUSA[w.pausado_motivo ?? ''] ?? 'Pausado',
      tom: w.pausado_motivo === 'pausado_na_tela' ? 'apagado' : 'problema',
    };
  }
  if (w.falhas_seguidas > 0) {
    return {
      texto: `Ativo, mas as últimas ${w.falhas_seguidas === 1 ? 'falhou' : `${w.falhas_seguidas} falharam`}`,
      tom: 'problema',
    };
  }
  return { texto: 'Ativo', tom: 'ok' };
}

export function rotuloDaEntrega(e: Entrega): string {
  switch (e.situacao) {
    case 'entregue':
      return `Entregue${e.ultimo_status ? ` (${e.ultimo_status})` : ''}`;
    case 'enviando':
      return 'Saindo agora';
    case 'pendente':
      return e.tentativas === 0 ? 'Na fila' : `Vai tentar de novo (${e.tentativas}ª falhou)`;
    case 'falhou':
      return `Desistiu depois de ${e.tentativas} ${e.tentativas === 1 ? 'tentativa' : 'tentativas'}`;
  }
}

/** A mesma conferência do banco (`app.api_webhook_novo`), para avisar antes de mandar. */
export function problemaDaUrl(url: string): string | null {
  const texto = url.trim();
  if (texto.length === 0) return 'Escreva o endereço que vai receber os avisos.';
  if (!/^https:\/\//i.test(texto)) return 'O endereço precisa começar com https://.';
  if (texto.length > 500) return 'O endereço passa de 500 caracteres.';
  let host: string;
  try {
    host = new URL(texto).hostname.toLowerCase();
  } catch {
    return 'Isto não parece um endereço da internet.';
  }
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost') ||
    host.startsWith('[') ||
    /^(127|10|0)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return 'O endereço precisa ser público na internet, não da rede interna.';
  }
  return null;
}

/** As recusas das funções de Ajustes (`motivo`), em português. */
export const MOTIVOS_DE_RECUSA: Record<string, string> = {
  sem_permissao: 'Só admin e gestor mexem nas integrações.',
  nome_invalido: 'Dê um nome de 2 a 80 letras à chave (por exemplo, o sistema que vai usá-la).',
  escopos_invalidos: 'Marque pelo menos uma permissão.',
  em_nome_de_invalido: 'A chave só pode agir em nome de um admin ou gestor ativo.',
  chave_inexistente: 'Esta chave já foi revogada.',
  url_invalida: 'O endereço precisa começar com https:// e ter até 500 caracteres.',
  url_interna: 'O endereço precisa ser público na internet.',
  eventos_invalidos: 'Marque pelo menos um evento.',
  descricao_longa: 'A descrição passa de 200 caracteres.',
  webhooks_demais: 'Já existem 20 webhooks. Apague um que não é mais usado.',
  webhook_inexistente: 'Este webhook não existe mais. Atualize a tela.',
};

export function fraseDaRecusa(motivo: string | undefined): string {
  return (
    MOTIVOS_DE_RECUSA[motivo ?? ''] ?? 'O CRM recusou o pedido. Atualize a tela e tente de novo.'
  );
}
