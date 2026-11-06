import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { LADO_MAXIMO, formatoDaFoto, fotoEmJpeg } from './foto-em-jpeg';

const TETO = 7 * 1024 * 1024;

function imagem(largura: number, altura: number, transparente = false) {
  return sharp({
    create: {
      width: largura,
      height: altura,
      channels: transparente ? 4 : 3,
      background: transparente ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 40, g: 120, b: 200 },
    },
  });
}

describe('formatoDaFoto', () => {
  it('reconhece JPEG, PNG e WebP pelos primeiros bytes', async () => {
    expect(formatoDaFoto(await imagem(4, 4).jpeg().toBuffer())).toBe('jpeg');
    expect(formatoDaFoto(await imagem(4, 4).png().toBuffer())).toBe('png');
    expect(formatoDaFoto(await imagem(4, 4).webp().toBuffer())).toBe('webp');
  });

  it('recusa o resto, mesmo com nome de imagem', async () => {
    expect(formatoDaFoto(Buffer.from('<html>Entrar</html>'))).toBeNull();
    expect(formatoDaFoto(await imagem(4, 4).gif().toBuffer())).toBeNull();
    expect(formatoDaFoto(Buffer.from('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
    expect(formatoDaFoto(new Uint8Array())).toBeNull();
  });
});

describe('fotoEmJpeg', () => {
  it('converte o WebP do sistema atual em JPEG do mesmo tamanho', async () => {
    const r = await fotoEmJpeg(await imagem(800, 600).webp().toBuffer(), TETO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(formatoDaFoto(r.jpeg)).toBe('jpeg');
    const m = await sharp(r.jpeg).metadata();
    expect([m.format, m.width, m.height]).toEqual(['jpeg', 800, 600]);
  });

  it('reduz o maior lado para 2.560 px sem deformar', async () => {
    const r = await fotoEmJpeg(await imagem(5120, 2000).png().toBuffer(), TETO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = await sharp(r.jpeg).metadata();
    expect([m.width, m.height]).toEqual([LADO_MAXIMO, 1000]);
  });

  it('põe de pé a foto que a câmera gravou deitada e tira os metadados', async () => {
    // Orientação 6: a câmera gravou 400×300 e a foto deve aparecer 300×400.
    const deitada = await imagem(400, 300)
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Make: 'Camera de teste' } } })
      .toBuffer();
    expect((await sharp(deitada).metadata()).exif).toBeDefined();
    const r = await fotoEmJpeg(deitada, TETO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = await sharp(r.jpeg).metadata();
    expect([m.width, m.height]).toEqual([300, 400]);
    expect(m.exif).toBeUndefined();
    expect(m.orientation).toBeUndefined();
  });

  it('o transparente vira branco, não preto', async () => {
    const r = await fotoEmJpeg(await imagem(10, 10, true).png().toBuffer(), TETO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { data } = await sharp(r.jpeg).raw().toBuffer({ resolveWithObject: true });
    expect(Math.min(...data)).toBeGreaterThan(245);
  });

  it('recusa o que não é foto, a foto quebrada e a que passa do teto', async () => {
    expect(await fotoEmJpeg(Buffer.from('<html>Entrar</html>'), TETO)).toEqual({
      ok: false,
      motivo: 'formato_nao_aceito',
    });
    const cortada = (await imagem(200, 200).png().toBuffer()).subarray(0, 60);
    expect(await fotoEmJpeg(cortada, TETO)).toEqual({ ok: false, motivo: 'foto_quebrada' });
    expect(await fotoEmJpeg(await imagem(300, 300).webp().toBuffer(), 100)).toEqual({
      ok: false,
      motivo: 'grande_demais',
    });
  });

  it('não abre a foto com pontos demais (um PNG pequeno pode pedir gigabytes)', async () => {
    // 10.000 × 6.000 = 60 milhões de pontos, num PNG de poucos KB.
    const enorme = await imagem(10_000, 6_000).png({ compressionLevel: 9 }).toBuffer();
    expect(enorme.length).toBeLessThan(TETO);
    expect(await fotoEmJpeg(enorme, TETO)).toEqual({ ok: false, motivo: 'grande_demais' });
  });
});
