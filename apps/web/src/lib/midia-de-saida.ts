/**
 * Foto e vídeo que saem pelo WhatsApp do CRM (16/10/2026): as regras que a tela
 * e o servidor precisam dizer do mesmo jeito.
 *
 * O pedido: "implemente a ferramenta pra eu conseguir enviar fotos e vídeos
 * pelo CRM". Os limites são os da Cloud API (R04 §2.1): foto em JPEG ou PNG até
 * 5 MB; vídeo em MP4 ou 3GP até 16 MB, com H.264 e AAC por dentro (o codec quem
 * confere é o worker, com `ffprobe`). A tela converte toda foto para JPEG antes
 * de subir; vídeo não é convertido (decisão de 16/10/2026: a máquina do worker
 * é pequena demais para isso), então o que não for MP4 é recusado aqui, com a
 * frase que diz o que fazer.
 *
 * Sem `'use client'` e sem `server-only`: este arquivo é puro, e os dois lados
 * o importam.
 */

export type TipoDeMidia = 'image' | 'video';

/** O balde privado das mídias: o mesmo do áudio, entrada e saída juntas. */
export const BALDE_DAS_MIDIAS = 'mensagens';

export const TETO_DE_FOTO_BYTES = 5 * 1024 * 1024;
export const TETO_DE_VIDEO_BYTES = 16 * 1024 * 1024;

/** O teto da legenda na Cloud API. */
export const TETO_DA_LEGENDA = 1024;

/** Quantos arquivos de uma escolhida só. Cada um vira uma mensagem. */
export const QUANTOS_DE_UMA_VEZ = 10;

/**
 * O maior lado da foto depois de reduzida. O WhatsApp recomprime tudo acima de
 * ~1600 px; 2048 guarda folga para quem der zoom num cardápio.
 */
export const LADO_MAXIMO_DA_FOTO = 2048;

/** O que pode subir para o balde, já depois da conversão da tela. */
const SOBE: Readonly<Record<string, { tipo: TipoDeMidia; extensao: string }>> = {
  'image/jpeg': { tipo: 'image', extensao: 'jpg' },
  'image/png': { tipo: 'image', extensao: 'png' },
  'video/mp4': { tipo: 'video', extensao: 'mp4' },
  'video/3gpp': { tipo: 'video', extensao: '3gp' },
};

const MIME_DA_EXTENSAO: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
};

export type MotivoDaMidia =
  | 'midia_vazia'
  | 'tipo_nao_aceito'
  | 'foto_grande_demais'
  | 'video_grande_demais'
  | 'video_mov'
  | 'video_de_tipo_recusado'
  | 'foto_ilegivel'
  | 'legenda_longa'
  | 'muitos_de_uma_vez';

/** `video/mp4; codecs=...` → `video/mp4`. */
export function tipoBase(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0]!.trim().toLowerCase();
}

function extensaoDoNome(nome: string): string {
  const ponto = nome.lastIndexOf('.');
  return ponto < 0 ? '' : nome.slice(ponto + 1).toLowerCase();
}

/**
 * O arquivo que a pessoa escolheu, antes de qualquer conversão: é foto, é vídeo
 * que serve, ou é recusa com motivo. O tipo às vezes vem vazio (a foto HEIC do
 * iPhone, no Chrome do computador), e aí quem decide é a extensão.
 */
