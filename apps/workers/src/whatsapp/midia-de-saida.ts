/**
 * A foto e o vídeo escolhidos na tela, a caminho da Meta (16/10/2026).
 *
 * O pedido: "implemente a ferramenta pra eu conseguir enviar fotos e vídeos
 * pelo CRM". O caminho é o mesmo do áudio gravado (`audio-de-saida.ts`): o
 * arquivo mora no balde privado `mensagens`, e só no instante da entrega vira
 * um `media id` da Meta.
 *
 * ===========================================================================
 * O QUE A META ACEITA (R04 §2.1)
 * ===========================================================================
 * - **Foto:** `image/jpeg` ou `image/png`, até 5 MB. Nada de webp (só como
 *   figurinha), nada de HEIC. A tela já converte toda foto para JPEG antes de
 *   subir; a conferência daqui é a segunda fechadura, não a primeira.
 * - **Vídeo:** `video/mp4` ou `video/3gpp`, até 16 MB, com vídeo em **H.264** e
 *   áudio em **AAC**. O contêiner certo com o codec errado (o HEVC que o iPhone
 *   grava, mesmo dentro de um .mp4) a Meta aceita no upload e o aparelho de quem
 *   recebe não toca — o mesmo "válido não é o mesmo que toca" do áudio.
 *
 * ===========================================================================
 * POR QUE O VÍDEO NÃO É CONVERTIDO AQUI
 * ===========================================================================
 * Decisão de 16/10/2026: o worker-wa roda numa máquina de 1 CPU compartilhada e
 * 512 MB. Recodificar um vídeo de um minuto lá leva mais do que os 120 s de
 * `visibility timeout` da `wa_outbound`, e a mensagem voltaria à fila no meio da
 * conversão — com risco de sair duas vezes. Então o vídeo é CONFERIDO
 * (`ffprobe`, que já vem com o ffmpeg da imagem) e, se não servir, falha com a
 * frase que diz o que fazer.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** O teto da Cloud API para foto (5 MB). */
export const TETO_DE_FOTO_BYTES = 5 * 1024 * 1024;

/** O teto da Cloud API para vídeo (16 MB). */
export const TETO_DE_VIDEO_BYTES = 16 * 1024 * 1024;

export type TipoDeMidia = 'image' | 'video';

/** O nome vai junto porque a Meta confere a extensão contra o contêiner. */
const NOME_DA_FOTO: Readonly<Record<string, string>> = {
  'image/jpeg': 'foto.jpg',
  'image/png': 'foto.png',
};

const NOME_DO_VIDEO: Readonly<Record<string, string>> = {
  'video/mp4': 'video.mp4',
  'video/3gpp': 'video.3gp',
};

export class ErroDaMidia extends Error {
  constructor(
    mensagem: string,
    readonly codigo: string,
  ) {
    super(mensagem);
    this.name = 'ErroDaMidia';
  }
}

export interface MidiaPronta {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly nome: string;
}

/** Os codecs de um vídeo, como o `ffprobe` os nomeia (`h264`, `hevc`, `aac`…). */
export interface CodecsDoVideo {
  readonly video: string | null;
  readonly audio: string | null;
}

export type Sondar = (bytes: Uint8Array) => Promise<CodecsDoVideo>;

function tipoBase(mime: string | null): string {
  return (mime ?? '').split(';')[0]!.trim().toLowerCase();
}

function megas(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/**
 * Confere o arquivo e devolve o que sobe para a Meta. Toda recusa tem código
 * próprio: é ele que vira `error_code` na linha e a frase que a tela mostra.
 */
export async function prepararMidia(
  tipo: TipoDeMidia,
  arquivo: { bytes: Uint8Array; mime: string | null },
  sondar: Sondar = sondarVideo,
): Promise<MidiaPronta> {
  if (arquivo.bytes.length === 0) {
    throw new ErroDaMidia('o arquivo está vazio', 'midia_vazia');
  }
  const base = tipoBase(arquivo.mime);

  if (tipo === 'image') {
    const nome = NOME_DA_FOTO[base];
    if (!nome) {
      throw new ErroDaMidia(
        `a Meta só aceita foto em JPEG ou PNG, e esta é "${base || 'sem tipo'}"`,
        'foto_de_tipo_recusado',
      );
    }
    if (arquivo.bytes.length > TETO_DE_FOTO_BYTES) {
      throw new ErroDaMidia(
        `a foto tem ${megas(arquivo.bytes.length)} e o teto da Meta é 5 MB`,
        'foto_grande_demais',
      );
    }
    return { bytes: arquivo.bytes, mime: base, nome };
  }

  const nome = NOME_DO_VIDEO[base];
  if (!nome) {
    throw new ErroDaMidia(
      `a Meta só aceita vídeo em MP4 ou 3GP, e este é "${base || 'sem tipo'}"`,
      'video_de_tipo_recusado',
    );
  }
  if (arquivo.bytes.length > TETO_DE_VIDEO_BYTES) {
    throw new ErroDaMidia(
      `o vídeo tem ${megas(arquivo.bytes.length)} e o teto da Meta é 16 MB`,
      'video_grande_demais',
    );
  }

  const codecs = await sondar(arquivo.bytes);
  if (codecs.video !== 'h264') {
    throw new ErroDaMidia(
      codecs.video === null
        ? 'o arquivo não tem imagem de vídeo'
        : `o vídeo está em ${codecs.video.toUpperCase()}, e o WhatsApp só toca H.264: exporte em MP4 (H.264) e envie de novo`,
      'video_de_codec_recusado',
    );
  }
  if (codecs.audio !== null && codecs.audio !== 'aac') {
    throw new ErroDaMidia(
      `o som do vídeo está em ${codecs.audio.toUpperCase()}, e o WhatsApp só toca AAC: exporte em MP4 (H.264 com AAC) e envie de novo`,
      'video_de_codec_recusado',
    );
  }
  return { bytes: arquivo.bytes, mime: base, nome };
}

/** A saída do `ffprobe -of json` lida em codecs. Pura, para caber em teste. */
/**
 * Os documentos que a Meta aceita (o resto ela recusa com 131053) e o teto
 * deles. A Meta aceita 100 MB; o balde guarda até 50 MB e o worker segura o
 * arquivo inteiro na memória (512 MB no Fly), então o teto daqui é o do balde.
 */
export const TETO_DE_DOCUMENTO_BYTES = 50 * 1024 * 1024;

const DOCUMENTOS_DA_META: ReadonlySet<string> = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/zip',
  'application/octet-stream',
]);

