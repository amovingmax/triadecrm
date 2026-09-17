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
 * ===========================================================================
 * POR QUE RECODIFICAR, DEPOIS DE EU TER ESCRITO QUE NÃO SE DEVE
 * ===========================================================================
 * A primeira versão disto trocava só a embalagem (`ffmpeg -c:a copy`): o webm do
 * navegador já carrega Opus dentro, e reescrever o contêiner não toca no som.
 * O raciocínio estava certo e o resultado, não. Em produção a Meta aceitou o
 * arquivo (HTTP 200, media id devolvido), a mensagem foi entregue e LIDA — e no
 * celular de quem recebeu ela apareceu como áudio indisponível.
 *
 * Medido, lado a lado: o remux saía com 4 s a 129 kbit/s (66 KB), e o áudio que
 * o PRÓPRIO WhatsApp nos manda tem 19 kbit/s. Os dois são ogg/opus mono 48 kHz e
 * os dois passam no ffprobe — "válido" não é a mesma coisa que "o aplicativo
 * toca". Sem poder testar senão enviando, a escolha é parar de apostar na
 * inspeção do arquivo e entregar o formato que o WhatsApp produz para voz.
 *
 * Então o caminho depende do que chegou:
 *
 * - **ogg** → sobe como está: já É o formato de destino.
 * - **o resto** (webm do Chrome, mp4 do Safari, e a biblioteca em aac/amr/mpeg)
 *   → vira ogg/opus mono, 48 kHz, 32 kbit/s, perfil `voip`. São ~20 ms de CPU
 *   por áudio de um minuto, num worker que passa o dia esperando fila.
 *
 * A perda de qualidade que eu usei como argumento contra recodificar é real e é
 * irrelevante aqui: 32 kbit/s de Opus em voz mono é acima do que o próprio
 * WhatsApp usa, e áudio que não toca tem qualidade zero.
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

/** O que a Cloud API aceita como áudio (R04 §2.1). Nem tudo que ela aceita toca. */
export const MIMES_QUE_A_META_ACEITA: ReadonlySet<string> = new Set([
  'audio/aac',
  'audio/amr',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
]);

/**
 * O que o navegador pode gravar, e o que a biblioteca pode guardar: tudo isto
 * vira ogg/opus antes de sair. A lista existe para RECUSAR o que não é áudio —
 * mandar à Meta um contêiner desconhecido gasta uma chamada para receber 400, e
 * o erro dela não diz qual mensagem era.
 */
const MIMES_QUE_SABEMOS_CONVERTER: ReadonlySet<string> = new Set([
  'audio/aac',
  'audio/amr',
  'audio/mpeg',
  'audio/mp4',
  'audio/webm',
  'video/webm',
  'audio/x-m4a',
]);

/**
 * Voz, mono, 48 kHz, 24 kbit/s.
 *
 * A taxa não é gosto: a Meta mostra ÍCONE DE DOWNLOAD em vez de play quando a
 * mensagem de voz passa de 512 KB. A 32 kbit/s, os dois minutos que a tela
 * permite gravar dão 480 KB — passar raspando por um teto é o mesmo que não ter
 * teto. A 24 kbit/s são 360 KB, com folga, e ainda acima do que o próprio
 * WhatsApp usa nos áudios que ele nos manda (medido: 19 kbit/s).
 * `-map_metadata -1` tira o que o navegador escreveu no arquivo (o Chrome assina
 * "Chrome", o Opera assina "Opera"): metadado de gravação não tem por que viajar
 * junto com a voz de alguém.
 */
const ARGUMENTOS_DO_OPUS: readonly string[] = [
  '-vn',
  '-map_metadata', '-1',
  '-c:a', 'libopus',
  '-b:a', '24k',
  '-ar', '48000',
  '-ac', '1',
  '-application', 'voip',
  '-f', 'ogg',
];

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
export function comoSubir(mime: string | null): 'como_esta' | 'converter' | 'desconhecido' {
  const base = tipoBase(mime);
  if (base === 'audio/ogg') return 'como_esta';
  if (MIMES_QUE_SABEMOS_CONVERTER.has(base)) return 'converter';
  return 'desconhecido';
}

/**
 * Vira ogg/opus de voz.
 *
 * Se o ffmpeg não existir na imagem, o erro é de configuração e precisa ser dito
 * assim — não como "a Meta recusou o áudio", que mandaria alguém procurar no
 * lugar errado.
 */
export async function converterParaOpus(
  bytes: Uint8Array,
  executar: typeof spawn = spawn,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const ffmpeg = executar('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      ...ARGUMENTOS_DO_OPUS,
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
 * contêiner. Como tudo que sai daqui é ogg, o nome é sempre `audio.ogg`: um
 * nome que não corresponde ao conteúdo é recusado com uma mensagem que não
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
    return { bytes: arquivo.bytes, mime: 'audio/ogg', nome: 'audio.ogg' };
  }

  const convertido = await converterParaOpus(arquivo.bytes, executar);
  if (convertido.length > TETO_DE_AUDIO_BYTES) {
    throw new ErroDoAudio('o áudio convertido passou do teto de 16 MB', 'audio_grande_demais');
  }
  return { bytes: convertido, mime: 'audio/ogg', nome: 'audio.ogg' };
}
