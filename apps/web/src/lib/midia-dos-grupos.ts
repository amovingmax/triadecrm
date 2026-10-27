/**
 * Os arquivos dos grupos de WhatsApp e da foto do perfil da empresa
 * (27/10/2026): as regras que a tela e o servidor precisam dizer do mesmo jeito.
 *
 * Grupo aceita texto e quatro tipos de arquivo — foto, vídeo, áudio e documento
 * (a Meta não leva botão, lista, localização nem contato para grupo). Os tetos
 * são os da Cloud API (R04 §2.1), menos o do documento: a Meta aceita 100 MB,
 * o balde `mensagens` aceita 50 MB, porque o worker-wa segura o arquivo inteiro
 * na memória (migração `20261027110000`, §11).
 *
 * A foto vira JPEG na tela (`prepararFoto`, de Conversas), como no 1:1. A foto
 * DO GRUPO tem regra própria da Meta: JPEG, quadrada, de 192 × 192 para cima e
 * até 5 MB. A tela recorta o meio da imagem e entrega um quadrado de 640.
 *
 * Sem `'use client'` e sem `server-only`: este arquivo é puro, e os dois lados
 * o importam.
 */

export type TipoNoGrupo = 'image' | 'video' | 'audio' | 'document';

/** O balde privado das mídias (o mesmo das conversas 1:1). */
export const BALDE_DOS_GRUPOS = 'mensagens';

const MB = 1024 * 1024;

export const TETO_POR_TIPO: Readonly<Record<TipoNoGrupo, number>> = {
  image: 5 * MB,
  video: 16 * MB,
  audio: 16 * MB,
  document: 50 * MB,
};

/** A foto do grupo e a do perfil: até 5 MB, quadrada, de 192 para cima. */
export const TETO_DA_FOTO_DE_CAPA = 5 * MB;
export const LADO_MINIMO_DA_CAPA = 192;
/** O lado do quadrado que sobe. O WhatsApp mostra a capa em 640 no máximo. */
export const LADO_DA_CAPA = 640;

/** O que sobe para o balde, já depois da conversão da tela. */
const SOBE: Readonly<Record<string, { tipo: TipoNoGrupo; extensao: string }>> = {
  'image/jpeg': { tipo: 'image', extensao: 'jpg' },
  'image/png': { tipo: 'image', extensao: 'png' },
  'video/mp4': { tipo: 'video', extensao: 'mp4' },
  'video/3gpp': { tipo: 'video', extensao: '3gp' },
  'audio/ogg': { tipo: 'audio', extensao: 'ogg' },
  'audio/mpeg': { tipo: 'audio', extensao: 'mp3' },
  'audio/mp4': { tipo: 'audio', extensao: 'm4a' },
  'audio/aac': { tipo: 'audio', extensao: 'aac' },
  'audio/amr': { tipo: 'audio', extensao: 'amr' },
  'application/pdf': { tipo: 'document', extensao: 'pdf' },
  'text/plain': { tipo: 'document', extensao: 'txt' },
  'application/msword': { tipo: 'document', extensao: 'doc' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    tipo: 'document',
    extensao: 'docx',
  },
  'application/vnd.ms-excel': { tipo: 'document', extensao: 'xls' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    tipo: 'document',
    extensao: 'xlsx',
  },
  'application/vnd.ms-powerpoint': { tipo: 'document', extensao: 'ppt' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    tipo: 'document',
    extensao: 'pptx',
  },
};

/** O tipo pela extensão, para o arquivo que chega sem tipo (acontece com .amr, .opus, .docx). */
const MIME_DA_EXTENSAO: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  amr: 'audio/amr',
  pdf: 'application/pdf',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Os apelidos que o navegador às vezes dá ao mesmo tipo. */
const SINONIMOS: Readonly<Record<string, string>> = {
  'audio/mp3': 'audio/mpeg',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/opus': 'audio/ogg',
  'audio/x-aac': 'audio/aac',
  'audio/3gpp': 'audio/amr',
};

export type MotivoDoArquivo =
  | 'arquivo_vazio'
  | 'tipo_nao_aceito'
  | 'grande_demais'
  | 'video_mov'
  | 'video_de_tipo_recusado'
  | 'audio_de_tipo_recusado'
  | 'foto_ilegivel'
  | 'foto_pequena_demais';

