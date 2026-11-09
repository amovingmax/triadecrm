/**
 * O canal de chegada do lead, lido pela IA (só Imova, 06/11/2026).
 *
 * O banco aplica antes as regras certas — anúncio da Meta gravado na mensagem, links
 * dos portais, frases prontas — e só quando nenhuma regra forte decide é que põe na
 * fila o propósito `identificar_canal` (`app.chegadas_rodar` → `app.ia_enfileirar`).
 * Este arquivo é o meio, e só o meio, como na ficha da conversa:
 *
 *   1. `canal_entrada_da_ia` monta a entrada e diz se é para pular (IA desligada,
 *      chegada fechada, marcada por gente, suprimido, teto de leituras…);
 *   2. as fotos elegíveis — no máximo três, do começo da conversa — são baixadas do
 *      balde `mensagens`, como o áudio em `ouvirOAudio`; foto que não baixa fica de
 *      fora e é contada, nunca derruba o trabalho;
 *   3. `canal-de-chegada@v1` lê o texto pseudonimizado e as fotos (`executar`, com a
 *      porteira das imagens antes do POST);
 *   4. as etiquetas voltam a ser uuid, o que pode ser dado pessoal vira palavra neutra
 *      e `canal_gravar_da_ia` confere cada prova antes de gravar.
 *
 * ## O que este arquivo NUNCA faz
 *
 * Não lê nem escreve `messages` ou `conversations`, não envia nada e não importa nada
 * do WhatsApp (`../whatsapp`): o caminho de envio e de entrada é intocável. O que ele
 * toca é a fila da IA, as duas funções do banco e o balde das mídias, só para ler.
 * `canal-de-chegada.test.ts` confere as duas coisas.
 */
import {
  canalDeChegadaV1,
  conferirImagens,
  type EntradaDoCanal,
  type SaidaDoCanal,
} from '@komune/prompts';

import {
  entradaDoCanal,
  gravarCanal,
  type CanalGravado,
  type EntradaDoCanalDoBanco,
  type MensagemDoCanalNoBanco,
  type ResultadoDoCanalParaOBanco,
} from './banco';
import { RecusaDoModeloError } from './cliente';
import { executar, leadIdCurto, type ContextoDaIa } from './execucao';

export interface PayloadDoCanal {
  readonly chegada_id: string;
  readonly conversation_id: string;
  readonly chave: string;
}

export interface ResultadoDoCanal {
  readonly feito: boolean;
  readonly motivo?: string;
  readonly aiRunId?: number;
  readonly custoUsd?: number;
  readonly detalhes?: Record<string, unknown>;
}

/** O que a API lê em bloco `image`. O resto (HEIC, figurinha animada…) não vai. */
const TIPOS_DE_FOTO = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** O que se grava quando o modelo recusa: não identificado, com o motivo dito. */
const RESULTADO_DA_RECUSA: ResultadoDoCanalParaOBanco = {
  canal: 'nao_identificado',
  subcanal: 'desconhecido',
  confianca: 0,
  evidencias: [],
  foto: null,
  motivo: 'A IA não conseguiu ler o começo desta conversa',
};

// ---------------------------------------------------------------------------
// Datas, no formato que a auditoria de PII aceita
// ---------------------------------------------------------------------------

const FORMATO_DA_DATA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * "06/11/2026 às 14:10", em America/Fortaleza. O "às" é o que impede a auditoria de ler
 * a data e a hora coladas como telefone (onze algarismos seguidos).
 */
export function dataParaOModelo(iso: string | null): string {
  if (iso === null) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  const partes = Object.fromEntries(FORMATO_DA_DATA.formatToParts(data).map((p) => [p.type, p.value]));
  return `${partes.day}/${partes.month}/${partes.year} às ${partes.hour}:${partes.minute}`;
}

// ---------------------------------------------------------------------------
// O que volta do modelo, antes de ir para o banco
// ---------------------------------------------------------------------------

const PALAVRA_NO_LUGAR: Readonly<Record<string, string>> = {
  NOME: '[nome]',
  EMPRESA: '[nome]',
  TELEFONE: '[número]',
  EMAIL: '[e-mail]',
  INSTAGRAM: '[perfil do Instagram]',
  DOCUMENTO: '[documento]',
};

