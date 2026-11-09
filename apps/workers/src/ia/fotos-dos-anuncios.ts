/**
 * A foto que o cliente manda, reconhecida (só Imova, 09/11/2026).
 *
 * Pedido do usuário, com o print do treino (a IA respondeu a uma foto de anúncio
 * pedindo o código): "Ela deve saber reconhecer todas as fotos e associar a foto ao
 * anúncio que o cliente quer."
 *
 * Roda antes da IA que atende escrever (`atendente.ts`), para as fotos do cliente
 * entre as 40 mensagens que ela lê e que ainda não foram reconhecidas:
 *
 *   1. **A impressão digital, sem modelo.** Cada foto dos anúncios (balde `anuncios`)
 *      e cada foto que o treino ensinou (balde `mensagens`) tem um dHash de 64 bits em
 *      `public.ia_impressoes`. A foto do cliente ganha o dela — a imagem inteira e a
 *      imagem sem a moldura (print de tela) — e, se a mais parecida difere em até
 *      `LIMIAR_DA_IMPRESSAO` bits e o outro anúncio mais parecido está bem mais longe
 *      (`MARGEM_ENTRE_ANUNCIOS`), é a mesma foto: custo zero.
 *   2. **A visão do modelo.** Não bateu: `foto-do-anuncio@v1` recebe a foto do cliente e
 *      um PAINEL por anúncio (até 12 fotos em grade) e diz qual é, com a certeza e uma
 *      frase do que a foto mostra.
 *   3. **O registro.** O que saiu fica em `public.ia_fotos_reconhecidas` (uma vez por
 *      foto), e `textoDaFoto` escreve na conversa que a IA lê, no lugar de "[foto]".
 *
 * ## O que este arquivo NUNCA faz
 *
 * Não envia nada e não toca no caminho do WhatsApp: só LÊ a foto que já chegou e as
 * dos anúncios, e só escreve pelas portas do banco (`ia_impressao_gravar`,
 * `ia_foto_reconhecida_gravar`, `ia_foto_ensinar`). Qualquer falha aqui não derruba a
 * resposta: a IA que atende segue com "[foto]" como antes.
 */
import type sharpPadrao from 'sharp';

import {
  type ContextoDoContato,
  type ImagemParaOModelo,
  type ImovelDaBaseV2,
  fotoDoAnuncioV1,
  semTelefone,
} from '@komune/prompts';

import { ErroDaEsteira } from '../fila/esteira';
import { type ContextoDaIa, OrcamentoEsgotadoError, executar } from './execucao';
import type { VinculosDaChamada } from './registro';

type Sharp = typeof sharpPadrao;

/**
 * Até quantos bits (de 64) a foto do cliente pode diferir da do anúncio e ser a mesma.
 * Medido nas 66 fotos da Imova em 09/11/2026: a mesma foto recomprimida pelo WhatsApp
 * deu 2, com marca d'água 0, como print com moldura 4; e as fotos mais parecidas de
 * anúncios DIFERENTES (dois terrenos em Parnamirim) deram 10. Daí 8.
 */
export const LIMIAR_DA_IMPRESSAO = 8;
/** Até aqui a certeza é alta; entre isto e o limiar, média. */
const LIMIAR_DA_CERTEZA_ALTA = 5;
/**
 * O outro anúncio mais parecido precisa estar pelo menos isto mais longe; senão a
 * impressão não decide sozinha (terrenos vazios se parecem) e quem olha é o modelo.
 */
export const MARGEM_ENTRE_ANUNCIOS = 4;
/** Fotos do cliente lidas por resposta (as mais recentes). */
const FOTOS_POR_VEZ = 3;
/** Fotos num painel: as do anúncio primeiro, depois até 4 ensinadas no treino. */
const FOTOS_POR_PAINEL = 12;
const ENSINADAS_POR_PAINEL = 4;
/** A foto do cliente vai ao modelo com no máximo isto no lado maior (o que a API lê sem reduzir). */
const LADO_DA_FOTO_DO_CLIENTE = 1568;
const BALDE_DOS_ANUNCIOS = 'anuncios';
const BALDE_DE_MIDIAS = 'mensagens';

// ----------------------------------------------------------------------------- sharp

