/**
 * A IA aprende com as respostas de vocês (Imova, 27/11/2026): depois que um admin responde
 * uma pergunta do aviso de decisão, a IA escreve a nota que guardaria essa resposta no
 * caderno (`nota-da-resposta@v1`) e a deixa SUGERIDA. Ninguém escreve no caderno daqui: quem
 * guarda é a gestão, com um clique no cartão ou na aba Caderno.
 *
 * O caminho: a decisão vira `respondida` (`public.ia_decisao_decidir`), o gatilho
 * `ia_decisoes_sugerir_nota` põe `sugerir_nota` na fila `ai_jobs` (migração 20261127190000),
 * e aqui a IA escreve; a sugestão vai por `public.ia_nota_sugerir`, que confere de novo.
 *
 * Nada aqui pode atrapalhar o cliente: a resposta já saiu. Se o modelo falhar, recusar, o
 * orçamento acabar ou a rede de segurança segurar o texto, simplesmente não há sugestão.
 * Só rede, 429 e 5xx voltam para a fila, porque repetir resolve.
 */
import { z } from 'zod';

import {
  type EntradaDaNotaDaResposta,
  motivoParaNaoSugerirANota,
  notaDaRespostaV1,
} from '@komune/prompts';

import { ErroDaEsteira } from '../fila/esteira';
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

const uuid = z.string().uuid();

/** O que o gatilho `ia_decisoes_sugerir_nota` põe na fila (mais a `chave`, que a esteira usa). */
export const payloadDaNotaDaResposta = z.object({
  purpose: z.literal('sugerir_nota'),
  decisao_id: uuid,
  chave: z.string().min(1).max(200).optional(),
});

const textoOuNulo = z.string().nullable().optional();

/** O que `public.ia_nota_entrada` devolve. */
const entradaDoBanco = z.object({
  existe: z.boolean(),
  tipo: textoOuNulo,
  situacao: textoOuNulo,
  escolha: textoOuNulo,
  conversation_id: uuid.nullable().optional(),
  organization_id: uuid.nullable().optional(),
  contact_id: uuid.nullable().optional(),
  nome: textoOuNulo,
  pergunta: textoOuNulo,
  resposta: textoOuNulo,
  ja_sugerida: z.boolean().optional(),
  tem_ficha: z.boolean().optional(),
  imovel: z
    .object({
      frase: textoOuNulo,
      tipo: textoOuNulo,
      titulo: textoOuNulo,
      area: z.number().nullable().optional(),
      bairro: textoOuNulo,
      cidade: textoOuNulo,
      negocio: textoOuNulo,
    })
    .nullable()
    .optional(),
});

export interface ResultadoDaNotaDaResposta {
  readonly feito: boolean;
  readonly motivo?: string;
  readonly aiRunId?: number;
  readonly custoUsd?: number;
  readonly detalhes?: Record<string, unknown>;
}

const corte = (texto: string | null | undefined, maximo: number): string | null => {
  const limpo = (texto ?? '').replace(/\s+/g, ' ').trim();
  return limpo === '' ? null : limpo.slice(0, maximo);
};

/** Os números de um texto, sem ponto nem vírgula ("3.000 M²" → "3000"). */
const numeros = (texto: string): string[] =>
  (texto.match(/\d[\d.,]*\d|\d/g) ?? []).map((n) => n.replace(/[.,]/g, ''));

/**
 * O nome da ficha nova, só se ele não inventa número nem traz o que o banco recusaria.
 * Sem ele, o banco monta o nome pelo anúncio (`app.ia_nota_titulo_do_anuncio`).
 */
export function tituloSeguro(
  titulo: string | null,
  contexto: readonly (string | null | undefined)[],
): string | null {
  const t = corte(titulo, 120);
  if (t === null || t.length < 3 || /[@:[\]]/.test(t) || /https?:|www\./i.test(t)) return null;
  if (/(?<![A-Za-z0-9])[A-Z]{2}\d{3,4}(?!\d)/.test(t)) return null;
  const conhecidos = new Set(contexto.flatMap((c) => numeros(c ?? '')));
  return numeros(t).every((n) => conhecidos.has(n)) ? t.toUpperCase() : null;
}

async function rpc(
  contexto: ContextoDaIa,
  funcao: string,
  argumentos: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await contexto.cliente.rpc(funcao, argumentos);
  // Erro de RPC é rede ou banco fora do ar: volta para a fila com backoff.
  if (error) throw new ErroDaEsteira(funcao, error.message);
  return (data ?? {}) as Record<string, unknown>;
}