/** A figurinha: webp, 100 KB parada e 500 KB animada (o teto maior vale aqui). */
export const TETO_DE_FIGURINHA_BYTES = 500 * 1024;

/**
 * Documento e figurinha (27/10/2026). Não há o que converter: o documento vai
 * como está, com o nome que a pessoa deu; a figurinha só confere tipo e teto.
 */
export function prepararArquivo(
  tipo: 'document' | 'sticker',
  arquivo: { bytes: Uint8Array; mime: string | null; nome?: string | null },
): MidiaPronta {
  if (arquivo.bytes.length === 0) {
    throw new ErroDaMidia('o arquivo está vazio', 'midia_vazia');
  }
  const base = tipoBase(arquivo.mime);
  if (tipo === 'sticker') {
    if (base !== 'image/webp') {
      throw new ErroDaMidia('figurinha é imagem webp', 'figurinha_de_tipo_recusado');
    }
    if (arquivo.bytes.length > TETO_DE_FIGURINHA_BYTES) {
      throw new ErroDaMidia(
        `a figurinha tem ${megas(arquivo.bytes.length)} e o teto da Meta é 500 KB`,
        'figurinha_grande_demais',
      );
    }
    return { bytes: arquivo.bytes, mime: base, nome: 'figurinha.webp' };
  }
  if (!DOCUMENTOS_DA_META.has(base)) {
    throw new ErroDaMidia(
      `a Meta não aceita documento do tipo "${base || 'sem tipo'}"`,
      'documento_de_tipo_recusado',
    );
  }
  if (arquivo.bytes.length > TETO_DE_DOCUMENTO_BYTES) {
    throw new ErroDaMidia(
      `o documento tem ${megas(arquivo.bytes.length)} e o teto é 50 MB`,
      'documento_grande_demais',
    );
  }
  return { bytes: arquivo.bytes, mime: base, nome: arquivo.nome?.trim() || 'documento' };
}

export function codecsDaSondagem(saida: string): CodecsDoVideo {
  let dados: { streams?: { codec_type?: unknown; codec_name?: unknown }[] };
  try {
    dados = JSON.parse(saida) as typeof dados;
  } catch {
    throw new ErroDaMidia('o ffprobe respondeu algo que não é JSON', 'video_ilegivel');
  }
  const trilhas = Array.isArray(dados.streams) ? dados.streams : [];
  const codec = (qual: string): string | null => {
    const t = trilhas.find((s) => s.codec_type === qual);
    return typeof t?.codec_name === 'string' ? t.codec_name.toLowerCase() : null;
  };
  return { video: codec('video'), audio: codec('audio') };
}

/**
 * Pergunta ao `ffprobe` quais codecs o vídeo tem.
 *
 * Num arquivo temporário, e não pela entrada padrão: o MP4 do celular costuma
 * guardar o índice (`moov`) no FIM do arquivo, e lido por cano o `ffprobe` nem
 * sempre chega lá.
 */
export async function sondarVideo(
  bytes: Uint8Array,
  executar: typeof spawn = spawn,
): Promise<CodecsDoVideo> {
  const pasta = await mkdtemp(join(tmpdir(), 'video-'));
  const caminho = join(pasta, 'entrada');
  try {
    await writeFile(caminho, bytes);
    const saida = await new Promise<string>((resolve, reject) => {
      const ffprobe = executar('ffprobe', [
        '-v', 'error',
        '-show_entries', 'stream=codec_type,codec_name',
        '-of', 'json',
        caminho,
      ]);
      const pedacos: Buffer[] = [];
      const erros: Buffer[] = [];
      ffprobe.stdout?.on('data', (p: Buffer) => pedacos.push(p));
      ffprobe.stderr?.on('data', (p: Buffer) => erros.push(p));
      ffprobe.on('error', (erro: NodeJS.ErrnoException) => {
        reject(
          new ErroDaMidia(
            erro.code === 'ENOENT'
              ? 'ffprobe não existe nesta imagem: o vídeo não tem como ser conferido'
              : `ffprobe não rodou: ${erro.message}`,
            'ffprobe_ausente',
          ),
        );
      });
      ffprobe.on('close', (codigo) => {
        if (codigo !== 0) {
          const detalhe = Buffer.concat(erros).toString('utf8').slice(0, 300);
          reject(new ErroDaMidia(`o ffprobe não leu o vídeo: ${detalhe}`, 'video_ilegivel'));
          return;
        }
        resolve(Buffer.concat(pedacos).toString('utf8'));
      });
    });
    return codecsDaSondagem(saida);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}
