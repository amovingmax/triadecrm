/**
 * A transcrição do áudio — o passo que faltava para a IA enxergar metade da conversa.
 *
 * ===========================================================================
 * POR QUE ISTO EXISTE
 * ===========================================================================
 * A API do Claude lê texto, imagem e PDF; ela **não transcreve áudio**. O prompt
 * `transcricao-audio@v1` sempre soube disso: ele recebe `transcricaoBruta` e o que
 * faz é limpar, pontuar e dizer o que ficou inaudível — nunca ouvir. O ASR era do
 * `faster-whisper` na máquina dedicada (RF-MET-07, `infra/local`), que **ainda não
 * existe**: hoje a mensagem de áudio chega, o `worker-wa` enfileira `transcribe_audio`
 * com o caminho do arquivo e o `worker-ai` não tem o que limpar.
 *
 * Este arquivo fecha o buraco com um provedor por HTTP (decisão 4 do GATE 0: Groq
 * Whisper `large-v3-turbo` até a máquina existir). O resto da esteira não muda: o
 * texto do ASR continua indo para o mesmo prompt, que continua sendo quem entrega
 * texto legível e a lista de trechos inaudíveis.
 *
 * ===========================================================================
 * O QUE ELE RECUSA
 * ===========================================================================
 * - **Sem chave, não inventa.** Ausência de `GROQ_API_KEY` é configuração faltando,
 *   não erro de rede: o trabalho volta como determinístico, para o log dizer o que
 *   fazer em vez de a fila girar cinco vezes até a dead-letter.
 * - **Áudio longo demais não sobe.** O teto vem de `app_settings` (10 min por
 *   padrão): um arquivo de meia hora é quase sempre um encaminhamento, e o custo
 *   cresce por minuto.
 * - **O áudio não vira token do Claude.** Ele vai só para o ASR; o que chega ao
 *   modelo é a transcrição, já pseudonimizada pelo caminho de sempre.
 */

/** O que o ASR devolve, no formato que o prompt de limpeza espera. */
export interface TranscricaoBruta {
  readonly texto: string;
  /** 0–1. O Whisper não devolve confiança direta; derivamos da probabilidade média. */
  readonly confianca: number;
  readonly duracaoSeg: number;
}

export class ErroDeTranscricao extends Error {
  constructor(
    mensagem: string,
    readonly transitorio: boolean,
  ) {
    super(mensagem);
    this.name = 'ErroDeTranscricao';
  }
}

export interface ConfiguracaoDoAsr {
  readonly provedor: string;
  readonly modelo: string;
  readonly duracaoMaximaSeg: number;
}

export const ASR_PADRAO: ConfiguracaoDoAsr = {
  provedor: 'groq',
  modelo: 'whisper-large-v3-turbo',
  duracaoMaximaSeg: 600,
};

const GROQ = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * A confiança a partir do `avg_logprob` de cada segmento: `e^logprob`, média ponderada
 * pela duração. É a mesma conta que o `faster-whisper` usa para o número que a nossa
 * esteira já consumia, e mantê-la é o que faz o teto de inaudíveis do prompt continuar
 * significando a mesma coisa.
 */
export function confiancaDosSegmentos(
  segmentos: readonly { avg_logprob?: number; start?: number; end?: number }[],
): number {
  let peso = 0;
  let soma = 0;
  for (const s of segmentos) {
    const dur = Math.max(0.1, (s.end ?? 0) - (s.start ?? 0));
    const p = Math.exp(typeof s.avg_logprob === 'number' ? s.avg_logprob : -1);
    soma += p * dur;
    peso += dur;
  }
  if (peso === 0) return 0.5;
  return Math.min(1, Math.max(0, soma / peso));
}

export async function transcrever(
  audio: { bytes: Uint8Array; nome: string; mime: string },
  config: ConfiguracaoDoAsr,
  chave: string | undefined,
  buscar: typeof fetch = fetch,
): Promise<TranscricaoBruta> {
  if (config.provedor !== 'groq') {
    throw new ErroDeTranscricao(
      `provedor de transcrição "${config.provedor}" não está implementado neste worker`,
      false,
    );
  }
  if (!chave) {
    throw new ErroDeTranscricao(
      'GROQ_API_KEY ausente: o áudio não vira transcrição e a IA fica sem metade da conversa',
      false,
    );
  }

  const form = new FormData();
  form.append('file', new Blob([audio.bytes as unknown as BlobPart], { type: audio.mime }), audio.nome);
  form.append('model', config.modelo);
  form.append('language', 'pt');
  form.append('response_format', 'verbose_json');
  // O prompt do ASR é contexto de vocabulário, não instrução: nomes que ele erraria.
  form.append('prompt', 'Komune, Natal, RN, buffet, cerimonialista, orçamento, evento.');

  let resposta: Response;
  try {
    resposta = await buscar(GROQ, {
      method: 'POST',
      headers: { authorization: `Bearer ${chave}` },
      body: form,
    });
  } catch (erro) {
    throw new ErroDeTranscricao(`rede falhou ao transcrever: ${(erro as Error).message}`, true);
  }

  if (!resposta.ok) {
    const corpo = (await resposta.text()).slice(0, 300);
    // 429 e 5xx passam; 400/401/413 são a configuração ou o arquivo, e repetir gasta igual.
    const transitorio = resposta.status === 429 || resposta.status >= 500;
    throw new ErroDeTranscricao(`ASR recusou (${resposta.status}): ${corpo}`, transitorio);
  }

  const dados = (await resposta.json()) as {
    text?: unknown;
    duration?: unknown;
    segments?: { avg_logprob?: number; start?: number; end?: number }[];
  };
  const texto = typeof dados.text === 'string' ? dados.text.trim() : '';
  if (texto === '') {
    throw new ErroDeTranscricao('o ASR devolveu texto vazio: áudio mudo ou corrompido', false);
  }
  const duracaoSeg = Math.max(
    1,
    Math.round(typeof dados.duration === 'number' ? dados.duration : 1),
  );
  if (duracaoSeg > config.duracaoMaximaSeg) {
    throw new ErroDeTranscricao(
      `áudio de ${duracaoSeg}s passa do teto de ${config.duracaoMaximaSeg}s`,
      false,
    );
  }

  return {
    texto: texto.slice(0, 12000),
    confianca: Number(confiancaDosSegmentos(dados.segments ?? []).toFixed(3)),
    duracaoSeg,
  };
}
