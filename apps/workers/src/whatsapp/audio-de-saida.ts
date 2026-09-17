/**
 * O áudio gravado na tela, a caminho da Meta.
 *
 * ===========================================================================
 * A PEDRA NO MEIO: O NAVEGADOR GRAVA O QUE A META NÃO ACEITA
 * ===========================================================================
 * A Cloud API aceita `audio/ogg` (só com codec Opus), `audio/mpeg`, `audio/mp4`,
 * `audio/aac` e `audio/amr` (R04 §2.1). O `MediaRecorder` do Chrome — que é o
 * navegador de quem usa o CRM — grava em `audio/webm;codecs=opus`, e **webm não
 * está na lista**. O Safari grava em `audio/mp4`, que está.
 *
 * Então o caminho depende do que chegou:
 *
 * - **mp4, ogg, mpeg, aac, amr** → sobe como está.
 * - **webm** → troca de embalagem. E é só isso: o webm do navegador já carrega
 *   Opus dentro, que é exatamente o que o `ogg` da Meta quer. `ffmpeg -c:a copy`
 *   reescreve o contêiner sem tocar no som — nada é recodificado, nada perde
 *   qualidade, e o custo é de milissegundos.
 *
 * Recodificar seria o erro fácil aqui: gastaria CPU no worker para piorar o
 * áudio da voz de alguém.
 *
 * ===========================================================================
 * POR QUE O WORKER, E NÃO O NAVEGADOR OU A VERCEL
 * ===========================================================================
 * O navegador não converte (não há ffmpeg lá dentro) e a função da Vercel não
 * tem binário nem tempo para isso. O `worker-wa` já roda numa imagem Docker
 * nossa, já fala com a Graph API e já é quem entrega mensagem — é o único lugar
 * onde isso cabe sem inventar infraestrutura nova.
 */
import { spawn } from 'node:child_process';

/** O que a Cloud API aceita como áudio, sem conversão nenhuma (R04 §2.1). */
export const MIMES_QUE_A_META_ACEITA: ReadonlySet<string> = new Set([
  'audio/aac',
  'audio/amr',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
]);

/** O teto da Cloud API para áudio (16 MB). Acima disso ela recusa. */
export const TETO_DE_AUDIO_BYTES = 16 * 1024 * 1024;

export class ErroDoAudio extends Error {
  constructor(
    mensagem: string,
    readonly codigo: string,
  ) {
    super(mensagem);
    this.name = 'ErroDoAudio';
  }
}

/** `audio/webm;codecs=opus` → `audio/webm`. O parâmetro não muda o contêiner. */
export function tipoBase(mime: string | null): string {
  return (mime ?? '').split(';')[0]!.trim().toLowerCase();
}

/**
 * O que fazer com este arquivo antes de subir.
 *
 * `desconhecido` é recusa deliberada: mandar para a Meta um contêiner que ela
 * não conhece gasta uma chamada para receber 400, e o erro dela não diz qual
 * mensagem era. Falhar aqui diz.
 */
export function comoSubir(mime: string | null): 'como_esta' | 'trocar_embalagem' | 'desconhecido' {
  const base = tipoBase(mime);
  if (MIMES_QUE_A_META_ACEITA.has(base)) return 'como_esta';
  if (base === 'audio/webm' || base === 'video/webm') return 'trocar_embalagem';
  return 'desconhecido';
}

/**
 * Troca o contêiner de webm para ogg, sem recodificar o som.
 *
 * `-c:a copy` é o ponto inteiro: o Opus que está lá dentro sai igual. Se o
 * ffmpeg não existir na imagem, o erro é de configuração e precisa ser dito
 * assim — não como "a Meta recusou o áudio", que mandaria alguém procurar no
 * lugar errado.
 */
export async function trocarEmbalagem(
  bytes: Uint8Array,
  executar: typeof spawn = spawn,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const ffmpeg = executar('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-c:a', 'copy',
      '-f', 'ogg',
      'pipe:1',
    ]);

    const pedacos: Buffer[] = [];
    const erros: Buffer[] = [];
    ffmpeg.stdout?.on('data', (p: Buffer) => pedacos.push(p));
    ffmpeg.stderr?.on('data', (p: Buffer) => erros.push(p));

    ffmpeg.on('error', (erro: NodeJS.ErrnoException) => {
      reject(
        new ErroDoAudio(
          erro.code === 'ENOENT'
            ? 'ffmpeg não existe nesta imagem: o áudio do navegador não tem como virar ogg'
            : `ffmpeg não rodou: ${erro.message}`,
          'ffmpeg_ausente',
        ),
      );
    });

    ffmpeg.on('close', (codigo) => {
      if (codigo !== 0) {
        const detalhe = Buffer.concat(erros).toString('utf8').slice(0, 300);
        reject(new ErroDoAudio(`ffmpeg recusou o arquivo: ${detalhe}`, 'audio_ilegivel'));
        return;
      }
      const saida = Buffer.concat(pedacos);
      if (saida.length === 0) {
        reject(new ErroDoAudio('a conversão devolveu arquivo vazio', 'audio_ilegivel'));
        return;
      }
      resolve(new Uint8Array(saida));
    });

    ffmpeg.stdin?.on('error', () => {
      // O ffmpeg pode fechar a entrada antes de a gente terminar de escrever
      // (arquivo inválido). Quem reporta é o `close` acima, com o motivo dele.
    });
    ffmpeg.stdin?.end(Buffer.from(bytes));
  });
}

/**
 * O arquivo pronto para subir: bytes, tipo e nome.
 *
 * O nome importa mais do que parece — a Meta usa a extensão para conferir o
 * contêiner, e um `.webm` chamando-se ogg é recusado com uma mensagem que não
 * explica nada.
 */
export interface AudioPronto {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly nome: string;
}

export async function prepararAudio(
  arquivo: { bytes: Uint8Array; mime: string | null },
  executar: typeof spawn = spawn,
): Promise<AudioPronto> {
  if (arquivo.bytes.length === 0) {
    throw new ErroDoAudio('o arquivo do áudio está vazio', 'audio_vazio');
  }
  if (arquivo.bytes.length > TETO_DE_AUDIO_BYTES) {
    throw new ErroDoAudio(
      `o áudio tem ${Math.round(arquivo.bytes.length / 1024 / 1024)} MB e o teto da Meta é 16 MB`,
      'audio_grande_demais',
    );
  }

  const caminho = comoSubir(arquivo.mime);
  if (caminho === 'desconhecido') {
    throw new ErroDoAudio(
      `a Meta não aceita "${tipoBase(arquivo.mime) || 'sem tipo'}" como áudio`,
      'audio_de_tipo_recusado',
    );
  }
  if (caminho === 'como_esta') {
    const mime = tipoBase(arquivo.mime);
    return { bytes: arquivo.bytes, mime, nome: `audio.${extensaoDe(mime)}` };
  }

  const convertido = await trocarEmbalagem(arquivo.bytes, executar);
  if (convertido.length > TETO_DE_AUDIO_BYTES) {
    throw new ErroDoAudio('o áudio convertido passou do teto de 16 MB', 'audio_grande_demais');
  }
  return { bytes: convertido, mime: 'audio/ogg', nome: 'audio.ogg' };
}

function extensaoDe(mime: string): string {
  switch (mime) {
    case 'audio/ogg':
      return 'ogg';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/aac':
      return 'aac';
    case 'audio/amr':
      return 'amr';
    default:
      return 'bin';
  }
}