/**
 * Tira do texto o que pode ser dado pessoal, antes de ele ir para `chegadas`.
 *
 * Duas trocas: o marcador da pseudonimização (`[[NOME_1]]`) vira uma palavra neutra
 * ("[nome]") em vez de voltar ao nome de verdade — a chegada guarda descrição curta SEM
 * dado pessoal (desenho §10.3), e quem quiser o texto inteiro abre a mensagem pelo id —;
 * e qualquer sequência de oito ou mais algarismos (com espaço, ponto, hífen ou parêntese
 * no meio) vira "[número]": telefone lido de uma placa ou de um print não chega ao banco.
 */
export function semDadoPessoal(texto: string): string {
  return texto
    .replace(
      /\[\[(NOME|EMPRESA|TELEFONE|EMAIL|INSTAGRAM|DOCUMENTO)_\d{1,2}\]\]/g,
      (_inteiro, tipo: string) => PALAVRA_NO_LUGAR[tipo] ?? '[dado]',
    )
    .replace(/\d(?:[\s().-]*\d){7,}/g, '[número]');
}

/** A saída do modelo no vocabulário do banco, com as etiquetas trocadas pelos uuids. */
export function resultadoParaOBanco(
  saida: SaidaDoCanal,
  porEtiqueta: ReadonlyMap<string, string>,
  mensagemDaFoto: ReadonlyMap<string, string>,
): ResultadoDoCanalParaOBanco {
  // Etiqueta que o modelo inventou (um `m9` numa conversa de quatro mensagens) cai
  // aqui; o que sobrar ainda é conferido pelo banco contra as mensagens da conversa.
  const evidencias = saida.evidencias.flatMap((evidencia) => {
    const messageId = porEtiqueta.get(evidencia.messageId);
    return messageId === undefined
      ? []
      : [{ message_id: messageId, tipo: evidencia.tipo, trecho: semDadoPessoal(evidencia.trecho) }];
  });
  const daFoto = saida.foto === null ? undefined : mensagemDaFoto.get(saida.foto.fotoId);
  const foto =
    saida.foto === null || daFoto === undefined
      ? null
      : {
          message_id: daFoto,
          peca: saida.foto.peca,
          marca: saida.foto.marca,
          descricao: semDadoPessoal(saida.foto.descricao),
          codigo_do_imovel: saida.foto.codigoDoImovel,
        };
  return {
    canal: saida.canal,
    subcanal: saida.subcanal,
    confianca: saida.confianca,
    evidencias,
    foto,
    motivo: semDadoPessoal(saida.motivo),
  };
}

// ---------------------------------------------------------------------------
// As fotos
// ---------------------------------------------------------------------------

interface FotoPronta {
  readonly fotoId: string;
  readonly mensagemId: string;
  readonly mime: string;
  readonly base64: string;
  readonly rotulo: string;
}

