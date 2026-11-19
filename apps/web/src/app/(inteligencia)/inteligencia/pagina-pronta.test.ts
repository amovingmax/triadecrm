import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { PAGINA_PRONTA_DA_INTELIGENCIA, ROTA_INICIAL } from '@/lib/supabase/middleware';

import {
  BIBLIOTECAS_CONHECIDAS,
  CAMINHO_DA_PAGINA_PRONTA_NO_SITE,
  CHAVE_DO_TEMA_DO_CRM,
  mencoesLiberadas,
  problemasDaPagina,
  problemasDeIntegridade,
  rastrosDePortais,
  ROTA_INICIAL_DO_CRM,
} from '../../../../../../scripts/inteligencia/adaptar.mjs';

import { CHAVE_DO_TEMA, enderecoComTema } from './abrir-pagina-pronta';
import { ORIGENS_DE_SCRIPT, POLITICA_DA_PAGINA_PRONTA } from './cabecalhos';
import { CAMINHO_DA_PAGINA_PRONTA } from './pagina-pronta';

/**
 * A página pronta da Inteligência de mercado (18/11/2026; revisão do mesmo dia): o
 * script `scripts/inteligencia/copiar-prototipo.mjs` grava, em gzip e fora do git,
 * `apps/web/privado/inteligencia/painel.html.gz`, e a rota `/inteligencia/painel` a
 * entrega. Estes testes conferem que o script e o site combinam e, quando o arquivo
 * existe, o ARQUIVO que vai ao ar.
 *
 * Na CI o arquivo não existe (não vai para o git) e o bloco da página aparece como
 * pulado, com o motivo no nome. No deploy da Imova, rode com
 * `INTELIGENCIA_EXIGIR_PAGINA=1`: aí a falta do arquivo é falha, não pulo.
 */

const SITE = fileURLToPath(new URL('../../../../', import.meta.url));
const RAIZ = join(SITE, '..', '..');
const ARQUIVO = join(SITE, CAMINHO_DA_PAGINA_PRONTA);
const EXIGIR = process.env.INTELIGENCIA_EXIGIR_PAGINA === '1';

const diretiva = (nome: string) =>
  POLITICA_DA_PAGINA_PRONTA.split(';')
    .map((d) => d.trim())
    .find((d) => d.split(/\s+/)[0] === nome) ?? '';