/** `audio/ogg; codecs=opus` → `audio/ogg`. */
function base(mime: string | null | undefined): string {
  const limpo = (mime ?? '').split(';')[0]!.trim().toLowerCase();
  return SINONIMOS[limpo] ?? limpo;
}

function extensaoDoNome(nome: string): string {
  const ponto = nome.lastIndexOf('.');
  return ponto < 0 ? '' : nome.slice(ponto + 1).toLowerCase();
}

/**
 * O arquivo que a pessoa escolheu, antes de qualquer conversão: que tipo de
 * mensagem ele vira e com que tipo sobe, ou a recusa com motivo. Foto não tem
 * teto aqui: ela ainda vai ser reduzida e convertida para JPEG.
 */
export function comoMandarNoGrupo(arquivo: {
  type: string;
  name: string;
  size: number;
}): { ok: true; tipo: TipoNoGrupo; mime: string } | { ok: false; motivo: MotivoDoArquivo } {
  if (arquivo.size === 0) return { ok: false, motivo: 'arquivo_vazio' };
  const declarado = base(arquivo.type);
  const extensao = extensaoDoNome(arquivo.name);
  const mime = declarado !== '' ? declarado : (MIME_DA_EXTENSAO[extensao] ?? '');

  // Toda imagem que o navegador souber abrir vira JPEG antes de subir. SVG não
  // é foto: é desenho com código dentro.
  const ehSvg = mime === 'image/svg+xml' || extensao === 'svg';
  const ehFoto =
    !ehSvg &&
    (mime.startsWith('image/') ||
      ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif', 'bmp'].includes(extensao));
  if (ehFoto) return { ok: true, tipo: 'image', mime: 'image/jpeg' };

  if (mime === 'video/quicktime' || extensao === 'mov') return { ok: false, motivo: 'video_mov' };

  const regra = SOBE[mime] ?? SOBE[MIME_DA_EXTENSAO[extensao] ?? ''];
  const mimeFinal = SOBE[mime] ? mime : (MIME_DA_EXTENSAO[extensao] ?? '');
  if (!regra || regra.tipo === 'image') {
    if (mime.startsWith('video/')) return { ok: false, motivo: 'video_de_tipo_recusado' };
    if (mime.startsWith('audio/')) return { ok: false, motivo: 'audio_de_tipo_recusado' };
    return { ok: false, motivo: 'tipo_nao_aceito' };
  }
  if (arquivo.size > TETO_POR_TIPO[regra.tipo]) return { ok: false, motivo: 'grande_demais' };
  return { ok: true, tipo: regra.tipo, mime: mimeFinal };
}

/**
 * O que o servidor aceita subir (a foto já convertida, o resto como veio). O
 * tipo declarado tem de bater com o arquivo: foto que diz ser vídeo não sobe.
 */
export function conferirArquivoDoGrupo(
  tipo: TipoNoGrupo,
  mime: string,
  tamanho: number,
): { ok: true; extensao: string; mime: string } | { ok: false; motivo: MotivoDoArquivo } {
  const limpo = base(mime);
  const regra = SOBE[limpo];
  if (!regra || regra.tipo !== tipo) return { ok: false, motivo: 'tipo_nao_aceito' };
  if (!Number.isFinite(tamanho) || tamanho <= 0) return { ok: false, motivo: 'arquivo_vazio' };
  if (tamanho > TETO_POR_TIPO[tipo]) return { ok: false, motivo: 'grande_demais' };
  return { ok: true, extensao: regra.extensao, mime: limpo };
}

/** A capa (do grupo ou do perfil): JPEG ou PNG, até 5 MB. A tela manda JPEG. */
export function conferirCapa(
  mime: string,
  tamanho: number,
): { ok: true; extensao: 'jpg' | 'png' } | { ok: false; motivo: MotivoDoArquivo } {
  const limpo = base(mime);
  if (limpo !== 'image/jpeg' && limpo !== 'image/png')
    return { ok: false, motivo: 'tipo_nao_aceito' };
  if (!Number.isFinite(tamanho) || tamanho <= 0) return { ok: false, motivo: 'arquivo_vazio' };
  if (tamanho > TETO_DA_FOTO_DE_CAPA) return { ok: false, motivo: 'grande_demais' };
  return { ok: true, extensao: limpo === 'image/png' ? 'png' : 'jpg' };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(texto: unknown): texto is string {
  return typeof texto === 'string' && UUID.test(texto);
}

/**
 * Onde o arquivo de uma mensagem do grupo mora no balde: a pasta do grupo e um
 * nome que ninguém escolhe. O arquivo de um grupo nunca cai na pasta de outro.
 */
export function caminhoNoGrupo(
  grupoId: string,
  extensao: string,
  nome: string = crypto.randomUUID(),
): string {
  return `grupos/${grupoId}/${nome}.${extensao}`;
}

/** A capa do grupo: uma por grupo, e a nova sobrescreve a antiga. */
export function caminhoDaCapaDoGrupo(grupoId: string): string {
  return `grupos/${grupoId}/foto.jpg`;
}

/** A foto do perfil da empresa no WhatsApp. */
export function caminhoDaFotoDoPerfil(
  extensao: 'jpg' | 'png' = 'jpg',
  nome: string = crypto.randomUUID(),
): string {
  return `perfil/${nome}.${extensao}`;
}

/**
 * O quadrado do meio da imagem e o lado com que ele sai: a Meta quer a capa
 * quadrada, e cortar o meio é o que o próprio WhatsApp faz quando a pessoa
 * escolhe uma foto retangular. `null` quando a imagem é pequena demais.
 */
export function recorteQuadrado(
  largura: number,
  altura: number,
  ladoMaximo: number = LADO_DA_CAPA,
): { x: number; y: number; lado: number; saida: number } | null {
  const lado = Math.min(largura, altura);
  if (!Number.isFinite(lado) || lado < LADO_MINIMO_DA_CAPA) return null;
  return {
    x: Math.floor((largura - lado) / 2),
    y: Math.floor((altura - lado) / 2),
    lado,
    saida: Math.min(lado, ladoMaximo),
  };
}

/** A frase que a pessoa lê, para cada recusa: a da tela e a do servidor. */
export function fraseDoArquivo(motivo: string): string {
  switch (motivo) {
    case 'arquivo_vazio':
    case 'midia_vazia':
      return 'O arquivo está vazio.';
    case 'tipo_nao_aceito':
      return 'Este tipo de arquivo não vai pelo WhatsApp. Mande foto, vídeo MP4, áudio ou PDF, Word, Excel, PowerPoint.';
    case 'grande_demais':
      return 'O arquivo passou do teto do WhatsApp: foto 5 MB, vídeo e áudio 16 MB, documento 50 MB.';
    case 'foto_grande_demais':
      return 'A foto passou de 5 MB mesmo depois de reduzida. Tente outra.';
    case 'video_mov':
      return 'Vídeo .mov (o do iPhone) não vai pelo WhatsApp. Exporte em MP4 e mande de novo.';
    case 'video_de_tipo_recusado':
      return 'O WhatsApp só aceita vídeo em MP4.';
    case 'audio_de_tipo_recusado':
      return 'O WhatsApp aceita áudio em MP3, M4A, OGG, AAC ou AMR.';
    case 'foto_ilegivel':
      return 'O navegador não conseguiu abrir esta foto. Se for HEIC do iPhone, mande em JPEG.';
    case 'foto_pequena_demais':
      return `A foto precisa ter pelo menos ${LADO_MINIMO_DA_CAPA} × ${LADO_MINIMO_DA_CAPA} pixels.`;
    case 'grupo_invisivel':
      return 'Este grupo não está mais no seu alcance.';
    case 'grupo_nao_esta_ativo':
      return 'O grupo não está ativo no WhatsApp agora.';
    case 'sem_permissao':
      return 'Seu perfil não pode subir este arquivo.';
    case 'nao_configurado':
      return 'Falta uma chave no servidor para guardar o arquivo. Avise quem cuida do CRM.';
    case 'balde_recusou':
      return 'O armazenamento não aceitou o arquivo. Avise quem cuida do CRM.';
    case 'sem_sessao':
      return 'Sua sessão expirou. Entre de novo.';
    case 'rede':
      return 'A internet caiu no meio do envio. Tente de novo.';
    default:
      return 'Não deu para subir o arquivo. Tente de novo em alguns segundos.';
  }
}