/** Baixa UMA foto. Qualquer coisa errada devolve `null`: a foto fica de fora, o trabalho segue. */
async function baixarUmaFoto(
  contexto: ContextoDaIa,
  balde: string,
  mensagem: MensagemDoCanalNoBanco,
  bytesMax: number,
): Promise<{ mime: string; base64: string } | null> {
  const caminho = mensagem.media_path;
  if (caminho === null) return null;
  const pular = (motivo: string): null => {
    contexto.logger.warn('canal de chegada: foto fora da leitura', {
      message_id: mensagem.id,
      motivo,
    });
    return null;
  };
  try {
    const { data, error } = await contexto.cliente.storage.from(balde).download(caminho);
    if (error || !data) return pular(`não baixou: ${error?.message ?? 'sem corpo'}`);
    if (data.size > bytesMax) return pular(`grande demais (${data.size} bytes)`);
    const mime = (mensagem.media_mime ?? data.type ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
    if (!TIPOS_DE_FOTO.has(mime)) return pular(`tipo ${mime || 'desconhecido'}`);
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.length > bytesMax) return pular(`grande demais (${bytes.length} bytes)`);
    return { mime, base64: bytes.toString('base64') };
  } catch (erro) {
    return pular(`erro no download: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
}

/**
 * As fotos que vão ao modelo, já com a etiqueta (`f1`…) e o rótulo final.
 *
 * Passam pela MESMA porteira que `executar` usa (`conferirImagens`) antes de ganhar
 * etiqueta: a mensagem que o modelo lê diz "mandou a foto f1" só para foto que vai
 * mesmo. O que fica de fora — falha no download, tamanho, tipo, excedente — entra em
 * `indisponiveis`, e a linha da mensagem diz "foto que não veio para você".
 */
async function prepararFotos(
  contexto: ContextoDaIa,
  entrada: EntradaDoCanalDoBanco,
  mensagens: readonly MensagemDoCanalNoBanco[],
  etiquetaDe: ReadonlyMap<string, string>,
): Promise<{ fotos: FotoPronta[]; indisponiveis: number }> {
  const elegiveis = mensagens.filter(
    (m) => m.tipo === 'foto' && m.foto_elegivel && m.media_path !== null,
  );
  const teto = Math.min(entrada.fotosMax, canalDeChegadaV1.imagens?.maximo ?? 0);
  const escolhidas = elegiveis.slice(0, teto);
  let indisponiveis = entrada.fotosIndisponiveis + (elegiveis.length - escolhidas.length);
  if (escolhidas.length === 0) return { fotos: [], indisponiveis };

  const balde = contexto.baldeDeMidias ?? contexto.transcritor?.balde;
  if (balde === undefined) {
    contexto.logger.warn('canal de chegada: worker sem balde de mídias, as fotos ficam de fora', {
      fotos: escolhidas.length,
    });
    return { fotos: [], indisponiveis: indisponiveis + escolhidas.length };
  }

  const baixadas: { mensagemId: string; etiqueta: string; mime: string; base64: string }[] = [];
  for (const mensagem of escolhidas) {
    const baixada = await baixarUmaFoto(contexto, balde, mensagem, entrada.fotoBytesMax);
    const etiqueta = etiquetaDe.get(mensagem.id);
    if (baixada === null || etiqueta === undefined) {
      indisponiveis += 1;
      continue;
    }
    baixadas.push({ mensagemId: mensagem.id, etiqueta, ...baixada });
  }

  // O rótulo provisório é a etiqueta da mensagem (única): é por ele que a foto aceita
  // volta a saber de que mensagem veio.
  const conferidas = conferirImagens(
    canalDeChegadaV1,
    baixadas.map((b) => ({ mime: b.mime, base64: b.base64, rotulo: b.etiqueta })),
  );
  indisponiveis += conferidas.descartadas.length;
  const porEtiqueta = new Map(baixadas.map((b) => [b.etiqueta, b.mensagemId]));
  const fotos = conferidas.aceitas.flatMap((aceita, indice) => {
    const mensagemId = porEtiqueta.get(aceita.rotulo);
    if (mensagemId === undefined) return [];
    const fotoId = `f${indice + 1}`;
    return [
      {
        fotoId,
        mensagemId,
        mime: aceita.mime,
        base64: aceita.base64,
        rotulo: `Foto ${fotoId}, enviada na mensagem ${aceita.rotulo}`,
      },
    ];
  });
  return { fotos, indisponiveis };
}

// ---------------------------------------------------------------------------
// A tarefa
// ---------------------------------------------------------------------------

export async function identificarCanal(
  contexto: ContextoDaIa,
  payload: PayloadDoCanal,
): Promise<ResultadoDoCanal> {
  const entrada = await entradaDoCanal(contexto.cliente, payload.chegada_id);
  if (entrada.pular !== null) {
    // Não é erro e não é chamada paga: o banco disse que não há o que ler.
    return { feito: false, motivo: entrada.pular };
  }
  const conversationId = entrada.conversationId ?? payload.conversation_id;
  if (conversationId !== payload.conversation_id) {
    contexto.logger.warn('canal de chegada: a conversa do payload não é a da chegada', {
      chegada_id: payload.chegada_id,
      do_payload: payload.conversation_id,
      do_banco: conversationId,
    });
  }

  const mensagens = entrada.mensagens.slice(0, 20);
  if (mensagens.length === 0) return { feito: false, motivo: 'sem_mensagem' };

  // etiqueta ↔ uuid. O modelo vê `m1`, `m2`…: uuid custa token, e etiqueta que ele não
  // conhece ele não consegue inventar.
  const porEtiqueta = new Map<string, string>();
  const etiquetaDe = new Map<string, string>();
  mensagens.forEach((m, indice) => {
    porEtiqueta.set(`m${indice + 1}`, m.id);
    etiquetaDe.set(m.id, `m${indice + 1}`);
  });

  const { fotos, indisponiveis } = await prepararFotos(contexto, entrada, mensagens, etiquetaDe);
  const fotoDaMensagem = new Map(fotos.map((f) => [f.mensagemId, f.fotoId]));
  const mensagemDaFoto = new Map(fotos.map((f) => [f.fotoId, f.mensagemId]));

  const entradaDoPrompt: EntradaDoCanal = {
    leadId: leadIdCurto(entrada.organizationId ?? conversationId),
    agora: dataParaOModelo(entrada.agora),
    inicio: dataParaOModelo(entrada.inicioEm),
    mensagens: mensagens.map((m) => ({
      messageId: etiquetaDe.get(m.id) ?? 'm0',
      de: m.de,
      quando: m.quando,
      tipo: m.tipo,
      texto: m.texto === null ? null : m.texto.slice(0, 500),
      fotoId: fotoDaMensagem.get(m.id) ?? null,
    })),
    fotosIndisponiveis: Math.min(indisponiveis, 20),
  };
  const lidaAte = entrada.lidaAte ?? mensagens[mensagens.length - 1]?.created_at ?? null;
  const vinculos = {
    organizationId: entrada.organizationId,
    contactId: entrada.contactId,
    conversationId,
  };

  let executada;
  try {
    executada = await executar(
      contexto,
      canalDeChegadaV1,
      entradaDoPrompt,
      // O nome do perfil do WhatsApp é o que a pessoa costuma escrever: sai trocado
      // por [[NOME_1]] na ida. O telefone dela, quando o banco o manda, sai pela
      // passada do telefone conhecido; o desconhecido é pego pelas passadas genéricas e,
      // se sobrar, pela auditoria — e aí a chamada não sai.
      {
        leadId: entradaDoPrompt.leadId,
        nome: entrada.peerNome,
        telefones: entrada.peerTelefone === null ? [] : [entrada.peerTelefone],
      },
      vinculos,
      { imagens: fotos.map((f) => ({ mime: f.mime, base64: f.base64, rotulo: f.rotulo })) },
    );
  } catch (erro) {
    if (!(erro instanceof RecusaDoModeloError)) throw erro;
    // A recusa é determinística (repetir paga a mesma recusa) e não deixa a chegada
    // em aberto: grava Não identificado, com o motivo dito, e conclui.
    const gravado = await gravarCanal(
      contexto.cliente,
      entrada.chegadaId,
      RESULTADO_DA_RECUSA,
      lidaAte,
      erro.aiRunId,
    );
    contexto.logger.warn('canal de chegada: o modelo recusou, gravado como não identificado', {
      chegada_id: entrada.chegadaId,
      ai_run_id: erro.aiRunId,
      categoria: erro.categoria,
      gravado: gravado.gravado,
    });
    return {
      feito: true,
      motivo: 'recusa_do_modelo',
      ...(erro.aiRunId === null ? {} : { aiRunId: erro.aiRunId }),
      detalhes: detalhesDaGravacao(gravado, RESULTADO_DA_RECUSA, fotos.length, indisponiveis),
    };
  }

  const resultado = resultadoParaOBanco(executada.saida, porEtiqueta, mensagemDaFoto);
  const gravado = await gravarCanal(
    contexto.cliente,
    entrada.chegadaId,
    resultado,
    lidaAte,
    executada.aiRunId,
  );

  contexto.logger.info('canal de chegada lido pela IA', {
    chegada_id: entrada.chegadaId,
    conversation_id: conversationId,
    canal: resultado.canal,
    subcanal: resultado.subcanal,
    confianca: resultado.confianca,
    fotos: fotos.length,
    fotos_indisponiveis: indisponiveis,
    evidencias_descartadas: executada.saida.evidencias.length - resultado.evidencias.length,
    gravado: gravado.gravado,
    motivo_do_banco: gravado.motivo,
  });

  return {
    feito: true,
    aiRunId: executada.aiRunId,
    custoUsd: executada.custoUsd,
    detalhes: detalhesDaGravacao(gravado, resultado, fotos.length, indisponiveis),
  };
}

function detalhesDaGravacao(
  gravado: CanalGravado,
  resultado: ResultadoDoCanalParaOBanco,
  fotos: number,
  indisponiveis: number,
): Record<string, unknown> {
  return {
    canal: resultado.canal,
    subcanal: resultado.subcanal,
    confianca: resultado.confianca,
    gravado: gravado.gravado,
    canal_que_vale: gravado.canal,
    motivo_do_banco: gravado.motivo,
    fotos,
    fotos_indisponiveis: indisponiveis,
  };
}
