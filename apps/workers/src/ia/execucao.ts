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
 *   RecusaDoModeloError           → o modelo recusou (`stop_reason = refusal`):
 *                                     determinístico, e a linha de `ai_runs` leva
 *                                     os tokens, porque a recusa é cobrada.
 */
import { randomUUID } from 'node:crypto';

import {
  ImagemNaoDeclaradaError,
  PiiNaChamadaError,
  TipoNaoAuditavelError,
  conferirImagens,
  esquemaDeSaida,
  prepararChamada,
  type ContextoDoContato,
  type ImagemAceita,
  type ImagemParaOModelo,
  type MapaDePseudonimos,
  type ModeloAlvo,
  type PromptVersionado,
  verificarSemPiiNaConversa,
} from '@komune/prompts';

import {
  RecusaDoModeloError,
  RespostaIlegivelError,
  type ChamadaDeFerramenta,
  type ClienteDoModelo,
  type TurnoComFerramentas,
} from './cliente';
import type { BuscaNoMapa } from './mapa';
import { USO_ZERADO, registrarChamada, type VinculosDaChamada } from './registro';

import { ErroDaEsteira, type ClienteDoBanco } from '../fila/esteira';
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

/**
 * A chamada não saiu porque o mês de IA acabou (Fase 3 do pivô).
 *
 * Determinístico pelo mesmo motivo de `AlvoSuprimidoError`: repetir não muda o
 * mundo — o mês continua acabado — e cada volta é uma chamada paga. A mensagem
 * é concluída na fila com a linha de `ai_runs` em `bloqueado` e `cost_usd = 0`,
 * que é o registro de que o freio disparou.
 *
 * Sem tarefa AQUI: `executar()` é genérica e o `digest` não tem conversa. Quem
 * abre a tarefa é quem sabe se há alguém do outro lado esperando resposta —
 * `classificarEntrada`, em `tarefas.ts`.
 */
export class OrcamentoEsgotadoError extends Error {
  readonly motivo: string;
  readonly aiRunId: number;

  constructor(motivo: string, aiRunId: number) {
    super(`A chamada não saiu — o freio do orçamento de IA a segurou: ${motivo}`);
    this.name = 'OrcamentoEsgotadoError';
    this.motivo = motivo;
    this.aiRunId = aiRunId;
  }
}

export interface ContextoDaIa {
  readonly cliente: ClienteDoBanco;
  readonly modelo: ClienteDoModelo;
  readonly logger: Logger;
  /**
   * O transcritor de áudio (`ia/asr.ts`). Opcional porque o Claude não transcreve:
   * quem ouve é um provedor de ASR, e sem ele a esteira segue viva para tudo o que
   * é texto. A tarefa de áudio é que recusa, com nome (CRM Inteligente, Fase 1).
   */
  readonly transcritor?: TranscritorDeAudio;
  /**
   * De que empresa é o banco (`public.empresa_do_banco()`, lido ao ligar). Na Imova
   * a leitura da conversa usa o prompt de imobiliária (`leitura-do-cliente`) e a
   * entrada que só o banco dela monta. Ausente ou outra empresa: o caminho de sempre.
   */
  readonly empresa?: string | null;
  /**
   * O balde privado das mídias recebidas (`mensagens`, migração 20260905000201), de onde
   * o canal de chegada (06/11/2026) e a IA que atende (09/11/2026) baixam as fotos que o
   * cliente mandou. Ausente: a tarefa cai no balde do transcritor, que é o mesmo; sem
   * nenhum dos dois, a foto conta como indisponível.
   */
  readonly baldeDeMidias?: string;
  /**
   * O mapa da IA que atende (Imova, v7, 23/11/2026): o OpenStreetMap com cache. Ausente (sem
   * `NOMINATIM_USER_AGENT` no worker): a busca fica desligada e a IA que atende
   * responde como antes.
   */
  readonly mapa?: BuscaNoMapa;
}

