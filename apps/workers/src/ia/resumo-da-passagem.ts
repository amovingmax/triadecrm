/**
 * O resumo da passagem (Imova, 11/11/2026).
 *
 * Pedido do usuário: quando a IA que atende passa a conversa para a equipe, "deixar um
 * resumo para o corretor não precisar ler a conversa inteira". O banco pede (o gatilho
 * `ia_respostas_pede_resumo` abre a linha `pedido` e põe `resumir_passagem` na fila quando
 * nasce a linha da passagem, pela IA, pela regra do "quero falar com um corretor", pelo
 * freio do orçamento, pelo teto ou pelo `passarParaGente` do worker); este trabalho lê a
 * conversa ATÉ a passagem pela porta do banco (`public.ia_resumo_da_passagem_entrada`),
 * pede o resumo ao Haiku 5.5 (`resumo-da-passagem@v1`, pseudonimizado pelo `executar`) e o
 * grava pela outra porta (`public.ia_resumo_da_passagem_gravar`), que confere as provas de
 * novo e põe o resumo no título da tarefa que avisou o corretor.
 *
 * ## A prova prova o conteúdo (revisão de 11/11/2026)
 *
 * Cada campo dito vem com o trecho literal da mensagem do cliente. Os trechos voltam com os
 * nomes de verdade (o modelo viu marcadores) antes da conferência, que é a do prompt
 * (`conferirResumoDaPassagem`): o trecho está na mensagem, o valor bate com ele, o código é
 * da Imova e, ofertado pela IA, o cliente falou dele depois.
 *
 * ## A passagem não espera por ele
 *
 * O cliente já foi entregue quando este trabalho começa: é outro item da fila, depois da
 * transação da passagem. TODO fim sem resumo fica registrado
 * (`public.ia_resumo_da_passagem_falhou`), para a tela dizer "leia a conversa" em vez de
 * prometer um resumo que não vem:
 *
 *   dado_pessoal             a conversa tem telefone, e-mail ou @ que não pode ir ao modelo
 *                            (a mesma conferência do `executar`, feita antes, para não abrir
 *                            uma segunda tarefa de bloqueio: a IA que atende já abriu a dela;
 *                            a linha `bloqueado` em `ai_runs` fica, como no `executar`);
 *   orcamento                o mês de IA chegou ao limite (sem dívida: resumo de mês que vem
 *                            não serve a ninguém);
 *   erro_do_modelo           o modelo recusou, ou devolveu algo fora do combinado;
 *   suprimido                o cliente pediu para sair entre a passagem e o resumo;
 *   sem_mensagem_do_cliente  não há o que resumir;
 *   erro_interno             o banco respondeu fora do combinado.
 *
 * Só rede, 429 e 5xx voltam para a fila, porque repetir resolve.
 *
 * ## O que ele nunca faz
 *
 * Não escreve para o cliente, não muda a conversa e não põe o resumo no log: depois de
 * reidratado ele tem o nome do cliente, e o log do worker não leva nome nem telefone.
 */
import { z } from 'zod';

import {
  PiiNaChamadaError,
  TipoNaoAuditavelError,
  conferirResumoDaPassagem,
  encurtarTexto,
  prepararChamada,
  reidratar,
  resumoDaPassagemV1,
  versaoDoPrompt,
  type EntradaDoResumoDaPassagem,
  type MapaDePseudonimos,
  type SaidaDoResumoDaPassagem,
} from '@komune/prompts';

import { ErroDaEsteira } from '../fila/esteira';
import { limparTexto } from './atendente';
import { buscarContatoDaFicha } from './banco';
import { ErroDoModelo, RecusaDoModeloError, RespostaIlegivelError } from './cliente';
import { ErroDeterministico } from './erros';
import {
  AlvoSuprimidoError,
  ChamadaBloqueadaError,
  OrcamentoEsgotadoError,
  type ContextoDaIa,
  executar,
  leadIdCurto,
} from './execucao';
import { USO_ZERADO, registrarChamada } from './registro';

const uuid = z.string().uuid();

/** O que o gatilho `app.ia_resumo_pedir` põe na fila (mais a `chave`, que a esteira usa). */
export const payloadDoResumoDaPassagem = z.object({
  purpose: z.literal('resumir_passagem'),
  resposta_id: uuid,
  conversation_id: uuid,
});

