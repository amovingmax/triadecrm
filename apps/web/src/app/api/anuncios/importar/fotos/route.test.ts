/**
 * A trava da troca na rota que traz fotos de fora (19/11/2026): depois que o robô
 * do Grupo OLX leu o arquivo do CRM, o anúncio NO AR não recebe fotos do favorito
 * nem do sistema atual, em modo nenhum. Antes da troca, e no rascunho, nada muda.
 *
 * O banco, a sessão e a busca são de mentira: aqui só se confere a decisão da
 * rota, antes de baixar qualquer foto.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const estado = vi.hoisted(() => ({
  situacao: 'no_ar' as 'no_ar' | 'rascunho',
  leiturasDoRobo: 0,
  fotos: 3,
}));
const buscarDeFora = vi.hoisted(() => vi.fn(async () => ({ ok: false, motivo: 'status_404' })));
const rpc = vi.hoisted(() => vi.fn(async () => ({ data: { ok: true }, error: null })));

/** Uma consulta encadeável do supabase-js: cada passo devolve ela mesma, e o fim é o resultado. */
function consulta(resultado: () => unknown) {
  const q: Record<string, unknown> = {};
  for (const passo of ['select', 'eq', 'order', 'is']) q[passo] = () => q;
  q.maybeSingle = async () => resultado();
  q.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
    Promise.resolve(resultado()).then(ok, erro);
  return q;
}

vi.mock('@/lib/empresa', () => ({ EMPRESA: { modulos: { anuncios: true } } }));
vi.mock('@/lib/auth/session', () => ({ getSession: async () => ({ papel: 'gestor' }) }));
vi.mock('@/lib/registro-do-servidor', () => ({
  registrarAviso: vi.fn(),
  registrarRecusa: vi.fn(),
}));
vi.mock('@/lib/supabase/servidor-admin', () => ({
  temChaveDeServico: () => true,
  criarClienteAdmin: () => ({ storage: { from: () => ({ upload: vi.fn(), remove: vi.fn() }) } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    rpc,
    from: (tabela: string) => {
      if (tabela === 'anuncios') {
        return consulta(() => ({
          data: { id: ANUNCIO, excluido_em: null, situacao: estado.situacao },
          error: null,
        }));
      }
      if (tabela === 'canal_pro_leituras') {
        return consulta(() => ({ count: estado.leiturasDoRobo, error: null }));
      }
      if (tabela === 'anuncio_fotos') {
        return consulta(() => ({
          count: estado.fotos,
          data: Array.from({ length: estado.fotos }, (_, i) => ({ id: `f${i}` })),
          error: null,
        }));
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  }),
}));
vi.mock('../buscar-de-fora', () => ({ buscarDeFora }));

const ANUNCIO = '0e7f5b1c-1111-4222-8333-444455556666';

async function pedir(modo: 'se_vazio' | 'juntar' | 'trocar') {
  const { POST } = await import('./route');
  const r = await POST(
    new Request('http://localhost/api/anuncios/importar/fotos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anuncio_id: ANUNCIO,
        urls: ['https://exemplo.com/1.jpg'],
        modo,
      }),
    }) as unknown as NextRequest,
  );
  return { status: r.status, corpo: (await r.json()) as { ok: boolean; motivo?: string } };
}

beforeEach(() => {
  estado.situacao = 'no_ar';
  estado.leiturasDoRobo = 0;
  estado.fotos = 3;
  buscarDeFora.mockClear();
  rpc.mockClear();
});

describe('fotos de fora no anúncio no ar, depois da troca', () => {
  it.each(['se_vazio', 'juntar', 'trocar'] as const)(
    'modo %s: recusa com crm_publica, sem baixar nem gravar nada',
    async (modo) => {
      estado.leiturasDoRobo = 2;
      estado.fotos = modo === 'se_vazio' ? 0 : 3;
      const { status, corpo } = await pedir(modo);
      expect(status).toBe(409);
      expect(corpo).toEqual({ ok: false, motivo: 'crm_publica' });
      expect(buscarDeFora).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it('antes da troca, o anúncio no ar continua recebendo (como sempre foi)', async () => {
    const { corpo } = await pedir('trocar');
    expect(corpo.motivo).not.toBe('crm_publica');
    expect(buscarDeFora).toHaveBeenCalled();
  });

  it('depois da troca, o rascunho continua recebendo', async () => {
    estado.situacao = 'rascunho';
    estado.leiturasDoRobo = 2;
    estado.fotos = 0;
    const { corpo } = await pedir('se_vazio');
    expect(corpo.motivo).not.toBe('crm_publica');
    expect(buscarDeFora).toHaveBeenCalled();
  });
});
