import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPRESAS } from '@komune/schema/empresas';

/**
 * O porteiro da Inteligência de mercado (18/11/2026). É a primeira camada antes de
 * tudo embaixo de `/inteligencia`; a rota que entrega a página pronta confere de novo
 * no servidor (`app/(inteligencia)/inteligencia/painel/route.test.ts`). Estes testes
 * passam pelo `atualizarSessao` de verdade, com o Supabase e a empresa trocados por
 * dublês.
 */

const estado = vi.hoisted(() => ({
  empresa: 'komune' as 'komune' | 'imova',
  claims: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/empresa', async () => {
  const { EMPRESAS: todas } = await import('@komune/schema/empresas');
  return {
    get EMPRESA() {
      return todas[estado.empresa];
    },
  };
});

vi.mock('@/lib/env', () => ({
  supabaseUrl: () => 'http://127.0.0.1:54321',
  supabaseAnonKey: () => 'chave-anonima-de-teste',
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({
        data: estado.claims ? { claims: estado.claims } : null,
        error: null,
      }),
    },
  }),
}));

const {
  atualizarSessao,
  ehDaInteligencia,
  ehRotaPublica,
  PAGINA_PRONTA_DA_INTELIGENCIA,
  PAPEIS_DA_INTELIGENCIA,
  porteiroDaInteligencia,
  ROTA_DA_INTELIGENCIA,
} = await import('./middleware');
const { config } = await import('@/proxy');

const BASE = 'https://imova.exemplo.com.br';

function comPapel(papel: string | null) {
  estado.claims = papel === null ? null : { sub: 'u1', app_metadata: { app_role: papel } };
}

async function pedir(caminho: string) {
  return atualizarSessao(new NextRequest(new URL(caminho, BASE)));
}

/** Para onde a resposta manda o navegador (redirect), ou null. */
function destino(resposta: Response): string | null {
  const local = resposta.headers.get('location');
  if (!local) return null;
  const url = new URL(local, BASE);
  return `${url.pathname}${url.search}`;
}

/** A rota que o Next desenha por dentro (rewrite), ou null. */
function reescritaPara(resposta: Response): string | null {
  const alvo = resposta.headers.get('x-middleware-rewrite');
  return alvo ? new URL(alvo, BASE).pathname : null;
}

beforeEach(() => {
  estado.empresa = 'komune';
  comPapel(null);
});

describe('porteiroDaInteligencia (a regra, sem Next)', () => {
  it('só cuida de /inteligencia e do que está embaixo dela', () => {
    expect(ehDaInteligencia(ROTA_DA_INTELIGENCIA)).toBe(true);
    expect(ehDaInteligencia(PAGINA_PRONTA_DA_INTELIGENCIA)).toBe(true);
    expect(ehDaInteligencia('/inteligencias')).toBe(false);
    expect(ehDaInteligencia('/meu-dia')).toBe(false);
    expect(porteiroDaInteligencia('/meu-dia', null, EMPRESAS.imova)).toBe('fora');
  });

  it('o endereço escrito de outro jeito também é da Inteligência (codificado, maiúscula, barra dupla)', () => {
    for (const caminho of [
      '/%69nteligencia/painel',
      '/inteligencia%2Fpainel',
      '/%2569nteligencia/painel',
      '/Inteligencia/Painel',
      '/INTELIGENCIA',
      '//inteligencia//painel',
      '/inteligencia/painel.html',
    ]) {
      expect(ehDaInteligencia(caminho), caminho).toBe(true);
      expect(porteiroDaInteligencia(caminho, 'leitura', EMPRESAS.imova), caminho).toBe(
        'sem_permissao',
      );
      expect(porteiroDaInteligencia(caminho, 'admin', EMPRESAS.komune), caminho).toBe(
        'nao_encontrado',
      );
    }
    // Um "%" solto não derruba o porteiro.
    expect(ehDaInteligencia('/inteligencia/%E0%A4%A')).toBe(true);
    expect(ehDaInteligencia('/%E0%A4%A')).toBe(false);
  });

  it('na KOMUNE não existe, com ou sem login', () => {
    for (const papel of [null, 'admin', 'gestor', 'sdr'] as const) {
      expect(porteiroDaInteligencia(ROTA_DA_INTELIGENCIA, papel, EMPRESAS.komune)).toBe(
        'nao_encontrado',
      );
      expect(porteiroDaInteligencia(PAGINA_PRONTA_DA_INTELIGENCIA, papel, EMPRESAS.komune)).toBe(
        'nao_encontrado',
      );
    }
  });

  it('na Imova: sem login vai ao login; admin, gestor e SDR entram; os outros papéis não', () => {
    const imova = EMPRESAS.imova;
    expect(porteiroDaInteligencia(PAGINA_PRONTA_DA_INTELIGENCIA, null, imova)).toBe('login');
    for (const papel of ['admin', 'gestor', 'sdr'] as const) {
      expect(porteiroDaInteligencia(PAGINA_PRONTA_DA_INTELIGENCIA, papel, imova)).toBe('entra');
    }
    for (const papel of ['leitura', 'embaixador', 'financeiro', 'bot'] as const) {
      expect(porteiroDaInteligencia(PAGINA_PRONTA_DA_INTELIGENCIA, papel, imova)).toBe(
        'sem_permissao',
      );
    }
  });

  it('nada da Inteligência é rota pública', () => {
    for (const empresa of [EMPRESAS.komune, EMPRESAS.imova]) {
      expect(ehRotaPublica(ROTA_DA_INTELIGENCIA, empresa)).toBe(false);
      expect(ehRotaPublica(PAGINA_PRONTA_DA_INTELIGENCIA, empresa)).toBe(false);
    }
  });

  it('o papel do porteiro é o mesmo do menu', async () => {
    const { NAVEGACAO } = await import('@/lib/navegacao');
    const item = NAVEGACAO.find((i) => i.href === ROTA_DA_INTELIGENCIA);
    expect(item?.papeis).toEqual(PAPEIS_DA_INTELIGENCIA);
  });
});