/** O que `public.ia_resumo_da_passagem_entrada` devolve. */
const entradaDoBanco = z.object({
  existe: z.boolean(),
  passagem: z.boolean().optional(),
  resposta_id: uuid.optional(),
  conversation_id: uuid.optional(),
  organization_id: uuid.nullable().optional(),
  contact_id: uuid.nullable().optional(),
  nome: z.string().nullable().optional(),
  treino: z.boolean().optional(),
  teste: z.boolean().optional(),
  simulada: z.boolean().optional(),
  ja_resumida: z.boolean().optional(),
  motivo: z.string().nullable().optional(),
  agora_por_extenso: z.string().nullable().optional(),
  visitas: z.array(z.object({ quando: z.string(), estado: z.string() })).optional(),
  imoveis_citados: z
    .array(z.object({ codigo: z.string(), palavras: z.array(z.string()) }))
    .optional(),
  mensagens: z
    .array(
      z.object({
        id: uuid,
        de: z.enum(['cliente', 'ia', 'equipe', 'sistema']),
        quem: z.string().nullable(),
        quando: z.string(),
        texto: z.string().nullable(),
      }),
    )
    .optional(),
});

export type EntradaDoBancoDoResumo = z.infer<typeof entradaDoBanco>;

/** Por que o resumo não saiu: é o que a tela traduz para a pessoa. */
export type MotivoSemResumo =
  | 'dado_pessoal'
  | 'orcamento'
  | 'erro_do_modelo'
  | 'suprimido'
  | 'sem_mensagem_do_cliente'
  | 'erro_interno';

export interface ResultadoDoResumo {
  readonly feito: boolean;
  readonly motivo?: string;
  readonly aiRunId?: number;
  readonly custoUsd?: number;
  readonly detalhes?: Record<string, unknown>;
}

/**
 * A entrada do prompt, a partir do que o banco devolveu. As mensagens ganham rótulo curto
 * (m1, m2...) no lugar do uuid, como na IA que atende, e o mapa devolve o rótulo ao uuid
 * na hora de gravar as provas.
 */
export function montarEntradaDoResumo(
  e: EntradaDoBancoDoResumo,
  leadId: string,
): { entrada: EntradaDoResumoDaPassagem; rotulos: Map<string, string> } {
  const ultimas = (e.mensagens ?? []).slice(-60);
  const rotulos = new Map(ultimas.map((m, indice) => [`m${indice + 1}`, m.id]));
  return {
    rotulos,
    entrada: {
      leadId,
      passouEm: (e.agora_por_extenso ?? '').trim().slice(0, 80) || 'agora há pouco',
      motivoDaPassagem: e.motivo?.trim().slice(0, 300) || null,
      visitas: (e.visitas ?? []).slice(0, 5).map((v) => ({
        quando: v.quando.slice(0, 80),
        estado: v.estado.slice(0, 40),
      })),
      imoveisCitados: (e.imoveis_citados ?? [])
        .filter((i) => i.codigo.trim() !== '' && i.codigo.length <= 40)
        .slice(0, 20)
        .map((i) => ({
          codigo: i.codigo,
          palavras: i.palavras.filter((p) => p.length <= 40).slice(0, 12),
        })),
      mensagens: ultimas.map((m, indice) => ({
        messageId: `m${indice + 1}`,
        de: m.de,
        quem: m.quem === null ? null : m.quem.slice(0, 60),
        quando: m.quando.slice(0, 40),
        texto: (m.texto ?? '').slice(0, 2000),
      })),
    },
  };
}

/**
 * A saída com os nomes de volta, sem marcador sobrando. Vale também para os TRECHOS: o
 * modelo copiou o que viu ("Aqui é o [[NOME_1]]"), e a conferência compara com a conversa
 * de verdade.
 */
