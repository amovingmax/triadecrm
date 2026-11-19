/**
 * A trava da troca na rota que traz fotos de fora (19/11/2026): depois que o robô
 * do Grupo OLX leu o arquivo do CRM, o anúncio NO AR não recebe fotos do favorito
 * nem do sistema atual, em modo nenhum. Antes da troca, e no rascunho, nada muda.
 * A trava é conferida no começo e de novo logo antes de gravar: o download pode
 * levar até 240 s, e a troca (ou o "Pôr no ar") pode acontecer no meio.
 *
 * O banco, a sessão, a busca e a conversão são de mentira: aqui só se confere a
 * decisão da rota.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * O que o banco responde, uma resposta por consulta: a última se repete. Assim
 * dá para a situação ou a leitura do robô mudar no meio do pedido.
 */
const estado = vi.hoisted(() => ({
  situacoes: ['no_ar'] as ('no_ar' | 'rascunho')[],
  leituras: [0] as number[],
  fotos: 3,
  /** O "desde" que a rota pediu às leituras do robô (o prazo de 90 dias). */
  leituraDesde: null as string | null,
}));
const buscarDeFora = vi.hoisted(() => vi.fn(async () => ({ ok: false, motivo: 'status_404' })));
const rpc = vi.hoisted(() => vi.fn(async () => ({ data: { ok: true }, error: null })));
const balde = vi.hoisted(() => ({
  upload: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ error: null })),
}));

function proxima<T>(fila: T[]): T {
  return fila.length > 1 ? fila.shift()! : fila[0]!;
}

/** Uma consulta encadeável do supabase-js: cada passo devolve ela mesma, e o fim é o resultado. */
function consulta(resultado: () => unknown, aoFiltrar?: (passo: string, args: unknown[]) => void) {
  const q: Record<string, unknown> = {};
  for (const passo of ['select', 'eq', 'gt', 'order', 'is']) {
    q[passo] = (...args: unknown[]) => {
      aoFiltrar?.(passo, args);
      return q;
    };
  }
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
  criarClienteAdmin: () => ({ storage: { from: () => balde } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    rpc,
    from: (tabela: string) => {
      if (tabela === 'anuncios') {
        return consulta(() => ({
          data: { id: ANUNCIO, excluido_em: null, situacao: proxima(estado.situacoes) },
          error: null,
        }));
      }
      if (tabela === 'canal_pro_leituras') {
        return consulta(
          () => ({ count: proxima(estado.leituras), error: null }),
          (passo, args) => {
            if (passo === 'gt' && args[0] === 'em') estado.leituraDesde = String(args[1]);
          },
        );
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
vi.mock('./foto-em-jpeg', () => ({
  fotoEmJpeg: async () => ({ ok: true, jpeg: new Uint8Array([0xff, 0xd8, 0xff]) }),
}));

const ANUNCIO = '0e7f5b1c-1111-4222-8333-444455556666';

async function pedir(modo: 'se_vazio' | 'juntar' | 'trocar') {
  const { POST } = await import('./route');
  const r = await POST(
    new Request('http://localhost/api/anuncios/importar/fotos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anuncio_id: ANUNCIO,
        urls: ['https://exemplo.com/1.jpg', 'https://exemplo.com/2.jpg'],
        modo,
      }),
    }) as unknown as NextRequest,
  );
  return { status: r.status, corpo: (await r.json()) as { ok: boolean; motivo?: string } };
}

beforeEach(() => {
  estado.situacoes = ['no_ar'];
  estado.leituras = [0];
  estado.fotos = 3;
  estado.leituraDesde = null;
  buscarDeFora.mockReset();
  buscarDeFora.mockImplementation(async () => ({ ok: false, motivo: 'status_404' }));
  rpc.mockClear();
  balde.upload.mockClear();
  balde.remove.mockClear();
});

describe('fotos de fora no anúncio no ar, depois da troca', () => {
  it.each(['se_vazio', 'juntar', 'trocar'] as const)(
    'modo %s: recusa com crm_publica, sem baixar nem gravar nada',
    async (modo) => {
      estado.leituras = [2];
      estado.fotos = modo === 'se_vazio' ? 0 : 3;
      const { status, corpo } = await pedir(modo);
      expect(status).toBe(409);
      expect(corpo).toEqual({ ok: false, motivo: 'crm_publica' });
      expect(buscarDeFora).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it('o sinal da troca é a leitura do robô nos últimos 90 dias', async () => {
    estado.leituras = [2];
    const antes = Date.now();
    await pedir('trocar');
    const desde = Date.parse(estado.leituraDesde ?? '');
    const dias = (antes - desde) / 86_400_000;
    expect(dias).toBeGreaterThan(89.9);
    expect(dias).toBeLessThan(90.1);
  });

  it('antes da troca, o anúncio no ar continua recebendo (como sempre foi)', async () => {
    const { corpo } = await pedir('trocar');
    expect(corpo.motivo).not.toBe('crm_publica');
    expect(buscarDeFora).toHaveBeenCalled();
  });

  it('depois da troca, o rascunho continua recebendo', async () => {
    estado.situacoes = ['rascunho'];
    estado.leituras = [2];
    estado.fotos = 0;
    const { corpo } = await pedir('se_vazio');
    expect(corpo.motivo).not.toBe('crm_publica');
    expect(buscarDeFora).toHaveBeenCalled();
  });
});

describe('a troca acontece durante o download', () => {
  beforeEach(() => {
    buscarDeFora.mockImplementation(
      async () => ({ ok: true, bytes: new Uint8Array([1, 2, 3]) }) as never,
    );
  });

  it('o robô leu no meio: nada é gravado, e as fotos que subiram saem do balde', async () => {
    estado.leituras = [0, 2];
    const { status, corpo } = await pedir('trocar');
    expect(status).toBe(409);
    expect(corpo).toEqual({ ok: false, motivo: 'crm_publica' });
    expect(balde.upload).toHaveBeenCalledTimes(2);
    expect(rpc).not.toHaveBeenCalled();
    const subiram = balde.upload.mock.calls.map((c) => (c as unknown[])[0]);
    expect(balde.remove).toHaveBeenCalledWith(subiram);
  });

  it('o anúncio foi ao ar no meio, já depois da troca: também não grava', async () => {
    // O pedido lê a situação três vezes: o anúncio, a trava do começo e a de antes de gravar.
    estado.situacoes = ['rascunho', 'rascunho', 'no_ar'];
    estado.leituras = [2];
    estado.fotos = 0;
    const { status, corpo } = await pedir('se_vazio');
    expect(status).toBe(409);
    expect(corpo.motivo).toBe('crm_publica');
    expect(rpc).not.toHaveBeenCalled();
    expect(balde.remove).toHaveBeenCalled();
  });

  it('sem troca no meio, grava como sempre', async () => {
    estado.situacoes = ['rascunho'];
    estado.fotos = 0;
    const { corpo } = await pedir('se_vazio');
    expect(corpo.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('anuncio_foto_adicionar', expect.anything());
    expect(balde.remove).not.toHaveBeenCalled();
  });
});