export function comoMandar(arquivo: {
  type: string;
  name: string;
  size: number;
}): { ok: true; tipo: TipoDeMidia } | { ok: false; motivo: MotivoDaMidia } {
  if (arquivo.size === 0) return { ok: false, motivo: 'midia_vazia' };
  const base = tipoBase(arquivo.type);
  const extensao = extensaoDoNome(arquivo.name);

  // Foto: toda imagem que o navegador souber abrir vira JPEG antes de subir.
  // SVG não é foto — é desenho com código dentro — e não vai.
  const ehSvg = base === 'image/svg+xml' || extensao === 'svg';
  const ehFoto =
    !ehSvg &&
    (base.startsWith('image/') ||
      (base === '' &&
        ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif', 'bmp'].includes(extensao)));
  if (ehFoto) return { ok: true, tipo: 'image' };

  const ehMov = base === 'video/quicktime' || extensao === 'mov';
  if (ehMov) return { ok: false, motivo: 'video_mov' };

  const ehMp4 =
    base === 'video/mp4' ||
    base === 'video/3gpp' ||
    (base === '' && (extensao === 'mp4' || extensao === '3gp'));
  if (ehMp4) {
    return arquivo.size > TETO_DE_VIDEO_BYTES
      ? { ok: false, motivo: 'video_grande_demais' }
      : { ok: true, tipo: 'video' };
  }
  if (base.startsWith('video/')) return { ok: false, motivo: 'video_de_tipo_recusado' };
  return { ok: false, motivo: 'tipo_nao_aceito' };
}

/** O tipo do vídeo como sobe: o do arquivo, ou o da extensão quando veio vazio. */
export function mimeDoVideo(arquivo: { type: string; name: string }): string {
  const base = tipoBase(arquivo.type);
  if (base === 'video/mp4' || base === 'video/3gpp') return base;
  return extensaoDoNome(arquivo.name) === '3gp' ? 'video/3gpp' : 'video/mp4';
}

/** Largura e altura que cabem no lado máximo, sem deformar. */
export function medidasReduzidas(
  largura: number,
  altura: number,
  maximo: number = LADO_MAXIMO_DA_FOTO,
): { largura: number; altura: number } {
  const maior = Math.max(largura, altura);
  if (maior <= maximo) return { largura, altura };
  const fator = maximo / maior;
  return {
    largura: Math.max(1, Math.round(largura * fator)),
    altura: Math.max(1, Math.round(altura * fator)),
  };
}

/**
 * O que o servidor aceita subir (a foto já convertida, o vídeo como veio).
 * O tipo declarado tem de bater com o arquivo: foto que diz ser vídeo não sobe.
 */
export function conferirParaSubir(
  tipo: TipoDeMidia,
  mime: string,
  tamanho: number,
): { ok: true; extensao: string; mime: string } | { ok: false; motivo: MotivoDaMidia } {
  const base = tipoBase(mime);
  const regra = SOBE[base];
  if (!regra || regra.tipo !== tipo) return { ok: false, motivo: 'tipo_nao_aceito' };
  if (!Number.isFinite(tamanho) || tamanho <= 0) return { ok: false, motivo: 'midia_vazia' };
  if (tipo === 'image' && tamanho > TETO_DE_FOTO_BYTES)
    return { ok: false, motivo: 'foto_grande_demais' };
  if (tipo === 'video' && tamanho > TETO_DE_VIDEO_BYTES)
    return { ok: false, motivo: 'video_grande_demais' };
  return { ok: true, extensao: regra.extensao, mime: base };
}

/**
 * Onde o arquivo mora no balde: a pasta da conversa, `saida/`, o instante e um
 * sufixo. Igual ao áudio — dois arquivos do mesmo segundo não se atropelam, e o
 * arquivo de uma conversa nunca cai na pasta de outra.
 */
export function caminhoDaMidia(
  fioId: string,
  extensao: string,
  agora: number = Date.now(),
  sufixo: string = crypto.randomUUID().replace(/-/g, '').slice(0, 8),
): string {
  return `${fioId}/saida/${agora}-${sufixo}.${extensao}`;
}

/**
 * O caminho que a tela devolve é desta conversa e tem a forma que o servidor
 * deu? Sem isto, o caminho viraria a prova — e caminho quem escolhe é quem pede.
 */
export function lerCaminho(
  caminho: string,
  fioId: string,
): { tipo: TipoDeMidia; mime: string } | null {
  const prefixo = `${fioId}/saida/`;
  if (!caminho.startsWith(prefixo)) return null;
  const nome = caminho.slice(prefixo.length);
  const casou = /^\d{10,16}-[0-9a-f]{8}\.(jpg|png|mp4|3gp)$/.exec(nome);
  if (!casou) return null;
  const mime = MIME_DA_EXTENSAO[casou[1]!]!;
  return { tipo: SOBE[mime]!.tipo, mime };
}

/** A frase que a pessoa lê, para cada recusa — a da tela e a do servidor. */
export function fraseDaMidia(motivo: string): string {
  switch (motivo) {
    case 'midia_vazia':
      return 'O arquivo está vazio.';
    case 'tipo_nao_aceito':
      return 'Este tipo de arquivo não vai pelo WhatsApp. Mande foto ou vídeo em MP4.';
    case 'foto_grande_demais':
      return 'A foto passou de 5 MB mesmo depois de reduzida. Tente outra.';
    case 'video_grande_demais':
      return 'O vídeo passou de 16 MB, o teto do WhatsApp. Corte ou comprima e mande de novo.';
    case 'video_mov':
      return 'Vídeo .mov (o do iPhone) não vai pelo WhatsApp. Exporte em MP4 e mande de novo.';
    case 'video_de_tipo_recusado':
      return 'O WhatsApp só aceita vídeo em MP4. Converta e mande de novo.';
    case 'foto_ilegivel':
      return 'O navegador não conseguiu abrir esta foto. Se for HEIC do iPhone, abra no Safari ou mande em JPEG.';
    case 'legenda_longa':
      return `A legenda passou de ${TETO_DA_LEGENDA} caracteres, o teto do WhatsApp.`;
    case 'muitos_de_uma_vez':
      return `São ${QUANTOS_DE_UMA_VEZ} arquivos por vez, no máximo.`;
    case 'arquivo_nao_chegou':
      return 'O arquivo não chegou ao armazenamento. Mande de novo.';
    case 'conversa_invisivel':
      return 'Esta conversa não está mais no seu alcance.';
    case 'mensagem_recusada':
      return 'O banco recusou a mensagem — confira se você ainda atende esta conversa.';
    case 'nao_configurado':
      return 'Falta uma chave no servidor para guardar o arquivo. Avise quem cuida do CRM.';
    case 'balde_recusou':
      return 'O armazenamento não aceitou o arquivo. Avise quem cuida do CRM.';
    case 'sem_sessao':
      return 'Sua sessão expirou. Entre de novo.';
    default:
      return 'Tente de novo em alguns segundos.';
  }
}