export function reidratarResumo(
  s: SaidaDoResumoDaPassagem,
  mapa: MapaDePseudonimos,
): SaidaDoResumoDaPassagem {
  const t = (texto: string): string => limparTexto(reidratar(texto, mapa));
  const dito = <V>(d: { valor: V; trecho: string; prova: string } | null, valorTexto: boolean) =>
    d === null
      ? null
      : {
          ...d,
          valor: (valorTexto && typeof d.valor === 'string' ? t(d.valor) : d.valor) as V,
          trecho: t(d.trecho),
        };
  return {
    ...s,
    procura: {
      negocio: dito(s.procura.negocio, false),
      tipo: dito(s.procura.tipo, true),
      regiao: dito(s.procura.regiao, true),
    },
    imoveis: s.imoveis.map((i) => ({
      ...i,
      confirmacao:
        i.confirmacao === null ? null : { ...i.confirmacao, trecho: t(i.confirmacao.trecho) },
    })),
    orcamento: {
      valor: dito(s.orcamento.valor, true),
      pagamento: dito(s.orcamento.pagamento, false),
    },
    objecao:
      s.objecao === null
        ? null
        : { ...s.objecao, comoDisse: t(s.objecao.comoDisse), trecho: t(s.objecao.trecho) },
    temperaturaPorque: t(s.temperaturaPorque),
    porquePassou: t(s.porquePassou),
    proximoPasso: t(s.proximoPasso),
  };
}

/**
 * O resumo (já reidratado e conferido) no formato que a porta de escrita lê: rótulo vira
 * uuid (o que não tem uuid sai), e o texto que uma pessoa vai ler fica no teto da coluna,
 * cortado na palavra. O trecho vai como está: é ele que o banco confere.
 */
export function resumoParaOBanco(
  s: SaidaDoResumoDaPassagem,
  rotulos: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const caber = (texto: string | null, maximo: number): string | null =>
    texto === null || texto.trim() === '' ? null : (encurtarTexto(maximo)(texto.trim()) as string);
  const dito = <V>(
    d: { valor: V; trecho: string; prova: string } | null,
    maximo: number | null,
  ) => {
    const prova = d === null ? undefined : rotulos.get(d.prova);
    if (d === null || prova === undefined) return null;
    return {
      valor: maximo === null ? d.valor : caber(String(d.valor), maximo),
      trecho: d.trecho,
      prova,
    };
  };
  const objecao = s.objecao === null ? undefined : rotulos.get(s.objecao.prova);
  return {
    procura: {
      negocio: dito(s.procura.negocio, null),
      tipo: dito(s.procura.tipo, 80),
      regiao: dito(s.procura.regiao, 120),
    },
    imoveis: s.imoveis.flatMap((i) => {
      const prova = rotulos.get(i.prova);
      if (prova === undefined) return [];
      const confirmacao = i.confirmacao === null ? undefined : rotulos.get(i.confirmacao.prova);
      return [
        {
          codigo: i.codigo,
          prova,
          confirmacao:
            i.confirmacao === null || confirmacao === undefined
              ? null
              : { prova: confirmacao, trecho: i.confirmacao.trecho },
        },
      ];
    }),
    orcamento: {
      valor: dito(s.orcamento.valor, 100),
      pagamento: dito(s.orcamento.pagamento, null),
    },
    objecao:
      s.objecao === null || objecao === undefined
        ? null
        : {
            tipo: s.objecao.tipo,
            como_disse: caber(s.objecao.comoDisse, 160),
            trecho: s.objecao.trecho,
            prova: objecao,
          },
    temperatura: s.temperatura,
    temperatura_porque: caber(s.temperaturaPorque, 160),
    porque_passou: caber(s.porquePassou, 200),
    proximo_passo: caber(s.proximoPasso, 200),
    dados_insuficientes: s.dadosInsuficientes,
  };
}

async function rpc(
  contexto: ContextoDaIa,
  funcao: string,
  argumentos: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await contexto.cliente.rpc(funcao, argumentos);
  // Erro de RPC é rede ou banco fora do ar: volta para a fila com backoff.
  if (error) throw new ErroDaEsteira(funcao, error.message);
  return data;
}

