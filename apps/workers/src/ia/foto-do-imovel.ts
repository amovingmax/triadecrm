/**
 * A foto do imóvel que a IA manda para o cliente confirmar (só Imova, 24/11/2026).
 *
 * Pedido do usuário: "na primeira mensagem enviar uma mensagem mais humanizada e logo na
 * mensagem seguinte enviar uma imagem do terreno que a IA captou pelas informações, e
 * perguntar ao cliente se é esse terreno/imóvel que ele estava se referindo."
 *
 * A `atendente-imova@v8` devolve `fotoParaConfirmar` ({ imovelCodigo, legenda }). Antes
 * de o texto sair, `prepararFotoDoImovel` acha a foto de capa do anúncio
 * (`ia_atendente_capa_do_imovel`) e a copia do balde `anuncios` para o balde
 * `mensagens`, sob `ia/<conversa>/`, que é de onde o worker-wa manda mídia. Depois que o
 * texto sai, o atendente chama `ia_atendente_mostrar_foto` com o caminho da cópia.
 *
 * Quando não dá para mandar a foto (código desconhecido, anúncio sem foto, a mesma foto
 * já mandada nesta conversa, o Storage falhou), a legenda vai junto do texto, na mesma
 * mensagem: o cliente sempre recebe a pergunta.
 *
 * ## O que este arquivo NUNCA faz
 *
 * Não põe nada na fila do WhatsApp: só copia o arquivo. Quem decide se a foto sai é o
 * banco, pela porta da foto.
 */
import { randomUUID } from 'node:crypto';

import { LEGENDA_PADRAO_DA_FOTO, TETO_DA_LEGENDA } from '@komune/prompts';

import type { ContextoDaIa } from './execucao';

const BALDE_DOS_ANUNCIOS = 'anuncios';
const BALDE_DE_MIDIAS = 'mensagens';

/** O que o modelo pediu. */
export interface PedidoDeFoto {
  readonly imovelCodigo: string;
  readonly legenda: string;
}

/** A foto pronta para sair, ou o motivo de ela não sair (e a legenda vai no texto). */
export type FotoPreparada =
  | {
      readonly pronta: true;
      readonly codigo: string;
      readonly legenda: string;
      readonly caminho: string;
    }
  | {
      readonly pronta: false;
      readonly codigo: string;
      readonly legenda: string;
      readonly motivo: string;
    };

/** Uma mensagem da conversa como o banco a devolve (só o que importa aqui). */
interface MensagemLida {
  readonly de: string;
  readonly texto: string | null;
}

/** A legenda limpa: sem espaço sobrando, no teto, e a padrão quando vem vazia. */
export function legendaDaFoto(legenda: string): string {
  const limpa = legenda.replace(/\s+/g, ' ').trim();
  if (limpa === '') return LEGENDA_PADRAO_DA_FOTO;
  return limpa.length > TETO_DA_LEGENDA
    ? `${limpa.slice(0, TETO_DA_LEGENDA - 1).trimEnd()}…`
    : limpa;
}

/** O texto com a pergunta junto, quando a foto não sai. */
export function textoComALegenda(texto: string, legenda: string): string {
  const t = texto.trim();
  if (t === '') return legenda;
  if (t.endsWith(legenda)) return t;
  return /[.!?…:]$/.test(t) ? `${t} ${legenda}` : `${t}. ${legenda}`;
}

/** A IA já mandou a foto deste anúncio nesta conversa? (o banco a escreve assim.) */
export function fotoJaMandada(mensagens: readonly MensagemLida[], codigo: string): boolean {
  const alvo = `[foto do anúncio ${codigo.trim()} `.toUpperCase();
  return mensagens.some((m) => m.de === 'ia' && (m.texto ?? '').toUpperCase().startsWith(alvo));
}

const capaDoBanco = (valor: unknown): { codigo: string; caminho: string } | null => {
  if (valor === null || typeof valor !== 'object') return null;
  const { codigo, caminho } = valor as Record<string, unknown>;
  return typeof codigo === 'string' && typeof caminho === 'string' && caminho !== ''
    ? { codigo, caminho }
    : null;
};

/**
 * Acha a capa e copia para o balde das mensagens. Nunca lança: qualquer falha vira
 * `pronta: false` com o motivo, e a resposta segue com a legenda no texto.
 */
export async function prepararFotoDoImovel(
  contexto: ContextoDaIa,
  conversationId: string,
  pedido: PedidoDeFoto,
  mensagens: readonly MensagemLida[],
): Promise<FotoPreparada> {
  const legenda = legendaDaFoto(pedido.legenda);
  const codigo = pedido.imovelCodigo.trim();
  const semFoto = (motivo: string): FotoPreparada => ({ pronta: false, codigo, legenda, motivo });
  if (codigo === '') return semFoto('sem_codigo');
  if (fotoJaMandada(mensagens, codigo)) return semFoto('foto_ja_mandada');

  try {
    const { data, error } = await contexto.cliente.rpc('ia_atendente_capa_do_imovel', {
      p_codigo: codigo,
    });
    if (error) return semFoto(`capa: ${error.message}`);
    const capa = capaDoBanco(data);
    if (capa === null) return semFoto('imovel_sem_foto_ou_desconhecido');
    if (fotoJaMandada(mensagens, capa.codigo)) return semFoto('foto_ja_mandada');

    const baixada = await contexto.cliente.storage.from(BALDE_DOS_ANUNCIOS).download(capa.caminho);
    if (baixada.error || !baixada.data)
      return semFoto(`download: ${baixada.error?.message ?? 'vazio'}`);

    const caminho = `ia/${conversationId}/${randomUUID()}.jpg`;
    const subida = await contexto.cliente.storage
      .from(BALDE_DE_MIDIAS)
      .upload(caminho, baixada.data, { contentType: 'image/jpeg', upsert: false });
    if (subida.error) return semFoto(`upload: ${subida.error.message}`);
    return { pronta: true, codigo: capa.codigo, legenda, caminho };
  } catch (erro) {
    return semFoto(erro instanceof Error ? erro.message : String(erro));
  }
}
