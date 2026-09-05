/**
 * A execução de UMA chamada ao modelo — e a única daqui até a API.
 *
 * A regra que manda no arquivo: **toda chamada passa por `prepararChamada`**
 * (packages/prompts). Nada aqui monta prompt, concatena texto do lead ou fala
 * com o modelo por fora. `prepararChamada` valida a entrada contra o schema da
 * versão, pseudonimiza os campos declarados, separa o que é nosso do que veio de
 * fora, monta a mensagem e **audita a montagem com uma segunda implementação**.
 * O que este arquivo faz é o resto: medir, registrar e traduzir o que deu errado.
 *
 * ## Quando o guardrail para a chamada, isso é o desenho
 *
 * `PiiNaChamadaError` e `TipoNaoAuditavelError` não são falhas a contornar. São
 * a auditoria dizendo "não posso afirmar que isto sai sem telefone". A chamada
 * não sai, a linha entra em `ai_runs` com `status = 'bloqueado'` e custo zero, e
 * **vira tarefa para uma pessoa** — que é como este banco fala com gente
 * (mesmo caminho de `app.ai_alerta_orcamento`). Repetir não muda nada: o erro é
 * determinístico e a mensagem é concluída na fila em vez de girar até a
 * dead-letter.
 *
 * ## O que é transitório e o que não é
 *
 *   ErroDoModelo(transitorio)     → volta com backoff (rede, 429, 5xx).
 *   ErroDoModelo(determinístico)  → 400/401: repetir gasta a mesma recusa.
 *   RespostaIlegivelError, ZodError → a saída não serve; repetir talvez sirva,
 *                                     mas não cinco vezes. Uma tentativa a mais
 *                                     é da fila; o teto é o da fila.
 */
import { randomUUID } from 'node:crypto';

import {
  PiiNaChamadaError,
  TipoNaoAuditavelError,
  esquemaDeSaida,
  prepararChamada,
  type ContextoDoContato,
  type MapaDePseudonimos,
  type PromptVersionado,
} from '@komune/prompts';

import { RespostaIlegivelError, type ClienteDoModelo } from './cliente';
import { USO_ZERADO, registrarChamada, type VinculosDaChamada } from './registro';

import { ErroDaEsteira, type ClienteDoBanco } from '../ingest/esteira';
import type { Logger } from '../lib/log';

/**
 * A chamada não saiu porque a auditoria de PII a segurou. Determinístico: não
 * se repete, e a pessoa que a resolve já foi avisada por tarefa.
 */
export class ChamadaBloqueadaError extends Error {
  readonly aiRunId: number;
  readonly taskId: string | null;

  constructor(motivo: string, aiRunId: number, taskId: string | null) {
    super(`A chamada não saiu — o guardrail de PII a segurou: ${motivo}`);
    this.name = 'ChamadaBloqueadaError';
    this.aiRunId = aiRunId;
    this.taskId = taskId;
  }
}

/**
 * A chamada não saiu porque o alvo está suprimido (laudo §3.3, RF-CON-18).
 *
 * Determinístico, e por dois motivos: repetir não muda o mundo (quem pediu
 * para sair continuou tendo pedido) e repetir CUSTA — cada volta é uma chamada
 * paga. A mensagem é concluída na fila, com a linha de `ai_runs` em
 * `bloqueado` para provar que o guardrail disparou. Sem tarefa: o opt-out
 * acabou de cancelar as tarefas dessa ficha, e abrir uma nova seria desfazer
 * com a mão de trás o que a mão da frente fez.
 */
export class AlvoSuprimidoError extends Error {
  readonly organizationId: string | null;
  readonly aiRunId: number;

  constructor(organizationId: string | null, aiRunId: number) {
    super(
      'A chamada não saiu — o alvo está suprimido (do_not_contact ou suppression_list) ' +
        'entre a leitura da fila e a entrega.',
    );
    this.name = 'AlvoSuprimidoError';
    this.organizationId = organizationId;
    this.aiRunId = aiRunId;
  }
}

export interface ContextoDaIa {
  readonly cliente: ClienteDoBanco;
  readonly modelo: ClienteDoModelo;
  readonly logger: Logger;
}

export interface Executada<Saida> {
  readonly saida: Saida;
  /** Para reidratar o que uma pessoa vai ler — nunca o que volta ao modelo. */
  readonly mapa: MapaDePseudonimos;
  readonly aiRunId: number;
  readonly custoUsd: number;
  readonly promptVersion: string;
}

