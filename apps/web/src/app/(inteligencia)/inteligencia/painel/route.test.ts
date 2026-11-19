import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as PaginaProntaReal from '../pagina-pronta';

/**
 * A rota que entrega a página pronta da Inteligência de mercado (revisão de
 * 18/11/2026). Roda o `GET` de verdade, com a empresa, o Supabase, a conferência do
 * banco e o arquivo trocados por dublês.
 */

const estado = vi.hoisted(() => ({
  empresa: 'imova' as 'komune' | 'imova',
  claims: null as Record<string, unknown> | null,
  perfil: null as { role: string; is_active: boolean } | null,
  erroDoPerfil: null as { message: string } | null,
  empresaDoBanco: { ok: true } as { ok: true } | { ok: false; empresaDoBanco: string },
  arquivo: '',
  perguntouOPerfilDe: null as unknown,
}));

vi.mock('@/lib/empresa', async () => {
  const { EMPRESAS } = await import('@komune/schema/empresas');
  return {
    get EMPRESA() {
      return EMPRESAS[estado.empresa];
    },
  };
});

vi.mock('@/lib/env', () => ({
  supabaseUrl: () => 'http://127.0.0.1:54321',
  supabaseAnonKey: () => 'chave-anonima-de-teste',
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: estado.claims ? { claims: estado.claims } : null,
        error: null,
      }),
    },
    from: (tabela: string) => {
      expect(tabela).toBe('profiles');
      const consulta = {
        select: () => consulta,
        eq: (_coluna: string, valor: unknown) => {
          estado.perguntouOPerfilDe = valor;
          return consulta;
        },
        maybeSingle: async () => ({ data: estado.perfil, error: estado.erroDoPerfil }),
      };
      return consulta;
    },
  }),
}));

vi.mock('@/lib/conferir-empresa', () => ({
  conferirEmpresaDoBanco: async () => estado.empresaDoBanco,
}));

vi.mock('../pagina-pronta', async (original) => {
  const real = await original<typeof PaginaProntaReal>();
  return { ...real, lerPaginaPronta: () => real.lerPaginaPronta(estado.arquivo) };
});

const { GET } = await import('./route');

const BASE = 'https://imova.exemplo.com.br';
const PAGINA =
  '<!doctype html><html><head><title>Inteligência</title></head><body>dados</body></html>';
let pasta = '';

function pedir(cabecalhos: Record<string, string> = {}) {
  return GET(new NextRequest(new URL('/inteligencia/painel', BASE), { headers: cabecalhos }));
}

function comPapel(
  papel: string | null,
  perfil: { role: string; is_active: boolean } | null = null,
) {
  estado.claims = papel === null ? null : { sub: 'u1', app_metadata: { app_role: papel } };
  estado.perfil = perfil ?? (papel === null ? null : { role: papel, is_active: true });
}

function destino(resposta: Response): string | null {
  const local = resposta.headers.get('location');
  if (!local) return null;
  const url = new URL(local, BASE);
  return `${url.pathname}${url.search}`;
}

beforeAll(() => {
  pasta = mkdtempSync(join(tmpdir(), 'inteligencia-rota-'));
});

afterAll(() => {
  rmSync(pasta, { recursive: true, force: true });
});

beforeEach(() => {
  estado.empresa = 'imova';
  estado.erroDoPerfil = null;
  estado.empresaDoBanco = { ok: true };
  estado.perguntouOPerfilDe = null;
  estado.arquivo = join(pasta, 'painel.html.gz');
  writeFileSync(estado.arquivo, gzipSync(PAGINA));
  comPapel('sdr');
});

