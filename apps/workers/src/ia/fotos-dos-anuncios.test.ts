import { describe, expect, it } from 'vitest';

import {
  LIMIAR_DA_IMPRESSAO,
  MARGEM_ENTRE_ANUNCIOS,
  type FotoReconhecida,
  type Referencia,
  aplicarReconhecimentos,
  carregarSharp,
  distancia,
  fotosDoPainel,
  impressaoDaImagem,
  impressaoDecide,
  impressoesDaFotoDoCliente,
  maisParecida,
  montarPainel,
  resumoDoImovel,
  textoDaFoto,
} from './fotos-dos-anuncios';

/**
 * A FOTO DO CLIENTE RECONHECIDA (Imova, 09/11/2026), SEM REDE E SEM MODELO.
 *
 * A medição com as 66 fotos de verdade (no banco local) está no CHANGELOG; aqui ficam
 * as regras: a mesma foto recomprimida e com moldura continua perto, fotos diferentes
 * ficam longe, a impressão só decide com folga entre anúncios, e o texto que entra na
 * conversa da IA que atende.
 */

const ref = (codigo: string, impressao: string | null, extra: Partial<Referencia> = {}): Referencia => ({
  id: `${codigo}-${impressao ?? 'x'}-${extra.posicao ?? 0}-${extra.origem ?? 'anuncio'}`,
  codigo,
  origem: 'anuncio',
  balde: 'anuncios',
  caminho: `${codigo}/foto.jpg`,
  posicao: 0,
  impressao,
  ...extra,
});

/** Uma "foto" sintética: faixas e formas, para o dHash ter o que medir. */
async function foto(variante: 'casa' | 'terreno', largura = 1200, altura = 900): Promise<Uint8Array> {
  const sharp = (await carregarSharp())!;
  const svg =
    variante === 'casa'
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}"><rect width="100%" height="45%" fill="#7fb6e0"/><rect y="45%" width="100%" height="55%" fill="#e3c34a"/><rect x="20%" y="30%" width="35%" height="40%" fill="#ffffff"/><rect x="65%" y="20%" width="10%" height="60%" fill="#2e5e2e"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}"><rect width="100%" height="100%" fill="#b59a6a"/><rect width="100%" height="30%" fill="#9fd0f0"/><circle cx="15%" cy="40%" r="12%" fill="#2e6b35"/><rect x="60%" y="55%" width="30%" height="10%" fill="#555555"/></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer());
}

describe('a impressão digital (dHash)', () => {
  it('a distância conta os bits diferentes', () => {
    expect(distancia('0000000000000000', '0000000000000000')).toBe(0);
    expect(distancia('0000000000000000', '0000000000000003')).toBe(2);
    expect(distancia('ffffffffffffffff', '0000000000000000')).toBe(64);
  });

  it('é estável, e a mesma foto recomprimida como no WhatsApp fica perto', async () => {
    const sharp = (await carregarSharp())!;
    const original = await foto('casa');
    const a = await impressaoDaImagem(sharp, original);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await impressaoDaImagem(sharp, original)).toBe(a);
    const whatsapp = new Uint8Array(
      await sharp(original).resize(640).jpeg({ quality: 45 }).toBuffer(),
    );
    expect(distancia(a, await impressaoDaImagem(sharp, whatsapp))).toBeLessThanOrEqual(LIMIAR_DA_IMPRESSAO);
  });

  it('o print com moldura branca é achado pela imagem sem a moldura', async () => {
    const sharp = (await carregarSharp())!;
    const original = await foto('casa');
    const a = await impressaoDaImagem(sharp, original);
    const print = new Uint8Array(
      await sharp(original)
        .resize(900)
        .extend({ top: 300, bottom: 500, left: 0, right: 0, background: '#ffffff' })
        .jpeg({ quality: 70 })
        .toBuffer(),
    );
    const impressoes = await impressoesDaFotoDoCliente(sharp, print);
    expect(impressoes.length).toBe(2);
    expect(Math.min(...impressoes.map((h) => distancia(a, h)))).toBeLessThanOrEqual(LIMIAR_DA_IMPRESSAO);
  });

  it('fotos diferentes ficam longe', async () => {
    const sharp = (await carregarSharp())!;
    const casa = await impressaoDaImagem(sharp, await foto('casa'));
    const terreno = await impressaoDaImagem(sharp, await foto('terreno'));
    expect(distancia(casa, terreno)).toBeGreaterThan(LIMIAR_DA_IMPRESSAO);
  });
});