describe('o script de cópia e o CRM falam a mesma língua', () => {
  it('o "Voltar ao CRM" vai para a tela inicial de verdade', () => {
    expect(ROTA_INICIAL_DO_CRM).toBe(ROTA_INICIAL);
  });

  it('a página segue a chave do tema que o CRM grava', () => {
    const provedor = readFileSync(
      fileURLToPath(new URL('../../../components/tema/provedor-tema.tsx', import.meta.url)),
      'utf8',
    );
    expect(provedor).toContain(`storageKey="${CHAVE_DO_TEMA_DO_CRM}"`);
    expect(CHAVE_DO_TEMA).toBe(CHAVE_DO_TEMA_DO_CRM);
  });

  it('o script grava onde a rota lê, e o build leva o arquivo junto com a rota', async () => {
    expect(CAMINHO_DA_PAGINA_PRONTA_NO_SITE).toBe(CAMINHO_DA_PAGINA_PRONTA);
    const { default: config } = await import('../../../../next.config');
    expect(config.outputFileTracingIncludes?.[PAGINA_PRONTA_DA_INTELIGENCIA]).toContain(
      `./${CAMINHO_DA_PAGINA_PRONTA}`,
    );
  });

  it('o arquivo não vai para o git: a pasta privado/ ignora tudo, menos o próprio .gitignore', () => {
    expect(CAMINHO_DA_PAGINA_PRONTA.startsWith('privado/')).toBe(true);
    const linhas = readFileSync(join(SITE, 'privado', '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(linhas).toEqual(['*', '!.gitignore']);
  });

  it('cada biblioteca com hash no script vem de uma origem que a política da rota deixa', () => {
    for (const endereco of Object.keys(BIBLIOTECAS_CONHECIDAS)) {
      const origem = new URL(endereco).origin;
      if (endereco.endsWith('.css')) expect(diretiva('style-src')).toContain(origem);
      else {
        expect(ORIGENS_DE_SCRIPT).toContain(origem);
        expect(diretiva('script-src')).toContain(origem);
      }
    }
  });
});

describe('a política da página pronta', () => {
  it('é sandbox sem allow-same-origin: a página não lê cookie nem localStorage do CRM', () => {
    const sandbox = diretiva('sandbox').split(/\s+/);
    expect(sandbox).toEqual([
      'sandbox',
      'allow-scripts',
      'allow-popups',
      'allow-popups-to-escape-sandbox',
    ]);
    expect(POLITICA_DA_PAGINA_PRONTA).not.toContain('allow-same-origin');
  });

  it('não busca nada, não vai dentro de outro site e só carrega script das CDNs da lista', () => {
    expect(diretiva('default-src')).toBe("default-src 'none'");
    expect(diretiva('connect-src')).toBe("connect-src 'none'");
    expect(diretiva('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(diretiva('base-uri')).toBe("base-uri 'none'");
    expect(diretiva('script-src')).toBe(
      `script-src 'unsafe-inline' ${ORIGENS_DE_SCRIPT.join(' ')}`,
    );
    expect(POLITICA_DA_PAGINA_PRONTA).not.toContain('unsafe-eval');
  });

  it('o fundo do mapa (OpenStreetMap) pode carregar', () => {
    expect(diretiva('img-src')).toContain('https://tile.openstreetmap.org');
  });
});

describe('enderecoComTema (a casca leva o tema do CRM para a página em sandbox)', () => {
  it('claro e escuro vão no endereço, antes do #', () => {
    expect(enderecoComTema('/inteligencia/painel', 'dark', '#mapa')).toBe(
      '/inteligencia/painel?tema=dark#mapa',
    );
    expect(enderecoComTema('/inteligencia/painel', 'light', '')).toBe(
      '/inteligencia/painel?tema=light',
    );
  });

  it('"sistema", nada salvo ou outra coisa não vão', () => {
    for (const tema of ['system', null, '"><script>']) {
      expect(enderecoComTema('/inteligencia/painel', tema, '')).toBe('/inteligencia/painel');
    }
  });
});

describe('nada da Inteligência mora em public/', () => {
  it('a pasta public/inteligencia não existe (o proxy deixa .json, .png, .svg e .txt passarem sem login)', () => {
    expect(existsSync(join(SITE, 'public', 'inteligencia'))).toBe(false);
  });
});

describe('os testes do script de cópia', () => {
  it('passam (node --test scripts/inteligencia/, que não é pacote do workspace)', () => {
    const saida = execFileSync(
      process.execPath,
      ['--test', '--test-reporter=dot', join(RAIZ, 'scripts', 'inteligencia', 'adaptar.test.mjs')],
      { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(saida).not.toMatch(/✖|failed|fail [1-9]/i);
  });
});

describe('a página pronta (o arquivo que vai ao ar)', () => {
  if (!existsSync(ARQUIVO)) {
    if (EXIGIR) {
      it('existe (INTELIGENCIA_EXIGIR_PAGINA=1: o deploy da Imova precisa dela)', () => {
        expect.fail(
          `Falta ${CAMINHO_DA_PAGINA_PRONTA}. Rode scripts/inteligencia/copiar-prototipo.mjs e copie o arquivo para a cópia limpa antes de publicar.`,
        );
      });
    } else {
      it.skip(`sem ${CAMINHO_DA_PAGINA_PRONTA} aqui (normal na CI: não vai para o git). No deploy da Imova: INTELIGENCIA_EXIGIR_PAGINA=1`, () => {});
    }
    return;
  }

  const gz = readFileSync(ARQUIVO);
  const html = gunzipSync(gz).toString('utf8');
  // A marcação da casca, sem o conteúdo dos scripts (o código escreve HTML em texto).
  const casca = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (bloco) =>
    bloco.replace(/>[\s\S]*<\//, '></'),
  );

  it('cabe na resposta de uma função da Vercel (4,5 MB), com folga', () => {
    expect(gz.length).toBeLessThan(4 * 1024 * 1024);
  });

  it('foi montada pelo script: os dados estão dentro do HTML', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toContain('/*__DADOS__*/null');
    expect(html).not.toContain('<!--__JS__-->');
    expect(html).toContain('copiar-prototipo.mjs');
  });

  it('passa nas mesmas conferências do script de cópia, com as bibliotecas presas ao hash', () => {
    expect(problemasDaPagina(html)).toEqual([]);
    expect(problemasDeIntegridade(html)).toEqual([]);
  });

  it('não tem nada dos portais proibidos: nem link, nem dado', () => {
    // Decisão do dono em 18/11/2026. O índice FipeZAP, planilha pública da Fipe, pode.
    expect(rastrosDePortais(html).bloqueios).toEqual([]);
  });

  it('nome de portal em texto, só se quem copiou leu e liberou cada um (e a página registra quantos)', () => {
    expect(rastrosDePortais(html).mencoes).toBe(mencoesLiberadas(html));
  });

  it('a ponte do CRM é o primeiro script e a faixa da data está no alto', () => {
    expect(html.match(/<script\b[^>]*>[\s\S]{0,120}/)?.[0]).toContain('ponte do CRM');
    expect(casca).toMatch(
      /<body\b[^>]*>\s*<div class="crm-faixa-data" role="note">Página atualizada em <b>\d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}<\/b>/,
    );
  });

  it('não busca nada do próprio site: nem script, nem estilo, nem dado em arquivo separado', () => {
    for (const m of casca.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/gi)) {
      expect(m[1]).toMatch(/^https:\/\//);
    }
    for (const m of casca.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']*)["']/gi)) {
      expect(m[1]).toMatch(/^(https:\/\/|data:)/);
    }
    expect(html).not.toMatch(/\bfetch\(\s*["'`](?!https:\/\/)/);
  });

  it('o "Voltar ao CRM" leva à tela inicial do CRM', () => {
    const voltar = casca.match(/<a\b[^>]*\bclass="(?:[^"]*\s)?voltar(?:\s[^"]*)?"[^>]*>/);
    expect(voltar?.[0]).toContain(`href="${ROTA_INICIAL}"`);
    expect(voltar?.[0]).not.toContain('onclick');
  });

  it('fica fora dos buscadores', () => {
    expect(casca).toContain('<meta name="robots" content="noindex, nofollow">');
  });
});