describe('GET /inteligencia/painel: quem recebe a página', () => {
  it('na KOMUNE não existe, com ou sem login', async () => {
    estado.empresa = 'komune';
    for (const papel of [null, 'admin']) {
      comPapel(papel);
      const resposta = await pedir();
      expect(resposta.status).toBe(404);
      expect(resposta.headers.get('content-encoding')).toBeNull();
      expect(await resposta.text()).not.toContain('dados');
    }
  });

  it('sem login vai para o login, voltando para /inteligencia', async () => {
    comPapel(null);
    const resposta = await pedir();
    expect(destino(resposta)).toBe('/login?next=%2Finteligencia');
  });

  it('papel de fora no token vai para /sem-permissao, sem perguntar ao banco', async () => {
    comPapel('leitura');
    expect(destino(await pedir())).toBe('/sem-permissao');
    expect(estado.perguntouOPerfilDe).toBeNull();
  });

  it('o perfil no banco manda: rebaixado ou desligado perde o acesso antes de o token vencer', async () => {
    for (const perfil of [
      { role: 'leitura', is_active: true },
      { role: 'sdr', is_active: false },
      null,
    ]) {
      comPapel('sdr', perfil);
      estado.perfil = perfil;
      const resposta = await pedir();
      expect(destino(resposta)).toBe('/sem-permissao');
      expect(estado.perguntouOPerfilDe).toBe('u1');
    }
  });

  it('se o banco não responde, não entrega (503), em vez de deixar passar', async () => {
    estado.erroDoPerfil = { message: 'tempo esgotado' };
    const resposta = await pedir();
    expect(resposta.status).toBe(503);
    expect(resposta.headers.get('content-encoding')).toBeNull();
  });

  it('banco de outra empresa: não entrega (503)', async () => {
    estado.empresaDoBanco = { ok: false, empresaDoBanco: 'komune' };
    const resposta = await pedir();
    expect(resposta.status).toBe(503);
    expect(await resposta.text()).toContain('outra empresa (komune)');
  });

  it('sem a página copiada, diz "ainda sem página" (não um 404 sem explicação)', async () => {
    estado.arquivo = join(pasta, 'nao-existe.html.gz');
    const resposta = await pedir();
    expect(resposta.status).toBe(404);
    const texto = await resposta.text();
    expect(texto).toContain('ainda não tem página');
    expect(texto).toContain('href="/meu-dia"');
    expect(texto).not.toMatch(/<script/i);
    expect(resposta.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('arquivo que não está em gzip não é entregue', async () => {
    writeFileSync(estado.arquivo, PAGINA);
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resposta = await pedir();
    expect(resposta.status).toBe(404);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});

describe('GET /inteligencia/painel: como a página vai', () => {
  it('admin, gestor e SDR recebem a página em gzip, como está no disco', async () => {
    for (const papel of ['admin', 'gestor', 'sdr']) {
      comPapel(papel);
      const resposta = await pedir();
      expect(resposta.status).toBe(200);
      expect(resposta.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(resposta.headers.get('content-encoding')).toBe('gzip');
      const corpo = Buffer.from(await resposta.arrayBuffer());
      expect(gunzipSync(corpo).toString('utf8')).toBe(PAGINA);
    }
  });

  it('em sandbox, sem cache compartilhado, fora dos buscadores e de outros sites', async () => {
    const resposta = await pedir();
    const politica = resposta.headers.get('content-security-policy') ?? '';
    expect(politica).toMatch(/^sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox;/);
    expect(politica).not.toContain('allow-same-origin');
    expect(politica).toContain("connect-src 'none'");
    expect(politica).toContain("frame-ancestors 'none'");
    expect(resposta.headers.get('cache-control')).toBe('private, no-cache');
    expect(resposta.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(resposta.headers.get('x-content-type-options')).toBe('nosniff');
    expect(resposta.headers.get('x-frame-options')).toBe('DENY');
  });

  it('a mesma página de novo: 304 pela etiqueta, sem mandar o corpo', async () => {
    const primeira = await pedir();
    const etag = primeira.headers.get('etag');
    expect(etag).toMatch(/^"[\w-]{27}"$/);
    const segunda = await pedir({ 'if-none-match': `W/"outra", ${etag}` });
    expect(segunda.status).toBe(304);
    expect(segunda.headers.get('content-security-policy')).toContain('sandbox');
    expect(await segunda.text()).toBe('');
  });

  it('página nova no disco: etiqueta nova, e o navegador baixa de novo', async () => {
    const antes = (await pedir()).headers.get('etag') ?? '';
    writeFileSync(estado.arquivo, gzipSync(`${PAGINA}<!-- nova coleta -->`));
    const resposta = await pedir({ 'if-none-match': antes });
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('etag')).not.toBe(antes);
  });
});