/** Fica o porquê. Falhar aqui não sobe: o pior caso é a tela dizer "não chegou". */
async function registrarFalha(
  contexto: ContextoDaIa,
  respostaId: string,
  motivo: MotivoSemResumo,
  aiRunId: number | null,
): Promise<ResultadoDoResumo> {
  try {
    await rpc(contexto, 'ia_resumo_da_passagem_falhou', {
      p_resposta_id: respostaId,
      p_motivo: motivo,
      p_ai_run_id: aiRunId,
    });
  } catch (erro) {
    contexto.logger.warn('não deu para registrar que o resumo da passagem não saiu', {
      resposta_id: respostaId,
      motivo,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }
  contexto.logger.warn('o resumo da passagem não saiu', { resposta_id: respostaId, motivo });
  return { feito: false, motivo, ...(aiRunId === null ? {} : { aiRunId }) };
}

/**
 * Para quem descarta o trabalho antes de ele chegar aqui (a pergunta de supressão de
 * `tratarTrabalho`): o resumo daquela passagem não vem, e a tela precisa saber.
 */
export async function registrarFimSemResumo(
  contexto: ContextoDaIa,
  bruto: unknown,
  motivo: MotivoSemResumo,
): Promise<void> {
  const lido = payloadDoResumoDaPassagem.safeParse(bruto);
  if (!lido.success) return;
  await registrarFalha(contexto, lido.data.resposta_id, motivo, null);
}

export async function resumirPassagem(
  contexto: ContextoDaIa,
  bruto: unknown,
): Promise<ResultadoDoResumo> {
  const lido = payloadDoResumoDaPassagem.safeParse(bruto);
  if (!lido.success) {
    const problemas = lido.error.issues
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('; ');
    throw new ErroDeterministico(`payload do resumo da passagem fora do contrato — ${problemas}`);
  }
  const payload = lido.data;
  // O prompt é de imobiliária e as portas só existem no banco da Imova.
  if (contexto.empresa !== 'imova') return { feito: false, motivo: 'so_na_imova' };

  try {
    return await resumir(contexto, payload);
  } catch (erro) {
    // Determinístico: a passagem não ganha resumo nunca, e a tela precisa saber. Rede e
    // 5xx sobem como vieram e voltam com backoff.
    if (erro instanceof ErroDeterministico) {
      await registrarFalha(contexto, payload.resposta_id, 'erro_interno', null);
    }
    throw erro;
  }
}

async function resumir(
  contexto: ContextoDaIa,
  payload: z.infer<typeof payloadDoResumoDaPassagem>,
): Promise<ResultadoDoResumo> {
  const bruta = entradaDoBanco.safeParse(
    await rpc(contexto, 'ia_resumo_da_passagem_entrada', { p_resposta_id: payload.resposta_id }),
  );
  if (!bruta.success) {
    // O banco respondeu fora do combinado: repetir traz a mesma resposta.
    throw new ErroDeterministico(
      `ia_resumo_da_passagem_entrada fora do contrato — ${bruta.error.issues[0]?.message ?? '?'}`,
    );
  }
  const e = bruta.data;
  if (!e.existe) return { feito: false, motivo: 'passagem_nao_existe' };
  if (e.passagem !== true) return { feito: false, motivo: 'nao_e_passagem' };
  // A mesma passagem entregue de novo pela fila (o worker caiu depois de gravar).
  if (e.ja_resumida === true) return { feito: false, motivo: 'ja_resumida' };
  if (!(e.mensagens ?? []).some((m) => m.de === 'cliente')) {
    return registrarFalha(contexto, payload.resposta_id, 'sem_mensagem_do_cliente', null);
  }

  // O lead precisa ser o mesmo em toda chamada desta conversa: sem ficha, a conversa é a âncora.
  const leadId = leadIdCurto(e.organization_id ?? payload.conversation_id);
  const { entrada, rotulos } = montarEntradaDoResumo(e, leadId);
  // O nome e o telefone saem pseudonimizados. Sem ficha, o nome do perfil do WhatsApp é
  // o que existe, e é ele que entra na troca (como na IA que atende).
  const ficha = await buscarContatoDaFicha(
    contexto.cliente,
    e.organization_id ?? null,
    e.contact_id ?? null,
    null,
  );
  const contato = {
    leadId,
    nome: ficha.nome ?? e.nome ?? null,
    empresa: ficha.empresa,
    telefones: ficha.telefones,
    emails: ficha.emails,
    instagram: ficha.instagram,
  };
  const vinculos = {
    organizationId: e.organization_id ?? null,
    contactId: e.contact_id ?? null,
    conversationId: payload.conversation_id,
  };

  // A mesma montagem e a mesma auditoria do `executar`, antes dele. Conversa com dado
  // pessoal que não pode ir ao modelo já fez a IA que atende passar (e abrir a tarefa do
  // bloqueio): o resumo não abre uma segunda, mas deixa a linha `bloqueado` em `ai_runs`,
  // como o `executar` deixa, e diz que não saiu.
  try {
    prepararChamada(resumoDaPassagemV1, entrada, contato);
  } catch (erro) {
    if (erro instanceof PiiNaChamadaError || erro instanceof TipoNaoAuditavelError) {
      const registro = await registrarChamada(contexto.cliente, contexto.logger, {
        proposito: resumoDaPassagemV1.proposito,
        modelo: resumoDaPassagemV1.modelo,
        promptVersion: versaoDoPrompt(resumoDaPassagemV1),
        situacao: 'bloqueado',
        uso: USO_ZERADO,
        latenciaMs: null,
        saida: null,
        erro: erro.message.slice(0, 4000),
        vinculos,
      });
      return registrarFalha(contexto, payload.resposta_id, 'dado_pessoal', registro.id);
    }
    throw new ErroDeterministico(
      `a entrada do resumo da passagem não monta: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
  }

  let executada;
  try {
    executada = await executar(contexto, resumoDaPassagemV1, entrada, contato, vinculos);
  } catch (erro) {
    if (erro instanceof OrcamentoEsgotadoError) {
      return registrarFalha(contexto, payload.resposta_id, 'orcamento', erro.aiRunId);
    }
    if (erro instanceof ChamadaBloqueadaError) {
      return registrarFalha(contexto, payload.resposta_id, 'dado_pessoal', erro.aiRunId);
    }
    // Pediu para sair entre a passagem e o resumo: nada a escrever sobre quem saiu.
    if (erro instanceof AlvoSuprimidoError) {
      return registrarFalha(contexto, payload.resposta_id, 'suprimido', erro.aiRunId);
    }
    if (
      erro instanceof RecusaDoModeloError ||
      erro instanceof RespostaIlegivelError ||
      (erro instanceof ErroDoModelo && !erro.transitorio)
    ) {
      return registrarFalha(
        contexto,
        payload.resposta_id,
        'erro_do_modelo',
        erro instanceof RecusaDoModeloError ? erro.aiRunId : null,
      );
    }
    // Rede, 429 e 5xx: volta para a fila com backoff.
    throw erro;
  }

  const conferido = conferirResumoDaPassagem(
    entrada,
    reidratarResumo(executada.saida, executada.mapa),
  );
  const gravada = (await rpc(contexto, 'ia_resumo_da_passagem_gravar', {
    p_resposta_id: payload.resposta_id,
    p_resumo: resumoParaOBanco(conferido.saida, rotulos),
    p_ai_run_id: executada.aiRunId,
    p_prompt_version: executada.promptVersion,
  })) as { ok?: unknown; motivo?: unknown; task_id?: unknown; descartados?: unknown } | null;
  if (gravada?.ok !== true) {
    // A passagem sumiu entre a leitura e a gravação: a chamada já foi paga, e repetir não
    // traz a passagem de volta.
    throw new ErroDeterministico(
      `o resumo da passagem ${payload.resposta_id} não foi gravado: ${String(gravada?.motivo ?? 'sem resposta')}`,
    );
  }

  const s = conferido.saida;
  const detalhes = {
    temperatura: s.temperatura,
    disse: [
      s.procura.negocio !== null || s.procura.tipo !== null || s.procura.regiao !== null
        ? 'procura'
        : null,
      s.imoveis.length > 0 ? 'imoveis' : null,
      s.orcamento.valor !== null || s.orcamento.pagamento !== null ? 'orcamento' : null,
      s.objecao !== null ? 'objecao' : null,
    ].filter((c): c is string => c !== null),
    dados_insuficientes: s.dadosInsuficientes,
    descartados_no_worker: conferido.descartados.length,
    descartados_no_banco: Array.isArray(gravada.descartados) ? gravada.descartados.length : 0,
    tarefa_avisada: typeof gravada.task_id === 'string',
    simulada: e.simulada === true,
  };
  // Só o que não identifica ninguém: nem nome, nem o texto do resumo.
  contexto.logger.info('a IA resumiu a passagem para o corretor', {
    conversation_id: payload.conversation_id,
    resposta_id: payload.resposta_id,
    mensagens: entrada.mensagens.length,
    ...detalhes,
    custo_usd: executada.custoUsd,
  });
  return { feito: true, aiRunId: executada.aiRunId, custoUsd: executada.custoUsd, detalhes };
}
