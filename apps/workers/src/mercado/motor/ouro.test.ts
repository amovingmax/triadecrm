/**
 * TESTE DE OURO do motor das vantagens: com a base que o motor do protótipo
 * recebe (`ouro/base.json.gz`, exportada por
 * `scripts/inteligencia/exportar-ouro-do-motor.mjs` a partir de
 * `js/55-argumentos.js`), o motor em TypeScript tem de devolver o MESMO dossiê
 * (`ouro/vantagens.json.gz`): ids, números, textos-base, "Não diga",
 * bloqueios e tudo o mais, imóvel por imóvel.
 *
 * A base do arquivo vai sem o link e sem a coordenada de cada anúncio (nenhuma
 * conta usa); o dossiê do protótipo foi tirado com eles. Ser igual prova que o
 * motor não depende deles.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { rodarMotor } from './motor';
import { REGRAS_DO_PROTOTIPO } from './regras-do-dono';
import type { BaseDoMotor, Dossie } from './tipos';
import { checarFrase, montarVantagens } from './vantagens';

const ler = <T>(nome: string): T =>
  JSON.parse(gunzipSync(readFileSync(new URL(`./ouro/${nome}`, import.meta.url))).toString()) as T;

const BASE = ler<BaseDoMotor>('base.json.gz');
const OURO = ler<Dossie>('vantagens.json.gz');
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
// O porte fiel roda com as regras do protótipo (15%, sem valorização, sem perfis); a rodada
// de verdade usa as do dono (27/11/2026: 8%, valorização com sinal, para quem serve).
const rodar = () =>
  montarVantagens(BASE, rodarMotor(BASE, { regras: REGRAS_DO_PROTOTIPO }), { regras: REGRAS_DO_PROTOTIPO });
const NOSSO = json(rodar());

describe('motor das vantagens: teste de ouro contra o protótipo (js/55-argumentos.js)', () => {
  it('a base é a do protótipo (2.757 anúncios limpos, 19 unidades da carteira)', () => {
    expect(BASE.anuncios).toHaveLength(2757);
    expect(BASE.ims).toHaveLength(19);
    expect(BASE.anuncios.every((a) => !('url' in a))).toBe(true);
  });

  it('os mesmos imóveis, na mesma ordem', () => {
    expect(NOSSO.imoveis.map((i) => i.ref)).toEqual(OURO.imoveis.map((i) => i.ref));
  });

  it.each(OURO.imoveis.map((i) => [i.ref, i] as const))(
    '%s: as mesmas vantagens (ids, força, números, textos-base) e o mesmo "Não diga"',
    (ref, ouro) => {
      const nosso = NOSSO.imoveis.find((i) => i.ref === ref)!;
      expect(nosso.vantagens.map((v) => v.id)).toEqual(ouro.vantagens.map((v) => v.id));
      expect(
        nosso.vantagens.map((v) => [v.id, v.forca, v.status, v.numeros_obrigatorios, v.texto_base]),
      ).toEqual(
        ouro.vantagens.map((v) => [v.id, v.forca, v.status, v.numeros_obrigatorios, v.texto_base]),
      );
      expect(nosso.nao_diga).toEqual(ouro.nao_diga);
      expect(nosso.propostas).toEqual(ouro.propostas);
      expect(nosso.bloqueadas).toEqual(ouro.bloqueadas);
      // E o resto do dossiê do imóvel, campo por campo (prova, rigor, validade, gatilhos...).
      expect(nosso).toEqual(ouro);
    },
  );

  it('o dossiê inteiro é igual (rodada e base de anúncios)', () => {
    expect(NOSSO).toEqual(OURO);
  });

  it('toda frase do dossiê passa nas regras de frase', () => {
    const erros = NOSSO.imoveis.flatMap((i) =>
      i.vantagens.flatMap((v) => checarFrase(v).map((m) => `${i.ref} ${v.id}: ${m}`)),
    );
    expect(erros).toEqual([]);
  });

  it('determinístico: rodar de novo dá o mesmo dossiê', () => {
    expect(json(rodar())).toEqual(NOSSO);
  });
});