export async function sugerirNota(
  contexto: ContextoDaIa,
  bruto: unknown,
): Promise<ResultadoDaNotaDaResposta> {
  const lido = payloadDaNotaDaResposta.safeParse(bruto);
  if (!lido.success) {
    const problemas = lido.error.issues
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('; ');
    throw new ErroDeterministico(`payload da nota da resposta fora do contrato — ${problemas}`);
  }
  const payload = lido.data;
  if (contexto.empresa !== 'imova') return { feito: false, motivo: 'so_na_imova' };

  const bruta = entradaDoBanco.safeParse(
    await rpc(contexto, 'ia_nota_entrada', { p_decisao_id: payload.decisao_id }),
  );
  if (!bruta.success) {
    throw new ErroDeterministico(
      `ia_nota_entrada fora do contrato — ${bruta.error.issues[0]?.message ?? '?'}`,
    );
  }
  const e = bruta.data;
  if (!e.existe) return { feito: false, motivo: 'decisao_nao_existe' };
  if (e.tipo !== 'pergunta') return { feito: false, motivo: 'nao_e_pergunta' };
  if (e.situacao !== 'respondida') return { feito: false, motivo: 'nao_respondida' };
  // A mesma decisão entregue de novo pela fila.
  if (e.ja_sugerida === true) return { feito: false, motivo: 'ja_sugerida' };
  const pergunta = corte(e.pergunta, 300);
  const resposta = corte(e.resposta, 600);
  if (pergunta === null || resposta === null) return { feito: false, motivo: 'sem_pergunta_ou_resposta' };

  const leadId = leadIdCurto(e.organization_id ?? e.conversation_id ?? payload.decisao_id);
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
    conversationId: e.conversation_id ?? null,
  };
  const i = e.imovel ?? null;
  const area = typeof i?.area === 'number' && i.area >= 0 ? Math.round(i.area) : null;
  const entrada: EntradaDaNotaDaResposta = {
    leadId,
    imovel:
      i === null
        ? null
        : {
            frase: corte(i.frase, 200),
            titulo: corte(i.titulo, 200),
            tipo: corte(i.tipo, 40),
            area,
            bairro: corte(i.bairro, 120),
            cidade: corte(i.cidade, 120),
            negocio: corte(i.negocio, 20),
          },
    temFicha: e.tem_ficha === true,
    pergunta,
    respostaDaImova: resposta,
  };

  let executada;
  try {
    executada = await executar(contexto, notaDaRespostaV1, entrada, contato, vinculos);
  } catch (erro) {
    if (erro instanceof OrcamentoEsgotadoError) return { feito: false, motivo: 'orcamento' };
    if (erro instanceof ChamadaBloqueadaError) {
      return { feito: false, motivo: 'dado_pessoal', aiRunId: erro.aiRunId };
    }
    if (erro instanceof AlvoSuprimidoError) return { feito: false, motivo: 'alvo_suprimido' };
    if (
      erro instanceof RecusaDoModeloError ||
      erro instanceof RespostaIlegivelError ||
      (erro instanceof ErroDoModelo && !erro.transitorio)
    ) {
      return { feito: false, motivo: 'erro_do_modelo' };
    }
    // Rede, 429 e 5xx: volta para a fila com backoff.
    throw erro;
  }

  const comum = { aiRunId: executada.aiRunId, custoUsd: executada.custoUsd };
  const s = executada.saida;
  if (!s.viraNota) {
    contexto.logger.info('a resposta do admin não vira nota', {
      decisao_id: payload.decisao_id,
      porque: s.porque.slice(0, 200),
    });
    return { feito: false, motivo: 'nao_vira_nota', ...comum };
  }

  const contextoDosNumeros = [
    pergunta,
    resposta,
    entrada.imovel?.titulo,
    entrada.imovel?.frase,
    entrada.imovel?.bairro,
    entrada.imovel?.cidade,
    area === null ? null : String(area),
  ];
  const conferir = (texto: string | null): { texto: string | null; motivo: string | null } => {
    const t = corte(texto, 300);
    if (t === null) return { texto: null, motivo: null };
    const motivo = motivoParaNaoSugerirANota(t, contextoDosNumeros);
    return motivo === null ? { texto: t, motivo: null } : { texto: null, motivo };
  };
  const doImovel = entrada.imovel === null ? { texto: null, motivo: null } : conferir(s.textoDoImovel);
  const geral = conferir(s.textoGeral);
  if (doImovel.texto === null && geral.texto === null) {
    const motivo = doImovel.motivo ?? geral.motivo ?? 'sem_texto';
    contexto.logger.warn('a rede segurou a nota sugerida', { decisao_id: payload.decisao_id, motivo });
    return { feito: false, motivo: `rede_segurou:${motivo}`, ...comum };
  }

  const r = await rpc(contexto, 'ia_nota_sugerir', {
    p_decisao_id: payload.decisao_id,
    p_texto_imovel: doImovel.texto,
    p_texto_geral: geral.texto,
    p_escopo: s.alcance,
    p_titulo_da_ficha: entrada.temFicha ? null : tituloSeguro(s.tituloDaFicha, contextoDosNumeros),
    p_ai_run_id: executada.aiRunId,
    p_prompt_version: executada.promptVersion,
  });
  // Só o que não identifica ninguém: nem nome, nem o texto.
  contexto.logger.info('nota sugerida a partir da resposta do admin', {
    decisao_id: payload.decisao_id,
    sugerida: r.ok === true,
    escopo: r.escopo ?? null,
    motivo: r.motivo ?? null,
    segurada_do_imovel: doImovel.motivo,
    segurada_geral: geral.motivo,
    custo_usd: executada.custoUsd,
  });
  return {
    feito: r.ok === true,
    ...(r.ok === true ? {} : { motivo: String(r.motivo ?? 'recusada') }),
    ...comum,
    detalhes: { escopo: r.escopo ?? null },
  };
}
