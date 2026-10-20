/**
 * A foto e o vídeo que saem do CRM (16/10/2026): o que a Meta aceita, e a
 * frase de cada recusa. A conferência dos codecs é medida com um `sondar`
 * falso — o `ffprobe` de verdade mora na imagem do worker.
 */
import { describe, expect, it } from 'vitest';

import {
  codecsDaSondagem,
  ErroDaMidia,
  prepararMidia,
  TETO_DE_FOTO_BYTES,
  TETO_DE_VIDEO_BYTES,
  type CodecsDoVideo,
} from './midia-de-saida';

const bytes = (n = 10) => new Uint8Array(n).fill(1);
const sondarCom = (codecs: CodecsDoVideo) => async () => codecs;
const H264_AAC = sondarCom({ video: 'h264', audio: 'aac' });

async function codigoDaRecusa(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroDaMidia) return erro.codigo;
    throw erro;
  }
  return 'passou';
}

describe('a foto que sai', () => {
  it('JPEG e PNG sobem como estão, com o nome que a Meta confere', async () => {
    expect(await prepararMidia('image', { bytes: bytes(), mime: 'image/jpeg' })).toMatchObject({
      mime: 'image/jpeg',
      nome: 'foto.jpg',
    });
    expect(await prepararMidia('image', { bytes: bytes(), mime: 'image/png' })).toMatchObject({
      mime: 'image/png',
      nome: 'foto.png',
    });
  });

  it('webp e HEIC são recusados: a Meta não os aceita como foto', async () => {
    expect(await codigoDaRecusa(prepararMidia('image', { bytes: bytes(), mime: 'image/webp' }))).toBe(
      'foto_de_tipo_recusado',
    );
    expect(await codigoDaRecusa(prepararMidia('image', { bytes: bytes(), mime: 'image/heic' }))).toBe(
      'foto_de_tipo_recusado',
    );
  });

  it('acima de 5 MB não sobe, e o vazio também não', async () => {
    const grande = new Uint8Array(TETO_DE_FOTO_BYTES + 1);
    expect(await codigoDaRecusa(prepararMidia('image', { bytes: grande, mime: 'image/jpeg' }))).toBe(
      'foto_grande_demais',
    );
    expect(
      await codigoDaRecusa(prepararMidia('image', { bytes: new Uint8Array(0), mime: 'image/jpeg' })),
    ).toBe('midia_vazia');
  });
});

describe('o vídeo que sai', () => {
  it('MP4 com H.264 e AAC sobe como está', async () => {
    const pronto = await prepararMidia('video', { bytes: bytes(), mime: 'video/mp4' }, H264_AAC);
    expect(pronto).toMatchObject({ mime: 'video/mp4', nome: 'video.mp4' });
  });

  it('vídeo sem som também serve', async () => {
    const semSom = sondarCom({ video: 'h264', audio: null });
    expect(await codigoDaRecusa(prepararMidia('video', { bytes: bytes(), mime: 'video/mp4' }, semSom))).toBe(
      'passou',
    );
  });

  it('o HEVC do iPhone é recusado mesmo dentro de um .mp4, dizendo o que fazer', async () => {
    const hevc = sondarCom({ video: 'hevc', audio: 'aac' });
    const promessa = prepararMidia('video', { bytes: bytes(), mime: 'video/mp4' }, hevc);
    await expect(promessa).rejects.toThrow(/HEVC.*H\.264/);
    expect(await codigoDaRecusa(prepararMidia('video', { bytes: bytes(), mime: 'video/mp4' }, hevc))).toBe(
      'video_de_codec_recusado',
    );
  });

  it('som que não é AAC também não toca no WhatsApp', async () => {
    const opus = sondarCom({ video: 'h264', audio: 'opus' });
    expect(await codigoDaRecusa(prepararMidia('video', { bytes: bytes(), mime: 'video/mp4' }, opus))).toBe(
      'video_de_codec_recusado',
    );
  });

  it('.mov e webm não chegam a ser conferidos: o contêiner já é recusado', async () => {
    let sondou = false;
    const sondar = async () => {
      sondou = true;
      return { video: 'h264', audio: 'aac' };
    };
    expect(
      await codigoDaRecusa(prepararMidia('video', { bytes: bytes(), mime: 'video/quicktime' }, sondar)),
    ).toBe('video_de_tipo_recusado');
    expect(await codigoDaRecusa(prepararMidia('video', { bytes: bytes(), mime: 'video/webm' }, sondar))).toBe(
      'video_de_tipo_recusado',
    );
    expect(sondou).toBe(false);
  });

  it('acima de 16 MB não sobe', async () => {
    const grande = new Uint8Array(TETO_DE_VIDEO_BYTES + 1);
    expect(await codigoDaRecusa(prepararMidia('video', { bytes: grande, mime: 'video/mp4' }, H264_AAC))).toBe(
      'video_grande_demais',
    );
  });
});

describe('a leitura do ffprobe', () => {
  it('acha a trilha de vídeo e a de som', () => {
    const saida = JSON.stringify({
      streams: [
        { codec_type: 'video', codec_name: 'h264' },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    });
    expect(codecsDaSondagem(saida)).toEqual({ video: 'h264', audio: 'aac' });
  });

  it('sem trilha devolve nulo, e o que não é JSON é recusa nomeada', () => {
    expect(codecsDaSondagem('{"streams":[]}')).toEqual({ video: null, audio: null });
    expect(() => codecsDaSondagem('não é json')).toThrow(ErroDaMidia);
  });
});