/**
 * O id que o modelo enxerga.
 *
 * Seis dígitos hexadecimais, e não o uuid cru: um uuid tem 32 algarismos e
 * 11% deles contêm uma corrida de dez dígitos começando por DDD válido — a
 * auditoria, que é burra de propósito, recusaria uma chamada em cada nove. Seis
 * caracteres não alcançam a janela local (mínimo de oito dígitos), então nenhum
 * sorteio vira telefone. Quem liga a linha à ficha é `ai_runs.organization_id`.
 */
export function leadIdCurto(organizationId: string | null): string {
  const hex = (organizationId ?? randomUUID()).replace(/[^0-9a-f]/gi, '').slice(0, 6);
  return `lead-${hex.toLowerCase()}`;
}

export async function executar<Entrada, Saida>(
  contexto: ContextoDaIa,
  prompt: PromptVersionado<Entrada, Saida>,
  entrada: unknown,
  contato: ContextoDoContato,
  vinculos: VinculosDaChamada,
): Promise<Executada<Saida>> {
  const promptVersion = `${prompt.id}@v${prompt.versao}`;
  const comum = {
    proposito: prompt.proposito,
    modelo: prompt.modelo,
    promptVersion,
    vinculos,
  } as const;

  // ---------------------------------------------------------------- montagem
  let chamada;
  try {
    chamada = prepararChamada(prompt, entrada, contato);
  } catch (erro) {
    if (erro instanceof PiiNaChamadaError || erro instanceof TipoNaoAuditavelError) {
      const registro = await registrarChamada(contexto.cliente, contexto.logger, {
        ...comum,
        situacao: 'bloqueado',
        uso: USO_ZERADO,
        latenciaMs: null,
        saida: null,
        erro: erro.message.slice(0, 4000),
      });
      const taskId = await abrirTarefaDeBloqueio(contexto, prompt.id, erro.message, vinculos, registro.id);
      contexto.logger.warn('chamada bloqueada pelo guardrail de PII', {
        prompt: promptVersion,
        ai_run_id: registro.id,
        task_id: taskId,
        erro: erro.name,
      });
      throw new ChamadaBloqueadaError(erro.message, registro.id, taskId);
    }
    throw erro;
  }

  // ------------------------------------------------- reconferência da entrega
  // (laudo §3.3) A fila foi lida há até cinco minutos — é o `visibility
  // timeout` de `ai_jobs` — e um opt-out pode ter chegado nesse intervalo, pela
  // conversa, pela ligação ou pelo botão da tela. A mesma lição da migração
  // 20260905000100 (o dreno da Komune) e de `public.wa_saida_proximos`:
  // reconferir na ENTREGA, não só na entrada. Aqui a montagem já aconteceu (é
  // barata e não sai da máquina); o que não pode acontecer é o POST.
  if (await alvoEstaSuprimido(contexto, vinculos)) {
    const registro = await registrarChamada(contexto.cliente, contexto.logger, {
      ...comum,
      situacao: 'bloqueado',
      uso: USO_ZERADO,
      latenciaMs: null,
      saida: null,
      erro: 'alvo suprimido na entrega (RF-CON-18): a chamada não saiu',
    });
    contexto.logger.warn('chamada bloqueada: o alvo ficou suprimido antes da entrega', {
      prompt: promptVersion,
      ai_run_id: registro.id,
      organization_id: vinculos.organizationId ?? null,
      guardrail: 'RF-CON-18',
    });
    throw new AlvoSuprimidoError(vinculos.organizationId ?? null, registro.id);
  }

  // ---------------------------------------------------------------- chamada
  const comecou = Date.now();
  let resposta;
  try {
    resposta = await contexto.modelo.conversar({
      modelo: chamada.modelo,
      sistema: chamada.sistema,
      mensagem: chamada.mensagem,
      maxTokens: chamada.maxTokens,
      esquema: esquemaDeSaida(prompt),
    });
  } catch (erro) {
    const texto = erro instanceof Error ? erro.message : String(erro);
    await registrarChamada(contexto.cliente, contexto.logger, {
      ...comum,
      situacao: 'erro',
      uso: USO_ZERADO,
      latenciaMs: Date.now() - comecou,
      saida: null,
      erro: texto.slice(0, 4000),
    });
    throw erro;
  }

  // ------------------------------------------------------ saída pelo schema
  let saida: Saida;
  try {
    saida = chamada.interpretar(resposta.json);
  } catch (erro) {
    const texto = erro instanceof Error ? erro.message : String(erro);
    // A saída torta é gravada assim mesmo: é ela que explica o eval que falhou.
    await registrarChamada(contexto.cliente, contexto.logger, {
      ...comum,
      situacao: 'erro',
      uso: resposta.uso,
      latenciaMs: Date.now() - comecou,
      saida: resposta.json,
      erro: `a saída não passou pelo schema de ${promptVersion}: ${texto}`.slice(0, 4000),
    });
    throw new RespostaIlegivelError(`fora do schema de ${promptVersion}`);
  }

  const registro = await registrarChamada(contexto.cliente, contexto.logger, {
    ...comum,
    situacao: 'ok',
    uso: resposta.uso,
    latenciaMs: Date.now() - comecou,
    // Pseudonimizada, como veio: `ai_runs.output` nunca guarda o texto original
    // do fornecedor (ADR-09). A reidratação acontece onde a pessoa lê.
    saida,
    erro: null,
  });

  contexto.logger.info('chamada ao modelo concluída', {
    prompt: promptVersion,
    modelo: resposta.modelo,
    ai_run_id: registro.id,
    custo_usd: registro.custoUsd,
    tokens: resposta.uso,
    latencia_ms: Date.now() - comecou,
  });

  return {
    saida,
    mapa: chamada.mapa,
    aiRunId: registro.id,
    custoUsd: registro.custoUsd,
    promptVersion,
  };
}