/** O que uma chamada leva além do texto. Hoje, só imagens. */
export interface OpcoesDaExecucao {
  /**
   * Passam por `conferirImagens` antes do POST: prompt que não as declarou recusa
   * (`ImagemNaoDeclaradaError`, registrado em `ai_runs` como `bloqueado`), e o rótulo de
   * cada uma é auditado como a mensagem.
   */
  readonly imagens?: readonly ImagemParaOModelo[];
}

/** Tudo que a tarefa de áudio precisa saber sobre quem ouve. */
export interface TranscritorDeAudio {
  readonly balde: string;
  readonly config: { provedor: string; modelo: string; duracaoMaximaSeg: number };
  readonly chave: string | undefined;
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
  opcoes: OpcoesDaExecucao = {},
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

  // ---------------------------------------------------------------- imagens
  // A porteira das imagens é parte da montagem: o que ela recusa não sai, e fica em
  // `ai_runs` como `bloqueado`, custo zero. Rótulo com dado pessoal é o mesmo guardrail
  // da mensagem, e vira tarefa como ele; imagem num prompt que não a declarou é erro de
  // código, não de dado, e só fica registrada.
  let imagens: readonly ImagemAceita[];
  try {
    const conferidas = conferirImagens(prompt, opcoes.imagens ?? []);
    imagens = conferidas.aceitas;
    if (conferidas.descartadas.length > 0) {
      contexto.logger.warn('imagens que não foram ao modelo', {
        prompt: promptVersion,
        descartadas: conferidas.descartadas.map((d) => `${d.rotulo}: ${d.motivo}`),
      });
    }
  } catch (erro) {
    if (erro instanceof ImagemNaoDeclaradaError || erro instanceof PiiNaChamadaError) {
      const registro = await registrarChamada(contexto.cliente, contexto.logger, {
        ...comum,
        situacao: 'bloqueado',
        uso: USO_ZERADO,
        latenciaMs: null,
        saida: null,
        erro: erro.message.slice(0, 4000),
      });
      contexto.logger.warn('chamada bloqueada na porteira das imagens', {
        prompt: promptVersion,
        ai_run_id: registro.id,
        erro: erro.name,
      });
      if (erro instanceof PiiNaChamadaError) {
        const taskId = await abrirTarefaDeBloqueio(contexto, prompt.id, erro.message, vinculos, registro.id);
        throw new ChamadaBloqueadaError(erro.message, registro.id, taskId);
      }
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

  // ------------------------------------------------------- o freio do dinheiro
  // Depois da supressão e ANTES do POST, na mesma altura e pelo mesmo motivo:
  // é aqui que o dinheiro nasce. A pergunta vai ao banco (ADR-03) porque o teto
  // mora em `app_settings` e tem de mudar sem deploy. Em dois degraus — na
  // linha de alerta param os propósitos que não são de atendimento; no teto
  // inteiro param todos.
  const freio = await orcamentoPermite(contexto, prompt.proposito);
  if (freio !== null) {
    const registro = await registrarChamada(contexto.cliente, contexto.logger, {
      ...comum,
      situacao: 'bloqueado',
      uso: USO_ZERADO,
      latenciaMs: null,
      saida: null,
      erro: `orçamento de IA: ${freio} — a chamada não saiu`,
    });
    contexto.logger.warn('chamada bloqueada: o orçamento de IA acabou', {
      prompt: promptVersion,
      ai_run_id: registro.id,
      proposito: prompt.proposito,
      motivo: freio,
    });
    throw new OrcamentoEsgotadoError(freio, registro.id);
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
      // Sem imagem, o campo nem aparece: o pedido dos outros prompts fica como era.
      ...(imagens.length === 0 ? {} : { imagens }),
    });
  } catch (erro) {
    const texto = erro instanceof Error ? erro.message : String(erro);
    // A recusa custou (veio com `usage`), e a linha leva os tokens: o orçamento conta o
    // que a fatura conta. Os outros erros não têm uso a registrar.
    const recusa = erro instanceof RecusaDoModeloError ? erro : null;
    const registro = await registrarChamada(contexto.cliente, contexto.logger, {
      ...comum,
      situacao: 'erro',
      uso: recusa?.uso ?? USO_ZERADO,
      latenciaMs: Date.now() - comecou,
      saida: null,
      erro: texto.slice(0, 4000),
    });
    if (recusa !== null) {
      contexto.logger.warn('o modelo recusou o pedido', {
        prompt: promptVersion,
        ai_run_id: registro.id,
        categoria: recusa.categoria,
      });
      throw recusa.registrada(registro.id);
    }
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

// ===========================================================================
// O LAÇO COM FERRAMENTAS (a busca no mapa da IA da Imova, v7, 23/11/2026)
// ===========================================================================

/** O laço passou do teto de voltas ou do prazo sem resposta final. Nada foi decidido. */
export class TetoDoLacoError extends Error {
  readonly motivo: 'voltas' | 'prazo';
  readonly aiRunIds: readonly number[];

  constructor(motivo: 'voltas' | 'prazo', aiRunIds: readonly number[]) {
    super(`O laço com ferramentas parou sem resposta final (${motivo === 'voltas' ? 'teto de voltas' : 'prazo'}).`);
    this.name = 'TetoDoLacoError';
    this.motivo = motivo;
    this.aiRunIds = aiRunIds;
  }
}

/** Quem executa uma ferramenta: devolve o texto que volta ao modelo. Nunca lança. */
export type FerramentaDoLaco = (entrada: unknown) => Promise<{ readonly texto: string; readonly erro?: boolean }>;

export interface OpcoesDoLaco {
  /** Quantas idas ao modelo, no máximo (cada uma é uma linha em `ai_runs`). */
  readonly maxVoltas: number;
  /** Prazo do laço inteiro, em ms: passou, a próxima volta não sai. */
  readonly prazoMs?: number;
  /** O modelo, quando a configuração escolheu outro que não o da versão. */
  readonly modelo?: ModeloAlvo;
}

export interface ExecutadaComFerramentas<Saida> {
  readonly saida: Saida;
  readonly mapa: MapaDePseudonimos;
  /** A linha da resposta final (a que a mensagem enviada cita), como em `executar`. */
  readonly aiRunId: number;
  readonly aiRunIds: readonly number[];
  readonly custoUsd: number;
  readonly voltas: number;
  readonly chamadas: readonly { readonly nome: string; readonly entrada: unknown }[];
  readonly promptVersion: string;
}

/**
 * `executar`, em laço, para um prompt com ferramentas.
 *
 * As mesmas portas, na mesma ordem, e a cada volta: a primeira mensagem passa por
 * `prepararChamada` (pseudonimização e auditoria, como toda chamada); antes de CADA ida
 * ao modelo, a supressão do alvo e o freio do orçamento são perguntados de novo; CADA
 * volta vira uma linha em `ai_runs` (modelo, tokens, custo); e CADA resultado de
 * ferramenta passa pela varredura de conversa antes de voltar ao modelo — o resultado é
 * texto que o código montou, mas com dado de fora dentro (o nome que o mapa deu).
 *
 * A última volta não oferece ferramenta (`semFerramentas`): o modelo responde o JSON
 * final com o que já tem. Ainda assim sem resposta final (não deve acontecer), ou prazo
 * estourado: `TetoDoLacoError`, e nada foi decidido.
 *
 * Quem usa: a IA que atende da Imova, desde a v7 (23/11/2026), com `buscar_no_mapa`.
 */
export async function executarComFerramentas<Entrada, Saida>(
  contexto: ContextoDaIa,
  prompt: PromptVersionado<Entrada, Saida>,
  entrada: unknown,
  contato: ContextoDoContato,
  vinculos: VinculosDaChamada,
  ferramentas: Readonly<Record<string, FerramentaDoLaco>>,
  opcoes: OpcoesDoLaco,
): Promise<ExecutadaComFerramentas<Saida>> {
  const promptVersion = `${prompt.id}@v${prompt.versao}`;
  const modelo = opcoes.modelo ?? prompt.modelo;
  const comum = { proposito: prompt.proposito, modelo, promptVersion, vinculos } as const;
  const conversarComFerramentas = contexto.modelo.conversarComFerramentas?.bind(contexto.modelo);
  if (conversarComFerramentas === undefined) {
    throw new Error(`o cliente do modelo não conversa com ferramentas (${promptVersion})`);
  }
  if (prompt.ferramentas === undefined || prompt.ferramentas.length === 0) {
    throw new Error(`${promptVersion} não declara ferramentas: use executar`);
  }

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

  const comecou = Date.now();
  const aiRunIds: number[] = [];
  const feitas: { nome: string; entrada: unknown }[] = [];
  let custoUsd = 0;
  const turnos: TurnoComFerramentas[] = [{ papel: 'usuario', texto: chamada.mensagem }];
  const bloquear = async (erro: string): Promise<number> => {
    const registro = await registrarChamada(contexto.cliente, contexto.logger, {
      ...comum,
      situacao: 'bloqueado',
      uso: USO_ZERADO,
      latenciaMs: null,
      saida: null,
      erro,
    });
    aiRunIds.push(registro.id);
    return registro.id;
  };

  for (let volta = 1; volta <= opcoes.maxVoltas; volta += 1) {
    if (opcoes.prazoMs !== undefined && Date.now() - comecou > opcoes.prazoMs) {
      throw new TetoDoLacoError('prazo', aiRunIds);
    }
    if (await alvoEstaSuprimido(contexto, vinculos)) {
      const id = await bloquear('alvo suprimido na entrega (RF-CON-18): a volta não saiu');
      throw new AlvoSuprimidoError(vinculos.organizationId ?? null, id);
    }
    const freio = await orcamentoPermite(contexto, prompt.proposito);
    if (freio !== null) {
      const id = await bloquear(`orçamento de IA: ${freio} — a volta não saiu`);
      throw new OrcamentoEsgotadoError(freio, id);
    }

    const inicioDaVolta = Date.now();
    let resposta;
    try {
      resposta = await conversarComFerramentas({
        modelo,
        sistema: chamada.sistema,
        maxTokens: chamada.maxTokens,
        esquema: esquemaDeSaida(prompt),
        ferramentas: prompt.ferramentas,
        turnos,
        ...(volta === opcoes.maxVoltas ? { semFerramentas: true } : {}),
      });
    } catch (erro) {
      const recusa = erro instanceof RecusaDoModeloError ? erro : null;
      const registro = await registrarChamada(contexto.cliente, contexto.logger, {
        ...comum,
        situacao: 'erro',
        uso: recusa?.uso ?? USO_ZERADO,
        latenciaMs: Date.now() - inicioDaVolta,
        saida: null,
        erro: (erro instanceof Error ? erro.message : String(erro)).slice(0, 4000),
      });
      aiRunIds.push(registro.id);
      if (recusa !== null) throw recusa.registrada(registro.id);
      throw erro;
    }

    if (resposta.tipo === 'final') {
      let saida: Saida;
      try {
        saida = chamada.interpretar(resposta.json);
      } catch (erro) {
        const registro = await registrarChamada(contexto.cliente, contexto.logger, {
          ...comum,
          situacao: 'erro',
          uso: resposta.uso,
          latenciaMs: Date.now() - inicioDaVolta,
          saida: resposta.json,
          erro: `a saída não passou pelo schema de ${promptVersion}: ${
            erro instanceof Error ? erro.message : String(erro)
          }`.slice(0, 4000),
        });
        aiRunIds.push(registro.id);
        throw new RespostaIlegivelError(`fora do schema de ${promptVersion}`);
      }
      const registro = await registrarChamada(contexto.cliente, contexto.logger, {
        ...comum,
        situacao: 'ok',
        uso: resposta.uso,
        latenciaMs: Date.now() - inicioDaVolta,
        saida,
        erro: null,
      });
      aiRunIds.push(registro.id);
      custoUsd += registro.custoUsd;
      contexto.logger.info('laço com ferramentas concluído', {
        prompt: promptVersion,
        modelo: resposta.modelo,
        voltas: volta,
        ferramentas: feitas.length,
        custo_usd: Math.round(custoUsd * 1e6) / 1e6,
        latencia_ms: Date.now() - comecou,
      });
      return {
        saida,
        mapa: chamada.mapa,
        aiRunId: registro.id,
        aiRunIds,
        custoUsd,
        voltas: volta,
        chamadas: feitas,
        promptVersion,
      };
    }

    // O modelo pediu ferramentas: a volta é registrada com o que ele pediu.
    const pedidas: readonly ChamadaDeFerramenta[] = resposta.chamadas;
    const registro = await registrarChamada(contexto.cliente, contexto.logger, {
      ...comum,
      situacao: 'ok',
      uso: resposta.uso,
      latenciaMs: Date.now() - inicioDaVolta,
      saida: { volta, ferramentas: pedidas.map((c) => ({ nome: c.nome, entrada: c.entrada })) },
      erro: null,
    });
    aiRunIds.push(registro.id);
    custoUsd += registro.custoUsd;

    const resultados: { id: string; texto: string; erro: boolean }[] = [];
    for (const pedida of pedidas) {
      feitas.push({ nome: pedida.nome, entrada: pedida.entrada });
      const executora = ferramentas[pedida.nome];
      let resultado: { texto: string; erro?: boolean };
      if (executora === undefined) {
        resultado = { texto: `ferramenta desconhecida: ${pedida.nome}`, erro: true };
      } else {
        try {
          resultado = await executora(pedida.entrada);
        } catch (erro) {
          contexto.logger.warn('a ferramenta falhou', {
            prompt: promptVersion,
            ferramenta: pedida.nome,
            erro: erro instanceof Error ? erro.message.slice(0, 300) : String(erro),
          });
          resultado = { texto: 'a ferramenta falhou agora; siga com o que já tem', erro: true };
        }
      }
      // O resultado volta ao modelo: a mesma auditoria do que vem de fora. O que ela
      // barra não sai (fica registrado como bloqueado) e o modelo recebe "indisponível":
      // a resposta ao cliente não cai por causa de uma ferramenta.
      const problemas = verificarSemPiiNaConversa(resultado.texto);
      if (problemas.length > 0) {
        await bloquear(`o resultado de ${pedida.nome} trouxe ${problemas.map((p) => p.tipo).join(', ')}: não voltou ao modelo`);
        contexto.logger.warn('o resultado da ferramenta foi barrado pela auditoria', {
          prompt: promptVersion,
          ferramenta: pedida.nome,
          tipos: problemas.map((p) => p.tipo),
        });
        resultado = { texto: 'resultado indisponível agora; siga com o que já tem', erro: true };
      }
      resultados.push({ id: pedida.id, texto: resultado.texto, erro: resultado.erro === true });
    }
    turnos.push({ papel: 'assistente', conteudo: resposta.conteudo }, { papel: 'resultados', resultados });
  }
  throw new TetoDoLacoError('voltas', aiRunIds);
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
 * Pergunta ao banco se ainda dá para gastar com este propósito.
 *
 * Devolve `null` quando pode, e o motivo quando não pode. Erro de RPC sobe:
 * um freio que não consegue perguntar não pode responder "então pode".
 */
async function orcamentoPermite(contexto: ContextoDaIa, proposito: string): Promise<string | null> {
  const { data, error } = await contexto.cliente.rpc('ia_pode_gastar', { p_purpose: proposito });
  if (error) throw new ErroDaEsteira('ia_pode_gastar', error.message);
  const resposta = (data ?? {}) as { pode?: unknown; motivo?: unknown };
  if (resposta.pode === true) return null;
  return typeof resposta.motivo === 'string' && resposta.motivo !== ''
    ? resposta.motivo
    : 'orcamento_esgotado';
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