let sharpCarregado: Promise<Sharp | null> | null = null;

/**
 * O sharp é carregado na hora e uma vez só. Sem ele (binário que não veio na imagem),
 * o reconhecimento fica desligado e a IA que atende segue como antes — nunca cai.
 */
export function carregarSharp(): Promise<Sharp | null> {
  sharpCarregado ??= import('sharp')
    .then((modulo) => ((modulo as { default?: Sharp }).default ?? (modulo as unknown as Sharp)))
    .catch(() => null);
  return sharpCarregado;
}

// ----------------------------------------------------------------- a impressão digital

/**
 * dHash de 64 bits: a imagem em tons de cinza, reduzida a 9×8, e cada bit diz se um
 * ponto é mais claro que o vizinho da direita. A mesma foto recomprimida, reduzida ou
 * com marca d'água leve dá quase o mesmo hash; fotos diferentes, hashes distantes.
 */
export async function impressaoDaImagem(sharp: Sharp, bytes: Uint8Array): Promise<string> {
  const { data, info } = await sharp(bytes, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const canais = info.channels;
  const ponto = (x: number, y: number): number => data[(y * 9 + x) * canais] ?? 0;
  let bits = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      bits = (bits << 1n) | (ponto(x, y) > ponto(x + 1, y) ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

/**
 * As impressões da foto do cliente: a imagem inteira e, quando há moldura (print de
 * tela do portal ou do Instagram, com faixas lisas em volta), a imagem sem ela.
 */
export async function impressoesDaFotoDoCliente(sharp: Sharp, bytes: Uint8Array): Promise<string[]> {
  const impressoes = [await impressaoDaImagem(sharp, bytes)];
  try {
    const original = await sharp(bytes, { failOn: 'none' }).metadata();
    const { data: semMoldura, info } = await sharp(bytes, { failOn: 'none' })
      .rotate()
      .trim({ threshold: 30 })
      .toBuffer({ resolveWithObject: true });
    const cortou = info.width !== (original.width ?? 0) || info.height !== (original.height ?? 0);
    if (cortou && info.width >= 64 && info.height >= 64) {
      impressoes.push(await impressaoDaImagem(sharp, new Uint8Array(semMoldura)));
    }
  } catch {
    // Imagem lisa demais para recortar: fica a impressão inteira.
  }
  return [...new Set(impressoes)];
}

/** Quantos bits diferem entre duas impressões (0 = a mesma foto; 64 = o oposto). */
export function distancia(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x > 0n) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export interface Referencia {
  readonly id: string;
  readonly codigo: string;
  readonly origem: 'anuncio' | 'ensinada';
  readonly balde: string;
  readonly caminho: string;
  readonly posicao: number;
  readonly impressao: string | null;
}

/**
 * A referência mais parecida com qualquer uma das impressões da foto do cliente, e a
 * distância da mais parecida de OUTRO anúncio (64 quando não há outro).
 */
export function maisParecida(
  impressoes: readonly string[],
  referencias: readonly Referencia[],
): { readonly referencia: Referencia; readonly distancia: number; readonly outroAnuncio: number } | null {
  const porCodigo = new Map<string, { referencia: Referencia; distancia: number }>();
  for (const referencia of referencias) {
    if (referencia.impressao === null) continue;
    for (const impressao of impressoes) {
      const d = distancia(impressao, referencia.impressao);
      const atual = porCodigo.get(referencia.codigo);
      if (atual === undefined || d < atual.distancia) porCodigo.set(referencia.codigo, { referencia, distancia: d });
    }
  }
  const ordenadas = [...porCodigo.values()].sort((a, b) => a.distancia - b.distancia);
  const [melhor, segunda] = ordenadas;
  if (melhor === undefined) return null;
  return { ...melhor, outroAnuncio: segunda?.distancia ?? 64 };
}

/** A impressão decide sozinha: perto o bastante, e longe o bastante dos outros anúncios. */
export function impressaoDecide(p: { readonly distancia: number; readonly outroAnuncio: number }): boolean {
  return p.distancia <= LIMIAR_DA_IMPRESSAO && p.outroAnuncio - p.distancia >= MARGEM_ENTRE_ANUNCIOS;
}

// ---------------------------------------------------------------------- os painéis

/**
 * Um painel por anúncio: até 12 fotos dele em grade de 4 colunas, 320×240 cada, com
 * uma faixa branca entre elas. Uns 1.200 tokens por painel no modelo.
 */
export async function montarPainel(sharp: Sharp, fotos: readonly Uint8Array[]): Promise<string | null> {
  const largura = 320;
  const altura = 240;
  const folga = 6;
  const colunas = 4;
  const quadros = (
    await Promise.all(
      fotos.map((bytes) =>
        sharp(bytes, { failOn: 'none' })
          .rotate()
          .resize(largura, altura, { fit: 'cover' })
          .jpeg({ quality: 80 })
          .toBuffer()
          .catch(() => null),
      ),
    )
  ).filter((q) => q !== null);
  if (quadros.length === 0) return null;
  const nColunas = Math.min(colunas, quadros.length);
  const nLinhas = Math.ceil(quadros.length / colunas);
  const painel = await sharp({
    create: {
      width: nColunas * largura + (nColunas - 1) * folga,
      height: nLinhas * altura + (nLinhas - 1) * folga,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite(
      quadros.map((input, i) => ({
        input,
        left: (i % colunas) * (largura + folga),
        top: Math.floor(i / colunas) * (altura + folga),
      })),
    )
    .jpeg({ quality: 80 })
    .toBuffer();
  return painel.toString('base64');
}

/** As fotos de um painel: as do anúncio, na ordem dele, e as últimas ensinadas. */
export function fotosDoPainel(referencias: readonly Referencia[]): Referencia[] {
  const doAnuncio = referencias.filter((r) => r.origem === 'anuncio');
  const ensinadas = referencias.filter((r) => r.origem === 'ensinada').slice(-ENSINADAS_POR_PAINEL);
  return [...doAnuncio.slice(0, FOTOS_POR_PAINEL - ensinadas.length), ...ensinadas];
}

/** Os painéis ficam na memória do worker: refazer exige baixar todas as fotos de novo. */
const PAINEIS = new Map<string, { readonly chave: string; readonly base64: string; readonly fotos: number }>();
const PAINEIS_NO_MAXIMO = 200;

// ------------------------------------------------------------------------ o banco

async function rpc<T>(contexto: ContextoDaIa, funcao: string, argumentos: Record<string, unknown>): Promise<T> {
  const { data, error } = await contexto.cliente.rpc(funcao, argumentos);
  if (error) throw new ErroDaEsteira(funcao, error.message);
  return data as T;
}

async function baixar(contexto: ContextoDaIa, balde: string, caminho: string): Promise<Uint8Array | null> {
  try {
    const { data, error } = await contexto.cliente.storage.from(balde).download(caminho);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * As fotos dos anúncios que ainda não têm impressão ganham a sua (no máximo 200 por
 * vez). Foto que não abre fica gravada sem impressão e não é tentada de novo.
 */
export async function garantirImpressoes(contexto: ContextoDaIa, sharp: Sharp): Promise<number> {
  let feitas = 0;
  for (let pagina = 0; pagina < 5; pagina += 1) {
    const pendentes = await rpc<{ foto_id: string; caminho: string }[]>(contexto, 'ia_fotos_sem_impressao', {
      p_limite: 40,
    });
    if (!pendentes || pendentes.length === 0) break;
    for (const foto of pendentes) {
      const bytes = await baixar(contexto, BALDE_DOS_ANUNCIOS, foto.caminho);
      let impressao: string | null = null;
      if (bytes !== null) {
        try {
          impressao = await impressaoDaImagem(sharp, bytes);
        } catch {
          impressao = null;
        }
      }
      await rpc(contexto, 'ia_impressao_gravar', { p_foto_id: foto.foto_id, p_impressao: impressao });
      feitas += 1;
    }
    if (pendentes.length < 40) break;
  }
  return feitas;
}

// --------------------------------------------------------- o texto para a IA que atende

export interface FotoReconhecida {
  readonly message_id: string;
  readonly codigo: string | null;
  readonly metodo: 'impressao' | 'visao' | 'ensinada' | 'nao_reconheceu' | 'indisponivel';
  readonly certeza: 'alta' | 'media' | 'baixa' | null;
  readonly descricao: string | null;
}

/** O rótulo que entra na conversa, no lugar de "[foto]". */
export function textoDaFoto(r: FotoReconhecida): string {
  const oQueMostra = r.descricao ? ` — ${r.descricao}` : '';
  switch (r.metodo) {
    case 'impressao':
    case 'ensinada':
      return `[foto do anúncio ${r.codigo} (reconhecida pela imagem)]`;
    case 'visao':
      if (r.certeza === 'alta') return `[foto do anúncio ${r.codigo} (reconhecida pela imagem)${oQueMostra}]`;
      if (r.certeza === 'media') return `[foto: parece o anúncio ${r.codigo} (certeza média)${oQueMostra}]`;
      return `[foto: talvez o anúncio ${r.codigo} (certeza baixa)${oQueMostra}]`;
    case 'nao_reconheceu':
      return `[foto: não bate com nenhum anúncio${oQueMostra}]`;
    case 'indisponivel':
    default:
      return '[foto: não deu para abrir a imagem]';
  }
}

/** Troca o "[foto]" de cada mensagem reconhecida pelo rótulo; a legenda fica. */
export function aplicarReconhecimentos<M extends { readonly id: string; readonly texto: string | null }>(
  mensagens: readonly M[],
  reconhecidas: ReadonlyMap<string, FotoReconhecida>,
): M[] {
  return mensagens.map((m) => {
    const r = reconhecidas.get(m.id);
    if (r === undefined || m.texto === null || !m.texto.startsWith('[foto]')) return m;
    return { ...m, texto: `${textoDaFoto(r)}${m.texto.slice('[foto]'.length)}` };
  });
}

export async function fotosReconhecidasDaConversa(
  contexto: ContextoDaIa,
  conversationId: string,
): Promise<Map<string, FotoReconhecida>> {
  const linhas = await rpc<FotoReconhecida[]>(contexto, 'ia_fotos_reconhecidas_da_conversa', {
    p_conversation_id: conversationId,
  });
  return new Map((linhas ?? []).map((r) => [r.message_id, r]));
}

// ------------------------------------------------------------------- reconhecer

export interface ResumoDasFotos {
  readonly vistas: number;
  readonly pelaImpressao: number;
  readonly pelaVisao: number;
  readonly naoReconhecidas: number;
  readonly indisponiveis: number;
  readonly custoUsd: number;
}

const NEGOCIO_POR_EXTENSO: Readonly<Record<string, string>> = {
  venda: 'venda',
  aluguel: 'aluguel',
  venda_aluguel: 'venda e aluguel',
};

/** "terreno · venda · Rosa dos Ventos, Parnamirim · Terreno de esquina" */
export function resumoDoImovel(i: ImovelDaBaseV2): string {
  return [
    i.tipo ?? 'imóvel',
    i.negocio ? (NEGOCIO_POR_EXTENSO[i.negocio] ?? i.negocio) : null,
    [i.rua, i.bairro, i.cidade].filter(Boolean).join(', ') || null,
    i.titulo ? semTelefone(i.titulo) : null,
  ]
    .filter((p): p is string => p !== null && p !== '')
    .join(' · ')
    .slice(0, 300);
}

/** A foto do cliente como vai ao modelo: JPEG, no máximo 1.568 px no lado maior. */
async function fotoParaOModelo(sharp: Sharp, bytes: Uint8Array): Promise<string> {
  const jpeg = await sharp(bytes, { failOn: 'none' })
    .rotate()
    .resize(LADO_DA_FOTO_DO_CLIENTE, LADO_DA_FOTO_DO_CLIENTE, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer();
  return jpeg.toString('base64');
}

/** Os painéis dos anúncios que têm foto, na ordem dos códigos (refeitos só quando mudam). */
async function paineis(
  contexto: ContextoDaIa,
  sharp: Sharp,
  referencias: readonly Referencia[],
): Promise<Map<string, { base64: string; fotos: number }>> {
  const porCodigo = new Map<string, Referencia[]>();
  for (const r of referencias) porCodigo.set(r.codigo, [...(porCodigo.get(r.codigo) ?? []), r]);
  const prontos = new Map<string, { base64: string; fotos: number }>();
  for (const [codigo, refs] of [...porCodigo.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))) {
    const escolhidas = fotosDoPainel(refs);
    const chave = escolhidas.map((r) => r.id).join(',');
    const guardado = PAINEIS.get(codigo);
    if (guardado !== undefined && guardado.chave === chave) {
      prontos.set(codigo, { base64: guardado.base64, fotos: guardado.fotos });
      continue;
    }
    const bytes = (await Promise.all(escolhidas.map((r) => baixar(contexto, r.balde, r.caminho)))).filter(
      (b): b is Uint8Array => b !== null,
    );
    const base64 = await montarPainel(sharp, bytes);
    if (base64 === null) continue;
    if (PAINEIS.size >= PAINEIS_NO_MAXIMO) PAINEIS.clear();
    PAINEIS.set(codigo, { chave, base64, fotos: bytes.length });
    prontos.set(codigo, { base64, fotos: bytes.length });
  }
  return prontos;
}

/**
 * Reconhece as fotos do cliente que ainda não foram reconhecidas nesta conversa.
 * Nunca lança: o que der errado fica no log, e a foto é tentada na próxima resposta.
 */
export async function reconhecerFotosDaConversa(
  contexto: ContextoDaIa,
  conversationId: string,
  leadId: string,
  contato: ContextoDoContato,
  vinculos: VinculosDaChamada,
  imoveis: readonly ImovelDaBaseV2[],
): Promise<ResumoDasFotos> {
  const resumo = { vistas: 0, pelaImpressao: 0, pelaVisao: 0, naoReconhecidas: 0, indisponiveis: 0, custoUsd: 0 };
  try {
    const fotos = await rpc<{ message_id: string; media_path: string; legenda: string | null }[]>(
      contexto,
      'ia_fotos_do_cliente',
      { p_conversation_id: conversationId, p_limite: FOTOS_POR_VEZ },
    );
    if (!fotos || fotos.length === 0) return resumo;

    const sharp = await carregarSharp();
    if (sharp === null) {
      contexto.logger.warn('sem o sharp no worker: as fotos do cliente não são reconhecidas', {
        conversation_id: conversationId,
      });
      return resumo;
    }

    await garantirImpressoes(contexto, sharp);
    const referencias = (await rpc<Referencia[]>(contexto, 'ia_fotos_de_referencia', {})) ?? [];
    const balde = contexto.baldeDeMidias ?? BALDE_DE_MIDIAS;
    let orcamentoAcabou = false;

    for (const foto of fotos) {
      resumo.vistas += 1;
      const gravar = (campos: {
        codigo: string | null;
        metodo: FotoReconhecida['metodo'];
        certeza: string | null;
        descricao: string | null;
        distancia?: number | null;
        aiRunId?: number | null;
      }) =>
        rpc(contexto, 'ia_foto_reconhecida_gravar', {
          p_message_id: foto.message_id,
          p_codigo: campos.codigo,
          p_metodo: campos.metodo,
          p_certeza: campos.certeza,
          p_descricao: campos.descricao,
          p_distancia: campos.distancia ?? null,
          p_ai_run_id: campos.aiRunId ?? null,
        });

      const bytes = await baixar(contexto, balde, foto.media_path);
      let impressoes: string[] = [];
      if (bytes !== null) {
        try {
          impressoes = await impressoesDaFotoDoCliente(sharp, bytes);
        } catch {
          impressoes = [];
        }
      }
      if (bytes === null || impressoes.length === 0) {
        await gravar({ codigo: null, metodo: 'indisponivel', certeza: null, descricao: null });
        resumo.indisponiveis += 1;
        continue;
      }

      // 1. A impressão digital.
      const parecida = maisParecida(impressoes, referencias);
      if (parecida !== null && impressaoDecide(parecida)) {
        await gravar({
          codigo: parecida.referencia.codigo,
          metodo: 'impressao',
          certeza: parecida.distancia <= LIMIAR_DA_CERTEZA_ALTA ? 'alta' : 'media',
          descricao: null,
          distancia: parecida.distancia,
        });
        resumo.pelaImpressao += 1;
        continue;
      }

      // 2. A visão do modelo.
      if (orcamentoAcabou || imoveis.length === 0) continue;
      const prontos = await paineis(contexto, sharp, referencias);
      const comPainel = imoveis.filter((i) => prontos.has(i.codigo)).slice(0, fotoDoAnuncioV1.imagens!.maximo - 1);
      const semPainel = imoveis.filter((i) => !prontos.has(i.codigo));
      const anuncios = [...comPainel, ...semPainel].slice(0, 39).map((i) => ({
        codigo: i.codigo,
        resumo: resumoDoImovel(i),
        fotos: prontos.get(i.codigo)?.fotos ?? 0,
      }));
      const imagens: ImagemParaOModelo[] = [
        { mime: 'image/jpeg', base64: await fotoParaOModelo(sharp, bytes), rotulo: 'FOTO DO CLIENTE' },
        ...comPainel.map((i) => ({
          mime: 'image/jpeg',
          base64: prontos.get(i.codigo)!.base64,
          rotulo: `Painel do anúncio ${i.codigo}`,
        })),
      ];
      try {
        const executada = await executar(
          contexto,
          fotoDoAnuncioV1,
          { leadId, legenda: foto.legenda, anuncios },
          contato,
          vinculos,
          { imagens },
        );
        const saida = executada.saida;
        const r = await rpc<{ codigo?: string | null; metodo?: string }>(contexto, 'ia_foto_reconhecida_gravar', {
          p_message_id: foto.message_id,
          p_codigo: saida.codigo,
          p_metodo: 'visao',
          p_certeza: saida.certeza,
          p_descricao: saida.descricao,
          p_distancia: null,
          p_ai_run_id: executada.aiRunId,
        });
        resumo.custoUsd += executada.custoUsd ?? 0;
        if (r?.metodo === 'visao') resumo.pelaVisao += 1;
        else resumo.naoReconhecidas += 1;
      } catch (erro) {
        if (erro instanceof OrcamentoEsgotadoError) {
          orcamentoAcabou = true;
          continue;
        }
        contexto.logger.warn('a foto do cliente não foi reconhecida pelo modelo', {
          conversation_id: conversationId,
          message_id: foto.message_id,
          erro: erro instanceof Error ? erro.message.slice(0, 300) : String(erro),
        });
      }
    }
  } catch (erro) {
    contexto.logger.warn('o reconhecimento das fotos falhou; a IA segue sem ele', {
      conversation_id: conversationId,
      erro: erro instanceof Error ? erro.message.slice(0, 300) : String(erro),
    });
  }
  if (resumo.vistas > 0) {
    contexto.logger.info('fotos do cliente reconhecidas', { conversation_id: conversationId, ...resumo });
  }
  return resumo;
}

/**
 * O treino ensina de qual anúncio é uma foto. A primeira chamada confere e devolve o
 * caminho; a impressão é calculada aqui e gravada na segunda.
 */
export async function ensinarFotos(
  contexto: ContextoDaIa,
  conversationId: string,
  ensinadas: readonly { readonly messageId: string | undefined; readonly codigo: string }[],
): Promise<number> {
  let feitas = 0;
  const sharp = await carregarSharp();
  for (const f of ensinadas) {
    if (f.messageId === undefined) continue;
    try {
      const r = await rpc<{ ok?: boolean; caminho?: string; tem_impressao?: boolean }>(contexto, 'ia_foto_ensinar', {
        p_conversation_id: conversationId,
        p_message_id: f.messageId,
        p_codigo: f.codigo,
        p_impressao: null,
      });
      if (r?.ok !== true) continue;
      feitas += 1;
      if (sharp === null || r.tem_impressao === true || typeof r.caminho !== 'string') continue;
      const bytes = await baixar(contexto, contexto.baldeDeMidias ?? BALDE_DE_MIDIAS, r.caminho);
      if (bytes === null) continue;
      const impressao = await impressaoDaImagem(sharp, bytes);
      await rpc(contexto, 'ia_foto_ensinar', {
        p_conversation_id: conversationId,
        p_message_id: f.messageId,
        p_codigo: f.codigo,
        p_impressao: impressao,
      });
    } catch (erro) {
      contexto.logger.warn('não deu para ensinar a foto', {
        conversation_id: conversationId,
        erro: erro instanceof Error ? erro.message.slice(0, 300) : String(erro),
      });
    }
  }
  return feitas;
}
