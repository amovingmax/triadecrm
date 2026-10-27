import { describe, expect, it } from 'vitest';

import {
  caminhoDaCapaDoGrupo,
  caminhoDaFotoDoPerfil,
  caminhoNoGrupo,
  comoMandarNoGrupo,
  conferirArquivoDoGrupo,
  conferirCapa,
  ehUuid,
  fraseDoArquivo,
  recorteQuadrado,
} from './midia-dos-grupos';

const MB = 1024 * 1024;
const GRUPO = '7d1f2a40-0c8e-4c1b-9a77-2f0b1c3d4e5f';

describe('comoMandarNoGrupo', () => {
  it('toda imagem vira foto em JPEG, inclusive o HEIC sem tipo', () => {
    expect(comoMandarNoGrupo({ type: 'image/webp', name: 'a.webp', size: 10 })).toEqual({
      ok: true,
      tipo: 'image',
      mime: 'image/jpeg',
    });
    expect(comoMandarNoGrupo({ type: '', name: 'IMG_1.HEIC', size: 10 })).toMatchObject({
      ok: true,
      tipo: 'image',
    });
  });

  it('SVG não é foto', () => {
    expect(comoMandarNoGrupo({ type: 'image/svg+xml', name: 'x.svg', size: 10 })).toEqual({
      ok: false,
      motivo: 'tipo_nao_aceito',
    });
  });

  it('vídeo MP4 vai; .mov e webm não', () => {
    expect(comoMandarNoGrupo({ type: 'video/mp4', name: 'v.mp4', size: MB })).toMatchObject({
      ok: true,
      tipo: 'video',
    });
    expect(comoMandarNoGrupo({ type: 'video/quicktime', name: 'v.mov', size: MB })).toEqual({
      ok: false,
      motivo: 'video_mov',
    });
    expect(comoMandarNoGrupo({ type: 'video/webm', name: 'v.webm', size: MB })).toEqual({
      ok: false,
      motivo: 'video_de_tipo_recusado',
    });
  });

  it('áudio pelo tipo, pelo apelido e pela extensão', () => {
    expect(comoMandarNoGrupo({ type: 'audio/mp3', name: 'a.mp3', size: MB })).toEqual({
      ok: true,
      tipo: 'audio',
      mime: 'audio/mpeg',
    });
    expect(comoMandarNoGrupo({ type: '', name: 'nota.opus', size: MB })).toEqual({
      ok: true,
      tipo: 'audio',
      mime: 'audio/ogg',
    });
    expect(comoMandarNoGrupo({ type: 'audio/webm', name: 'g.webm', size: MB })).toEqual({
      ok: false,
      motivo: 'audio_de_tipo_recusado',
    });
  });

  it('documento pelo tipo ou pela extensão, até 50 MB', () => {
    expect(
      comoMandarNoGrupo({ type: 'application/octet-stream', name: 'Proposta.DOCX', size: MB }),
    ).toEqual({
      ok: true,
      tipo: 'document',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(comoMandarNoGrupo({ type: 'application/pdf', name: 'c.pdf', size: 51 * MB })).toEqual({
      ok: false,
      motivo: 'grande_demais',
    });
    expect(comoMandarNoGrupo({ type: 'application/zip', name: 'c.zip', size: MB })).toEqual({
      ok: false,
      motivo: 'tipo_nao_aceito',
    });
  });

  it('arquivo vazio é recusado antes de tudo', () => {
    expect(comoMandarNoGrupo({ type: 'application/pdf', name: 'c.pdf', size: 0 })).toEqual({
      ok: false,
      motivo: 'arquivo_vazio',
    });
  });
});

describe('conferirArquivoDoGrupo', () => {
  it('o tipo declarado tem de bater com o arquivo', () => {
    expect(conferirArquivoDoGrupo('video', 'image/jpeg', 10)).toEqual({
      ok: false,
      motivo: 'tipo_nao_aceito',
    });
    expect(conferirArquivoDoGrupo('audio', 'audio/ogg; codecs=opus', 10)).toEqual({
      ok: true,
      extensao: 'ogg',
      mime: 'audio/ogg',
    });
  });

  it('cada tipo tem o seu teto', () => {
    expect(conferirArquivoDoGrupo('image', 'image/png', 6 * MB)).toMatchObject({ ok: false });
    expect(conferirArquivoDoGrupo('audio', 'audio/mpeg', 15 * MB)).toMatchObject({ ok: true });
    expect(conferirArquivoDoGrupo('document', 'application/pdf', 0)).toEqual({
      ok: false,
      motivo: 'arquivo_vazio',
    });
  });
});

describe('conferirCapa', () => {
  it('JPEG ou PNG até 5 MB', () => {
    expect(conferirCapa('image/jpeg', MB)).toEqual({ ok: true, extensao: 'jpg' });
    expect(conferirCapa('image/png', MB)).toEqual({ ok: true, extensao: 'png' });
    expect(conferirCapa('image/webp', MB)).toMatchObject({ ok: false });
    expect(conferirCapa('image/jpeg', 6 * MB)).toEqual({ ok: false, motivo: 'grande_demais' });
  });
});

describe('os caminhos no balde', () => {
  it('o arquivo da mensagem mora na pasta do grupo', () => {
    expect(caminhoNoGrupo(GRUPO, 'pdf', 'abc')).toBe(`grupos/${GRUPO}/abc.pdf`);
    expect(caminhoNoGrupo(GRUPO, 'jpg')).toMatch(
      new RegExp(`^grupos/${GRUPO}/[0-9a-f-]{36}\\.jpg$`),
    );
  });

  it('a capa do grupo e a foto do perfil', () => {
    expect(caminhoDaCapaDoGrupo(GRUPO)).toBe(`grupos/${GRUPO}/foto.jpg`);
    expect(caminhoDaFotoDoPerfil('jpg', 'x')).toBe('perfil/x.jpg');
  });

  it('ehUuid separa id de texto qualquer', () => {
    expect(ehUuid(GRUPO)).toBe(true);
    expect(ehUuid('../outro')).toBe(false);
    expect(ehUuid(null)).toBe(false);
  });
});

describe('recorteQuadrado', () => {
  it('corta o meio da imagem deitada e reduz para 640', () => {
    expect(recorteQuadrado(1920, 1080)).toEqual({ x: 420, y: 0, lado: 1080, saida: 640 });
  });

  it('a imagem em pé corta em cima e embaixo', () => {
    expect(recorteQuadrado(300, 500)).toEqual({ x: 0, y: 100, lado: 300, saida: 300 });
  });

  it('abaixo de 192 não serve de capa', () => {
    expect(recorteQuadrado(191, 800)).toBeNull();
  });
});

describe('fraseDoArquivo', () => {
  it('cada recusa tem uma frase, e o desconhecido cai na genérica', () => {
    expect(fraseDoArquivo('video_mov')).toMatch(/MP4/);
    expect(fraseDoArquivo('foto_pequena_demais')).toMatch(/192/);
    expect(fraseDoArquivo('qualquer_coisa')).toMatch(/Tente de novo/);
  });
});