describe('o proxy roda antes da página pronta', () => {
  // O `matcher` deixa passar sem proxy (e, portanto, sem login) as extensões da
  // lista. Por isso nada da Inteligência mora em public/.
  const casa = (caminho: string) =>
    config.matcher.some((padrao) => new RegExp(`^${padrao}$`).test(caminho));

  it('pega /inteligencia e a rota da página pronta', () => {
    expect(casa(ROTA_DA_INTELIGENCIA)).toBe(true);
    expect(casa(PAGINA_PRONTA_DA_INTELIGENCIA)).toBe(true);
    expect(casa('/inteligencia/painel.html')).toBe(true);
  });

  it('e não pega um .json (é por isso que nada da Inteligência pode ir para public/)', () => {
    expect(casa('/inteligencia/dados.json')).toBe(false);
  });
});

describe('atualizarSessao em /inteligencia', () => {
  it('KOMUNE: a rota da página pronta não roda; vai para /inteligencia, que diz "não encontrado"', async () => {
    for (const papel of [null, 'admin']) {
      comPapel(papel);
      const resposta = await pedir(PAGINA_PRONTA_DA_INTELIGENCIA);
      expect(reescritaPara(resposta)).toBe(ROTA_DA_INTELIGENCIA);
      expect(destino(resposta)).toBeNull();
    }
  });

  it('KOMUNE: /inteligencia segue para a página, que responde 404 (`notFound()`), mesmo sem login', async () => {
    const resposta = await pedir(ROTA_DA_INTELIGENCIA);
    expect(destino(resposta)).toBeNull();
    expect(reescritaPara(resposta)).toBeNull();
  });

  it('Imova sem login: vai para o login, e volta para onde ia', async () => {
    estado.empresa = 'imova';
    expect(destino(await pedir(PAGINA_PRONTA_DA_INTELIGENCIA))).toBe(
      `/login?next=${encodeURIComponent(PAGINA_PRONTA_DA_INTELIGENCIA)}`,
    );
    expect(destino(await pedir(ROTA_DA_INTELIGENCIA))).toBe(
      `/login?next=${encodeURIComponent(ROTA_DA_INTELIGENCIA)}`,
    );
  });

  it('Imova com papel de fora: /sem-permissao', async () => {
    estado.empresa = 'imova';
    comPapel('leitura');
    expect(destino(await pedir(PAGINA_PRONTA_DA_INTELIGENCIA))).toBe('/sem-permissao');
    expect(destino(await pedir('/%69nteligencia/painel'))).toBe('/sem-permissao');
  });

  it('KOMUNE, com login: o endereço codificado também não chega à rota', async () => {
    comPapel('admin');
    const resposta = await pedir('/%69nteligencia/painel');
    expect(reescritaPara(resposta)).toBe(ROTA_DA_INTELIGENCIA);
  });

  it('Imova, SDR: segue para a rota, que confere o perfil e põe os cabeçalhos (sandbox, cache)', async () => {
    estado.empresa = 'imova';
    comPapel('sdr');
    const resposta = await pedir(PAGINA_PRONTA_DA_INTELIGENCIA);
    expect(destino(resposta)).toBeNull();
    expect(reescritaPara(resposta)).toBeNull();
    // Os cabeçalhos da página saem da rota, não do proxy (route.test.ts).
    expect(resposta.headers.get('content-security-policy')).toBeNull();
  });

  it('o resto do CRM continua igual: sem login vai ao login, com login passa', async () => {
    estado.empresa = 'imova';
    expect(destino(await pedir('/meu-dia'))).toBe('/login?next=%2Fmeu-dia');
    comPapel('leitura');
    const resposta = await pedir('/meu-dia');
    expect(destino(resposta)).toBeNull();
    expect(resposta.headers.get('x-robots-tag')).toBeNull();
  });
});
