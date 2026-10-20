import { describe, expect, it } from 'vitest';

import {
  caminhoDaMidia,
  comoMandar,
  conferirParaSubir,
  fraseDaMidia,
  lerCaminho,
  medidasReduzidas,
  mimeDoVideo,
  TETO_DE_FOTO_BYTES,
  TETO_DE_VIDEO_BYTES,
} from './midia-de-saida';

const arquivo = (type: string, name: string, size = 1000) => ({ type, name, size });
const FIO = '22222222-2222-4222-8222-222222222222';

describe('o que a pessoa escolheu (16/10/2026)', () => {
  it('toda foto que o navegador abre é foto: JPEG, PNG, webp, HEIC', () => {
    for (const a of [
      arquivo('image/jpeg', 'a.jpg'),
      arquivo('image/png', 'print.png'),
      arquivo('image/webp', 'a.webp'),
      arquivo('image/heic', 'IMG_0001.HEIC'),
    ]) {
      expect(comoMandar(a)).toEqual({ ok: true, tipo: 'image' });
    }
  });

  it('a foto do iPhone sem tipo, no Chrome do computador, é reconhecida pela extensão', () => {
    expect(comoMandar(arquivo('', 'IMG_0001.HEIC'))).toEqual({ ok: true, tipo: 'image' });
  });

  it('SVG não é foto', () => {
    expect(comoMandar(arquivo('image/svg+xml', 'logo.svg'))).toEqual({
      ok: false,
      motivo: 'tipo_nao_aceito',
    });
  });

  it('vídeo MP4 até 16 MB serve; acima, não', () => {
    expect(comoMandar(arquivo('video/mp4', 'v.mp4', TETO_DE_VIDEO_BYTES))).toEqual({
      ok: true,
      tipo: 'video',
    });
    expect(comoMandar(arquivo('video/mp4', 'v.mp4', TETO_DE_VIDEO_BYTES + 1))).toEqual({
      ok: false,
      motivo: 'video_grande_demais',
    });
  });

  it('o .mov do iPhone tem recusa própria, que diz para exportar em MP4', () => {
    expect(comoMandar(arquivo('video/quicktime', 'IMG_0002.MOV'))).toEqual({
      ok: false,
      motivo: 'video_mov',
    });
    expect(fraseDaMidia('video_mov')).toMatch(/MP4/);
  });

  it('webm e PDF não vão', () => {
    expect(comoMandar(arquivo('video/webm', 'v.webm'))).toEqual({
      ok: false,
      motivo: 'video_de_tipo_recusado',
    });
    expect(comoMandar(arquivo('application/pdf', 'proposta.pdf'))).toEqual({
      ok: false,
      motivo: 'tipo_nao_aceito',
    });
    expect(comoMandar(arquivo('image/jpeg', 'vazio.jpg', 0))).toEqual({
      ok: false,
      motivo: 'midia_vazia',
    });
  });

  it('o tipo do vídeo que sobe vem do arquivo, ou da extensão quando veio vazio', () => {
    expect(mimeDoVideo({ type: 'video/mp4', name: 'v.mp4' })).toBe('video/mp4');
    expect(mimeDoVideo({ type: '', name: 'v.3gp' })).toBe('video/3gpp');
  });
});

describe('a foto reduzida', () => {
  it('cabe no lado máximo sem deformar', () => {
    expect(medidasReduzidas(4032, 3024)).toEqual({ largura: 2048, altura: 1536 });
    expect(medidasReduzidas(3024, 4032)).toEqual({ largura: 1536, altura: 2048 });
  });

  it('a pequena fica como está', () => {
    expect(medidasReduzidas(800, 600)).toEqual({ largura: 800, altura: 600 });
  });
});

describe('o que o servidor aceita subir', () => {
  it('foto JPEG/PNG até 5 MB, vídeo MP4/3GP até 16 MB, com a extensão certa', () => {
    expect(conferirParaSubir('image', 'image/jpeg', 100)).toEqual({
      ok: true,
      extensao: 'jpg',
      mime: 'image/jpeg',
    });
    expect(conferirParaSubir('video', 'video/3gpp', 100)).toEqual({
      ok: true,
      extensao: '3gp',
      mime: 'video/3gpp',
    });
    expect(conferirParaSubir('image', 'image/jpeg', TETO_DE_FOTO_BYTES + 1)).toEqual({
      ok: false,
      motivo: 'foto_grande_demais',
    });
  });

  it('o tipo declarado tem de bater com o arquivo: foto que diz ser vídeo não sobe', () => {
    expect(conferirParaSubir('video', 'image/jpeg', 100)).toEqual({
      ok: false,
      motivo: 'tipo_nao_aceito',
    });
    expect(conferirParaSubir('image', 'image/webp', 100)).toEqual({
      ok: false,
      motivo: 'tipo_nao_aceito',
    });
    expect(conferirParaSubir('image', 'image/jpeg', Number.NaN)).toEqual({
      ok: false,
      motivo: 'midia_vazia',
    });
  });
});

describe('o caminho no balde', () => {
  it('mora na pasta da conversa, e o servidor o lê de volta', () => {
    const caminho = caminhoDaMidia(FIO, 'jpg', 1760000000000, 'abcd1234');
    expect(caminho).toBe(`${FIO}/saida/1760000000000-abcd1234.jpg`);
    expect(lerCaminho(caminho, FIO)).toEqual({ tipo: 'image', mime: 'image/jpeg' });
  });

  it('o caminho de OUTRA conversa, ou com outra forma, não é aceito', () => {
    const outra = '33333333-3333-4333-8333-333333333333';
    expect(lerCaminho(caminhoDaMidia(outra, 'jpg', 1760000000000, 'abcd1234'), FIO)).toBeNull();
    expect(lerCaminho(`${FIO}/saida/../${outra}/saida/1760000000000-abcd1234.jpg`, FIO)).toBeNull();
    expect(lerCaminho(`${FIO}/saida/1760000000000-abcd1234.webm`, FIO)).toBeNull();
    expect(lerCaminho(`${FIO}/entrada/1760000000000-abcd1234.jpg`, FIO)).toBeNull();
  });

  it('o sufixo sorteado tem a forma que o servidor espera', () => {
    expect(lerCaminho(caminhoDaMidia(FIO, 'mp4'), FIO)).toEqual({
      tipo: 'video',
      mime: 'video/mp4',
    });
  });
});
