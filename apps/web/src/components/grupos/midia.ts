/**
 * O arquivo de um grupo, do clique ao balde (27/10/2026), e a capa quadrada que
 * a Meta pede para o grupo e para o perfil da empresa.
 *
 *   1. A FOTO VIRA JPEG na tela, pela mesma função das conversas 1:1
 *      (`prepararFoto`): o formato que a Meta aceita, o tamanho que cabe nos
 *      5 MB e o arquivo sem os metadados da câmera.
 *   2. O ARQUIVO SOBE DIRETO PARA O BALDE, com a autorização de uso único de
 *      `/api/grupos/midia` (a Vercel não deixa passar arquivo acima de 4,5 MB).
 *   3. Quem chama grava a mensagem (`grupo_enviar`) ou a capa (`grupo_atualizar`)
 *      com o caminho que voltou.
 */
import { createClient } from '@/lib/supabase/client';
import {
  BALDE_DOS_GRUPOS,
  comoMandarNoGrupo,
  recorteQuadrado,
  TETO_DA_FOTO_DE_CAPA,
  type TipoNoGrupo,
} from '@/lib/midia-dos-grupos';
import { prepararFoto } from '@/components/conversas/enviar-midia-dados';

export class ErroDoArquivo extends Error {
  constructor(readonly motivo: string) {
    super(motivo);
    this.name = 'ErroDoArquivo';
  }
}

/** O arquivo pronto para subir: o tipo da mensagem, o corpo, o tipo do arquivo e o nome. */
export type ArquivoPronto = { tipo: TipoNoGrupo; corpo: Blob; mime: string; nome: string };

/** Classifica e prepara o que a pessoa escolheu. Lança `ErroDoArquivo` com o motivo. */
export async function prepararArquivo(arquivo: File): Promise<ArquivoPronto> {
  const como = comoMandarNoGrupo(arquivo);
  if (!como.ok) throw new ErroDoArquivo(como.motivo);
  if (como.tipo === 'image') {
    try {
      const foto = await prepararFoto(arquivo);
      return { tipo: 'image', corpo: foto.arquivo, mime: foto.mime, nome: arquivo.name };
    } catch (e) {
      throw new ErroDoArquivo(
        e instanceof Error && 'motivo' in e ? String(e.motivo) : 'foto_ilegivel',
      );
    }
  }
  return { tipo: como.tipo, corpo: arquivo, mime: como.mime, nome: arquivo.name };
}

async function autorizar(url: string, corpo: unknown): Promise<{ caminho: string; token: string }> {
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch {
    throw new ErroDoArquivo('rede');
  }
  const dados = (await resposta.json().catch(() => ({}))) as {
    ok?: boolean;
    motivo?: string;
    detalhe?: string;
    caminho?: string;
    token?: string;
  };
  if (!resposta.ok || !dados.ok || !dados.caminho || !dados.token) {
    if (dados.detalhe) console.error('arquivo recusado:', dados.motivo, dados.detalhe);
    throw new ErroDoArquivo(dados.motivo ?? 'falhou');
  }
  return { caminho: dados.caminho, token: dados.token };
}

async function subir(
  autorizacao: { caminho: string; token: string },
  corpo: Blob,
  mime: string,
  sobrescrever = false,
) {
  // REEMBALADO COM O TIPO: para Blob e File a biblioteca do Supabase ignora o
  // `contentType` e usa o tipo do próprio arquivo, que às vezes vem vazio (o
  // .amr, o .docx de alguns sistemas) e o balde recusa (ver `enviar-midia-dados.ts`).
  const embalado = new Blob([corpo], { type: mime });
  const { error } = await createClient()
    .storage.from(BALDE_DOS_GRUPOS)
    .uploadToSignedUrl(autorizacao.caminho, autorizacao.token, embalado, {
      contentType: mime,
      // A capa do grupo sobrescreve a anterior (a autorização já diz isso; o
      // cabeçalho repete, para não depender de qual dos dois o balde lê).
      upsert: sobrescrever,
    });
  if (error) {
    console.error('arquivo: o balde recusou o upload', error.message);
    throw new ErroDoArquivo('balde_recusou');
  }
}

/** Sobe o arquivo de uma mensagem e devolve o caminho no balde. */
export async function subirArquivoDoGrupo(grupoId: string, pronto: ArquivoPronto): Promise<string> {
  const autorizacao = await autorizar('/api/grupos/midia', {
    grupo_id: grupoId,
    finalidade: 'mensagem',
    tipo: pronto.tipo,
    mime: pronto.mime,
    tamanho: pronto.corpo.size,
  });
  await subir(autorizacao, pronto.corpo, pronto.mime);
  return autorizacao.caminho;
}

/**
 * A capa quadrada: o meio da foto, em JPEG, com 640 de lado (ou menos, se a foto
 * for menor), fundo branco por baixo do PNG transparente. Recusa abaixo de 192.
 */
export async function capaQuadrada(arquivo: File): Promise<Blob> {
  let imagem: ImageBitmap;
  try {
    imagem = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    throw new ErroDoArquivo('foto_ilegivel');
  }
  try {
    const corte = recorteQuadrado(imagem.width, imagem.height);
    if (!corte) throw new ErroDoArquivo('foto_pequena_demais');
    const canvas = document.createElement('canvas');
    canvas.width = corte.saida;
    canvas.height = corte.saida;
    const pincel = canvas.getContext('2d');
    if (!pincel) throw new ErroDoArquivo('foto_ilegivel');
    pincel.fillStyle = '#ffffff';
    pincel.fillRect(0, 0, corte.saida, corte.saida);
    pincel.drawImage(
      imagem,
      corte.x,
      corte.y,
      corte.lado,
      corte.lado,
      0,
      0,
      corte.saida,
      corte.saida,
    );
    for (const qualidade of [0.9, 0.8, 0.65]) {
      const jpeg = await new Promise<Blob | null>((resolva) =>
        canvas.toBlob(resolva, 'image/jpeg', qualidade),
      );
      if (jpeg && jpeg.size <= TETO_DA_FOTO_DE_CAPA) return jpeg;
    }
    throw new ErroDoArquivo('foto_grande_demais');
  } finally {
    imagem.close();
  }
}

/** Sobe a capa do grupo (`grupos/<id>/foto.jpg`) e devolve o caminho. */
export async function subirCapaDoGrupo(grupoId: string, arquivo: File): Promise<string> {
  const capa = await capaQuadrada(arquivo);
  const autorizacao = await autorizar('/api/grupos/midia', {
    grupo_id: grupoId,
    finalidade: 'capa',
    mime: 'image/jpeg',
    tamanho: capa.size,
  });
  await subir(autorizacao, capa, 'image/jpeg', true);
  return autorizacao.caminho;
}

/** Sobe a foto do perfil da empresa (`perfil/<uuid>.jpg`, só admin) e devolve o caminho. */
export async function subirFotoDoPerfil(arquivo: File): Promise<string> {
  const capa = await capaQuadrada(arquivo);
  const autorizacao = await autorizar('/api/whatsapp/perfil-foto', {
    mime: 'image/jpeg',
    tamanho: capa.size,
  });
  await subir(autorizacao, capa, 'image/jpeg');
  return autorizacao.caminho;
}
