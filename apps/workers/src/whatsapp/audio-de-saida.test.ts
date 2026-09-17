import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

import {
  comoSubir,
  ErroDoAudio,
  MIMES_QUE_A_META_ACEITA,
  prepararAudio,
  TETO_DE_AUDIO_BYTES,
  tipoBase,
} from './audio-de-saida';

/**
 * O áudio que alguém gravou para um parceiro é a mensagem mais cara de perder:
 * a pessoa falou, achou que mandou, e do outro lado não chegou nada. O que estes
 * testes protegem:
 *
 * 1. **O webm do Chrome vira ogg — e o mp4 do Safari não é mexido.** Recodificar
 *    o que já está certo gastaria CPU para piorar a voz de alguém.
 * 2. **Tipo que a Meta não conhece morre AQUI**, com o motivo escrito, e não lá,
 *    com um 400 que não diz qual mensagem era.
 * 3. **Sem ffmpeg na imagem, o erro diz que é ffmpeg.** É a diferença entre
 *    consertar o deploy e procurar defeito no áudio de quem gravou.
 */

function ffmpegFalso(opcoes: { codigo: number; saida?: Buffer; erro?: string; naoExiste?: boolean }) {
  return vi.fn((_comando: string, argumentos: readonly string[]) => {
    void argumentos;
    const processo = new EventEmitter() as EventEmitter & {
      stdin: EventEmitter & { end: (b: Buffer) => void };
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    processo.stdin = Object.assign(new EventEmitter(), { end: () => {} });
    processo.stdout = new EventEmitter();
    processo.stderr = new EventEmitter();

    queueMicrotask(() => {
      if (opcoes.naoExiste) {
        const erro = new Error('spawn ffmpeg ENOENT') as NodeJS.ErrnoException;
        erro.code = 'ENOENT';
        processo.emit('error', erro);
        return;
      }
      if (opcoes.saida) processo.stdout.emit('data', opcoes.saida);
      if (opcoes.erro) processo.stderr.emit('data', Buffer.from(opcoes.erro));
      processo.emit('close', opcoes.codigo);
    });

    return processo as never;
  });
}

const bytes = new Uint8Array([1, 2, 3, 4]);

describe('o que a Meta aceita', () => {
  it('reconhece o contêiner mesmo com o codec grudado no tipo', () => {
    expect(tipoBase('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(tipoBase(null)).toBe('');
  });

  it('só o ogg sobe como está — ele já É o formato de destino', () => {
    expect(comoSubir('audio/ogg')).toBe('como_esta');
    expect(MIMES_QUE_A_META_ACEITA.has('audio/mpeg')).toBe(true);
  });

  it('o que o navegador grava vira ogg, inclusive o mp4 que a Meta aceitaria', () => {
    // A lição de produção: a Meta aceitou o remux (200, media id devolvido), a
    // mensagem foi entregue e LIDA, e no celular apareceu "áudio indisponível".
    // "A Meta aceita" não é "o aplicativo toca" — então tudo sai no formato que
    // o próprio WhatsApp usa para voz.
    expect(comoSubir('audio/webm;codecs=opus')).toBe('converter');
    expect(comoSubir('video/webm')).toBe('converter');
    expect(comoSubir('audio/mp4')).toBe('converter');
    expect(comoSubir('audio/aac')).toBe('converter');
  });

  it('e o que ela não conhece é recusado antes de virar chamada', () => {
    expect(comoSubir('audio/flac')).toBe('desconhecido');
    expect(comoSubir(null)).toBe('desconhecido');
  });
});

describe('preparar o áudio', () => {
  it('não mexe no que já é ogg: converter de ogg para ogg é só perder qualidade', async () => {
    const executar = ffmpegFalso({ codigo: 0 });
    const pronto = await prepararAudio({ bytes, mime: 'audio/ogg' }, executar as never);
    expect(pronto).toEqual({ bytes, mime: 'audio/ogg', nome: 'audio.ogg' });
    expect(executar).not.toHaveBeenCalled();
  });

  it('converte o webm em opus de voz, e não num remux', async () => {
    const convertido = Buffer.from([9, 9, 9]);
    const executar = ffmpegFalso({ codigo: 0, saida: convertido });
    const pronto = await prepararAudio({ bytes, mime: 'audio/webm;codecs=opus' }, executar as never);
    expect(pronto.mime).toBe('audio/ogg');
    expect(pronto.nome).toBe('audio.ogg');
    expect([...pronto.bytes]).toEqual([9, 9, 9]);

    const argumentos = executar.mock.calls[0]?.[1] ?? [];
    // Mono, 48 kHz, perfil de voz: o que o WhatsApp manda. `copy` saiu daqui
    // porque o arquivo que ele produzia era aceito pela Meta e não tocava.
    expect(argumentos).toContain('libopus');
    expect(argumentos).toContain('voip');
    expect(argumentos).toEqual(expect.arrayContaining(['-ac', '1', '-ar', '48000']));
    expect(argumentos).not.toContain('copy');
  });

  it('o mp4 do Safari também vira ogg', async () => {
    const executar = ffmpegFalso({ codigo: 0, saida: Buffer.from([7]) });
    const pronto = await prepararAudio({ bytes, mime: 'audio/mp4' }, executar as never);
    expect(pronto.mime).toBe('audio/ogg');
    expect(executar).toHaveBeenCalled();
  });

  it('arquivo vazio e arquivo gigante não viram chamada', async () => {
    await expect(prepararAudio({ bytes: new Uint8Array(), mime: 'audio/ogg' })).rejects.toMatchObject({
      codigo: 'audio_vazio',
    });
    await expect(
      prepararAudio({ bytes: new Uint8Array(TETO_DE_AUDIO_BYTES + 1), mime: 'audio/ogg' }),
    ).rejects.toMatchObject({ codigo: 'audio_grande_demais' });
  });

  it('tipo recusado morre aqui, com o motivo legível', async () => {
    await expect(prepararAudio({ bytes, mime: 'audio/flac' })).rejects.toBeInstanceOf(ErroDoAudio);
  });

  it('sem ffmpeg na imagem, o erro acusa o ffmpeg — não o áudio', async () => {
    const executar = ffmpegFalso({ codigo: 0, naoExiste: true });
    await expect(
      prepararAudio({ bytes, mime: 'audio/webm' }, executar as never),
    ).rejects.toMatchObject({ codigo: 'ffmpeg_ausente' });
  });

  it('arquivo que o ffmpeg não lê morre como ilegível', async () => {
    const executar = ffmpegFalso({ codigo: 1, erro: 'Invalid data found' });
    await expect(
      prepararAudio({ bytes, mime: 'audio/webm' }, executar as never),
    ).rejects.toMatchObject({ codigo: 'audio_ilegivel' });
  });
});
