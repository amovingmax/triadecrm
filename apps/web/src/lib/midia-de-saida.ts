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

/**
 * O que sobe pelo mesmo caminho desde 27/10/2026: a foto e o vídeo, o
 * DOCUMENTO e a FIGURINHA. A figurinha é uma `image` no banco, com
 * `tipo_na_meta = 'sticker'`; aqui ela tem nome próprio porque a regra dela é
 * outra (webp, 500 KB, sem legenda).
 */
export type TipoDeEnvio = TipoDeMidia | 'document' | 'sticker';

/** O balde privado das mídias: o mesmo do áudio, entrada e saída juntas. */
export const BALDE_DAS_MIDIAS = 'mensagens';

export const TETO_DE_FOTO_BYTES = 5 * 1024 * 1024;
export const TETO_DE_VIDEO_BYTES = 16 * 1024 * 1024;

/**
 * O documento até 20 MB: a Meta aceita 100, mas o worker-wa segura o arquivo
 * inteiro na memória dele (512 MB) e o balde vai a 50.
 */
export const TETO_DE_DOCUMENTO_BYTES = 20 * 1024 * 1024;

/** A figurinha: webp até 500 KB (a animada; a parada é bem menor). */
export const TETO_DE_FIGURINHA_BYTES = 500 * 1024;

/** O teto do nome do documento no banco (`messages_media_nome_check`). */
export const TETO_DO_NOME_DO_DOCUMENTO = 240;

/** O teto da legenda na Cloud API. */
export const TETO_DA_LEGENDA = 1024;

/** Quantos arquivos de uma escolhida só. Cada um vira uma mensagem. */
export const QUANTOS_DE_UMA_VEZ = 10;

/**
 * O maior lado da foto depois de reduzida. O WhatsApp recomprime tudo acima de
 * ~1600 px; 2048 guarda folga para quem der zoom num cardápio.
 */
export const LADO_MAXIMO_DA_FOTO = 2048;

/**
 * Os documentos que vão: os que a Meta aceita e o balde guarda (migração
 * `20261027110000`, §11). Pela extensão, porque o tipo do arquivo vem vazio ou
 * errado com frequência (o .docx do Windows chega como `application/zip`).
 */
const DOCUMENTOS: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  zip: 'application/zip',
};

/** O `accept` do seletor de documentos. */
export const ACEITA_DOCUMENTOS = Object.keys(DOCUMENTOS)
  .map((e) => `.${e}`)
  .join(',');

/** O que pode subir para o balde, já depois da conversão da tela. */
const SOBE: Readonly<Record<string, { tipo: TipoDeEnvio; extensao: string }>> = {
  'image/jpeg': { tipo: 'image', extensao: 'jpg' },
  'image/png': { tipo: 'image', extensao: 'png' },
  'video/mp4': { tipo: 'video', extensao: 'mp4' },
  'video/3gpp': { tipo: 'video', extensao: '3gp' },
  'image/webp': { tipo: 'sticker', extensao: 'webp' },
  ...Object.fromEntries(
    Object.entries(DOCUMENTOS).map(([extensao, mime]) => [mime, { tipo: 'document', extensao }]),
  ),
};

const MIME_DA_EXTENSAO: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  webp: 'image/webp',
  ...DOCUMENTOS,
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
  | 'muitos_de_uma_vez'
  | 'documento_grande_demais'
  | 'documento_de_tipo_recusado'
  | 'figurinha_nao_e_webp'
  | 'figurinha_grande_demais';

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

/**
 * O documento que a pessoa escolheu: vai, com o tipo da EXTENSÃO, ou é recusa.
 * O tipo é o da extensão de propósito: é o que o balde e a Meta conferem, e o
 * navegador às vezes chama de `application/zip` o que é .docx.
 */
export function comoMandarDocumento(arquivo: {
  name: string;
  size: number;
}): { ok: true; mime: string } | { ok: false; motivo: MotivoDaMidia } {
  if (arquivo.size === 0) return { ok: false, motivo: 'midia_vazia' };
  const mime = DOCUMENTOS[extensaoDoNome(arquivo.name)];
  if (!mime) return { ok: false, motivo: 'documento_de_tipo_recusado' };
  if (arquivo.size > TETO_DE_DOCUMENTO_BYTES)
    return { ok: false, motivo: 'documento_grande_demais' };
  return { ok: true, mime };
}

/** A figurinha que a pessoa escolheu: webp até 500 KB, ou recusa. */
export function comoMandarFigurinha(arquivo: {
  type: string;
  name: string;
  size: number;
}): { ok: true } | { ok: false; motivo: MotivoDaMidia } {
  if (arquivo.size === 0) return { ok: false, motivo: 'midia_vazia' };
  const webp = tipoBase(arquivo.type) === 'image/webp' || extensaoDoNome(arquivo.name) === 'webp';
  if (!webp) return { ok: false, motivo: 'figurinha_nao_e_webp' };
  if (arquivo.size > TETO_DE_FIGURINHA_BYTES)
    return { ok: false, motivo: 'figurinha_grande_demais' };
  return { ok: true };
}

/**
 * O nome do documento como o contato vai ver: sem pasta, sem caractere de
 * controle, e dentro do teto do banco (a extensão fica, o miolo encolhe).
 */
export function nomeDoDocumento(nome: string): string {
  const base = nome.split(/[\\/]/).pop() ?? '';
  // O caractere de controle sai: no nome do arquivo ele só atrapalha.
  const limpo = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (limpo === '') return 'documento';
  if (limpo.length <= TETO_DO_NOME_DO_DOCUMENTO) return limpo;
  const ponto = limpo.lastIndexOf('.');
  const extensao = ponto > 0 && limpo.length - ponto <= 6 ? limpo.slice(ponto) : '';
  return `${limpo.slice(0, TETO_DO_NOME_DO_DOCUMENTO - extensao.length - 1)}…${extensao}`;
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
  tipo: TipoDeEnvio,
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
  if (tipo === 'document' && tamanho > TETO_DE_DOCUMENTO_BYTES)
    return { ok: false, motivo: 'documento_grande_demais' };
  if (tipo === 'sticker' && tamanho > TETO_DE_FIGURINHA_BYTES)
    return { ok: false, motivo: 'figurinha_grande_demais' };
  return { ok: true, extensao: regra.extensao, mime: base };
}

/** O tipo que o pedido diz, se for um dos que sobem por aqui. */
export function lerTipoDeEnvio(valor: unknown): TipoDeEnvio | null {
  return valor === 'image' || valor === 'video' || valor === 'document' || valor === 'sticker'
    ? valor
    : null;
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
): { tipo: TipoDeEnvio; mime: string } | null {
  const prefixo = `${fioId}/saida/`;
  if (!caminho.startsWith(prefixo)) return null;
  const nome = caminho.slice(prefixo.length);
  const casou =
    /^\d{10,16}-[0-9a-f]{8}\.(jpg|png|mp4|3gp|webp|pdf|docx?|xlsx?|pptx?|txt|csv|odt|ods|zip)$/.exec(
      nome,
    );
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
    case 'documento_grande_demais':
      return 'O documento passou de 20 MB. Comprima ou mande um link.';
    case 'documento_de_tipo_recusado':
      return 'Este tipo de arquivo não vai. Mande PDF, Word, Excel, PowerPoint, texto, CSV ou ZIP.';
    case 'figurinha_nao_e_webp':
      return 'Figurinha é imagem .webp. Para mandar outra imagem, use Foto.';
    case 'figurinha_grande_demais':
      return 'A figurinha passou de 500 KB, o teto do WhatsApp.';
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
