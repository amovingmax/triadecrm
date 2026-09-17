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

  it('mp4 do Safari e ogg sobem como estão', () => {
    expect(comoSubir('audio/mp4')).toBe('como_esta');
    expect(comoSubir('audio/ogg')).toBe('como_esta');
    expect(MIMES_QUE_A_META_ACEITA.has('audio/mpeg')).toBe(true);
  });

  it('webm do Chrome troca de embalagem', () => {
    expect(comoSubir('audio/webm;codecs=opus')).toBe('trocar_embalagem');
  });

  it('e o que ela não conhece é recusado antes de virar chamada', () => {
    expect(comoSubir('audio/flac')).toBe('desconhecido');
    expect(comoSubir(null)).toBe('desconhecido');
  });
});

describe('preparar o áudio', () => {
  it('não mexe no que já está no formato certo', async () => {
    const executar = ffmpegFalso({ codigo: 0 });
    const pronto = await prepararAudio({ bytes, mime: 'audio/mp4' }, executar as never);
    expect(pronto).toEqual({ bytes, mime: 'audio/mp4', nome: 'audio.m4a' });
    expect(executar).not.toHaveBeenCalled();
  });

  it('converte o webm e devolve ogg', async () => {
    const convertido = Buffer.from([9, 9, 9]);
    const executar = ffmpegFalso({ codigo: 0, saida: convertido });
    const pronto = await prepararAudio({ bytes, mime: 'audio/webm;codecs=opus' }, executar as never);
    expect(pronto.mime).toBe('audio/ogg');
    expect(pronto.nome).toBe('audio.ogg');
    expect([...pronto.bytes]).toEqual([9, 9, 9]);
    // `-c:a copy`: o som sai igual, só a embalagem muda.
    expect(executar.mock.calls[0]?.[1] ?? []).toContain('copy');
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