describe('quando a impressão decide sozinha', () => {
  it('perto de um anúncio e longe dos outros: decide', () => {
    const p = maisParecida(['0000000000000000'], [
      ref('PT0001_IMOVA', '0000000000000003'),
      ref('TE0002_IMOVA', '00000000000000ff'),
    ]);
    expect(p?.referencia.codigo).toBe('PT0001_IMOVA');
    expect(p?.distancia).toBe(2);
    expect(p?.outroAnuncio).toBe(8);
    expect(impressaoDecide(p!)).toBe(true);
  });

  it('dois anúncios quase empatados (terrenos parecidos): quem decide é o modelo', () => {
    const p = maisParecida(['0000000000000000'], [
      ref('TE0002_IMOVA', '0000000000000007'),
      ref('TE0003_IMOVA', '000000000000001f'),
    ]);
    expect(p?.distancia).toBe(3);
    expect(p!.outroAnuncio - p!.distancia).toBeLessThan(MARGEM_ENTRE_ANUNCIOS);
    expect(impressaoDecide(p!)).toBe(false);
  });

  it('duas fotos do MESMO anúncio não contam como empate', () => {
    const p = maisParecida(['0000000000000000'], [
      ref('TE0002_IMOVA', '0000000000000001', { posicao: 1 }),
      ref('TE0002_IMOVA', '0000000000000001', { posicao: 2 }),
    ]);
    expect(p?.outroAnuncio).toBe(64);
    expect(impressaoDecide(p!)).toBe(true);
  });

  it('longe demais: não decide; foto sem impressão é ignorada', () => {
    const p = maisParecida(['0000000000000000'], [ref('PT0001_IMOVA', '00000000000fffff'), ref('X', null)]);
    expect(p?.distancia).toBe(20);
    expect(impressaoDecide(p!)).toBe(false);
    expect(maisParecida(['0000000000000000'], [ref('X', null)])).toBeNull();
  });
});

describe('o painel de cada anúncio', () => {
  it('leva as fotos do anúncio e as últimas ensinadas, até 12', () => {
    const doAnuncio = Array.from({ length: 15 }, (_, i) => ref('TE0002_IMOVA', null, { posicao: i }));
    const ensinadas = Array.from({ length: 6 }, (_, i) =>
      ref('TE0002_IMOVA', null, { posicao: 1000 + i, origem: 'ensinada', balde: 'mensagens' }),
    );
    const escolhidas = fotosDoPainel([...doAnuncio, ...ensinadas]);
    expect(escolhidas).toHaveLength(12);
    expect(escolhidas.filter((r) => r.origem === 'ensinada').map((r) => r.posicao)).toEqual([1002, 1003, 1004, 1005]);
    expect(escolhidas[0]!.posicao).toBe(0);
  });

  it('monta uma grade JPEG e não cai com foto ilegível', async () => {
    const sharp = (await carregarSharp())!;
    const painel = await montarPainel(sharp, [await foto('casa'), new Uint8Array([1, 2, 3]), await foto('terreno')]);
    expect(painel).not.toBeNull();
    const meta = await sharp(Buffer.from(painel!, 'base64')).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(2 * 320 + 6);
    expect(await montarPainel(sharp, [new Uint8Array([9])])).toBeNull();
  });
});

describe('o texto que entra na conversa da IA que atende', () => {
  const r = (campos: Partial<FotoReconhecida>): FotoReconhecida => ({
    message_id: 'm-1',
    codigo: null,
    metodo: 'nao_reconheceu',
    certeza: null,
    descricao: null,
    ...campos,
  });

  it('um rótulo para cada jeito de reconhecer', () => {
    expect(textoDaFoto(r({ metodo: 'impressao', codigo: 'PT0001_IMOVA', certeza: 'alta' }))).toBe(
      '[foto do anúncio PT0001_IMOVA (reconhecida pela imagem)]',
    );
    expect(textoDaFoto(r({ metodo: 'ensinada', codigo: 'TE0003_IMOVA', certeza: 'alta' }))).toContain(
      'foto do anúncio TE0003_IMOVA',
    );
    expect(textoDaFoto(r({ metodo: 'visao', codigo: 'TE0002_IMOVA', certeza: 'media', descricao: 'terreno de esquina' }))).toBe(
      '[foto: parece o anúncio TE0002_IMOVA (certeza média) — terreno de esquina]',
    );
    expect(textoDaFoto(r({ metodo: 'visao', codigo: 'TE0002_IMOVA', certeza: 'baixa' }))).toContain('talvez');
    expect(textoDaFoto(r({ descricao: 'sala com sofá' }))).toBe('[foto: não bate com nenhum anúncio — sala com sofá]');
    expect(textoDaFoto(r({ metodo: 'indisponivel' }))).toBe('[foto: não deu para abrir a imagem]');
  });

  it('troca só o "[foto]" das mensagens reconhecidas e mantém a legenda', () => {
    const mensagens = [
      { id: 'm-1', texto: '[foto] Gostaria de saber mais sobre esse imóvel' },
      { id: 'm-2', texto: '[foto]' },
      { id: 'm-3', texto: 'Oi' },
    ];
    const mapa = new Map([['m-1', r({ metodo: 'impressao', codigo: 'PT0001_IMOVA', certeza: 'alta' })]]);
    const trocadas = aplicarReconhecimentos(mensagens, mapa);
    expect(trocadas[0]!.texto).toBe(
      '[foto do anúncio PT0001_IMOVA (reconhecida pela imagem)] Gostaria de saber mais sobre esse imóvel',
    );
    expect(trocadas[1]!.texto).toBe('[foto]');
    expect(trocadas[2]!.texto).toBe('Oi');
  });

  it('o resumo do imóvel para o modelo da foto não leva telefone', () => {
    expect(
      resumoDoImovel({
        codigo: 'TE0002_IMOVA',
        tipo: 'terreno',
        negocio: 'venda',
        bairro: 'Rosa dos Ventos',
        cidade: 'Parnamirim',
        titulo: 'Terreno de esquina, ligue 84 99988-0011',
      }),
    ).toBe('terreno · venda · Rosa dos Ventos, Parnamirim · Terreno de esquina, ligue (telefone)');
  });
});