/**
 * O alvo está suprimido AGORA?
 *
 * Quem responde é o Postgres (`app.is_suppressed_target`, pela boca
 * `public.alvo_suprimido`), porque é lá que o estado mora. Sem vínculo nenhum
 * não há o que perguntar — e não perguntar não é o mesmo que liberar: o
 * consumidor da fila já perguntou pelo payload, com o alvo resolvido a partir
 * da mensagem, da conversa, da tentativa ou do negócio.
 *
 * Erro de rede sobe: a mensagem volta para a fila com backoff. "Não sei" não
 * vira "então vou".
 */
async function alvoEstaSuprimido(
  contexto: ContextoDaIa,
  vinculos: VinculosDaChamada,
): Promise<boolean> {
  const organizationId = vinculos.organizationId ?? null;
  const contactId = vinculos.contactId ?? null;
  if (organizationId === null && contactId === null) return false;
  const { data, error } = await contexto.cliente.rpc('alvo_suprimido', {
    p_organization_id: organizationId,
    p_contact_id: contactId,
  });
  if (error) throw new ErroDaEsteira('alvo_suprimido', error.message);
  return data === true;
}

/**
 * "O erro vira trabalho para humano."
 *
 * A tarefa é como o Tríade fala com uma pessoa. Vai para quem responde pela
 * ficha; sem dono, para o admin mais antigo. Se nem isso houver, a linha de
 * `ai_runs` continua lá — perder o registro seria pior que perder o aviso, que
 * é exatamente o que `app.ai_alerta_orcamento` já decidiu para o orçamento.
 */
async function abrirTarefaDeBloqueio(
  contexto: ContextoDaIa,
  promptId: string,
  motivo: string,
  vinculos: VinculosDaChamada,
  aiRunId: number,
): Promise<string | null> {
  const dono = await responsavel(contexto, vinculos.organizationId ?? null);
  if (dono === null) return null;

  const { data, error } = await contexto.cliente
    .from('tasks')
    .insert({
      title:
        `IA bloqueada pelo guardrail de PII em ${promptId} (ai_run ${aiRunId}): ` +
        `${motivo.slice(0, 200)}`.replace(/\s+/g, ' '),
      kind: 'other',
      due_at: new Date().toISOString(),
      assignee_id: dono,
      organization_id: vinculos.organizationId ?? null,
      origin: 'ai',
      priority: 1,
    })
    .select('id')
    .single();

  if (error) {
    contexto.logger.warn('não deu para abrir a tarefa do bloqueio', { erro: error.message });
    return null;
  }
  return (data as { id: string }).id;
}

async function responsavel(contexto: ContextoDaIa, organizationId: string | null): Promise<string | null> {
  if (organizationId !== null) {
    const { data } = await contexto.cliente
      .from('organizations')
      .select('owner_id')
      .eq('id', organizationId)
      .maybeSingle();
    const dono = (data as { owner_id: string | null } | null)?.owner_id ?? null;
    if (dono !== null) return dono;
  }
  const { data } = await contexto.cliente
    .from('profiles')
    .select('id')
    .eq('is_active', true)
    .eq('role', 'admin')
    .order('created_at')
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
