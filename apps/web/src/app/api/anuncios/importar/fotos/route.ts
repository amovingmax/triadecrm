/**
 * Trazer as fotos de um anúncio do sistema atual (05/11/2026), só na Imova.
 *
 * POST { anuncio_id, urls: string[] (até 40, capa primeiro) }
 *   → { ok: true, fotos: [{ url, ok, motivo }] }
 *   → { ok: true, pulado: 'ja_tem_fotos', fotos: <quantas tem> }
 *   → { ok: false, motivo }
 *
 * As fotos estão no servidor do sistema atual; o navegador não as baixa (outro
 * domínio, sem CORS). Este servidor baixa cada uma, converte para JPEG (o único
 * formato do balde e do portal; a Arbo entrega WebP; `foto-em-jpeg.ts`), sobe
 * para o balde `anuncios` no mesmo caminho
 * que a rota `api/anuncios/fotos` usa (`<anuncio_id>/<uuid>.jpg`) e registra com
 * `public.anuncio_foto_adicionar` — pela SESSÃO de quem pediu, que confere de
 * novo quem pode mexer no anúncio. A chave de serviço só sobe o arquivo.
 *
 * Só para anúncio SEM foto: trazer de novo um anúncio que já tem fotos as
 * duplicaria. Para trocar as fotos, a pessoa usa o editor. A ordem do arquivo é
 * a ordem do anúncio: baixa até 4 de cada vez, registra na ordem.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { FOTOS_POR_ANUNCIO } from '@/components/anuncios/arquivo-vrsync';
import { getSession } from '@/lib/auth/session';
import { EMPRESA } from '@/lib/empresa';
import { registrarAviso, registrarRecusa } from '@/lib/registro-do-servidor';
import { createClient } from '@/lib/supabase/server';
import { criarClienteAdmin, temChaveDeServico } from '@/lib/supabase/servidor-admin';

import { buscarDeFora } from '../buscar-de-fora';
import { fotoEmJpeg } from './foto-em-jpeg';

export const runtime = 'nodejs';
// 40 fotos de até 30 s cada, 4 de cada vez, no pior caso; o prazo interno corta antes.
export const maxDuration = 300;

const BALDE = 'anuncios';
/** O limite do balde e do VRSync por imagem. */
const TETO = 7 * 1024 * 1024;
const AO_MESMO_TEMPO = 4;
/** Depois disso, as fotos que faltam voltam como 'sem_tempo' (a função morre em 300 s). */
const PRAZO_MS = 240_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type FotoTrazida = { url: string; ok: boolean; motivo: string | null };

function recusa(motivo: string, status: number) {
  return NextResponse.json({ ok: false, motivo }, { status });
}

export async function POST(request: NextRequest) {
  if (!EMPRESA.modulos.anuncios) return recusa('sem_modulo', 404);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return recusa('sem_sessao', 401);
  const papel = (await getSession())?.papel;
  if (papel !== 'admin' && papel !== 'gestor') return recusa('sem_permissao', 403);
  if (!temChaveDeServico()) {
    registrarRecusa('anuncios/importar/fotos', 'nao_configurado');
    return recusa('nao_configurado', 503);
  }

  const pedido = (await request.json().catch(() => null)) as {
    anuncio_id?: unknown;
    urls?: unknown;
  } | null;
  const anuncioId = typeof pedido?.anuncio_id === 'string' ? pedido.anuncio_id.trim() : '';
  const urls = Array.isArray(pedido?.urls)
    ? pedido.urls.filter((u): u is string => typeof u === 'string' && u.trim() !== '')
    : null;
  if (!UUID.test(anuncioId) || !urls) return recusa('pedido_incompleto', 400);
  if (urls.length > FOTOS_POR_ANUNCIO) return recusa('fotos_demais', 400);

  // O anúncio precisa ser visível E editável pela sessão de quem pede.
  const { data: anuncio, error } = await supabase
    .from('anuncios')
    .select('id, excluido_em')
    .eq('id', anuncioId)
    .maybeSingle();
  if (error) {
    registrarRecusa('anuncios/importar/fotos', 'consulta_falhou');
    return recusa('consulta_falhou', 500);
  }
  if (!anuncio) return recusa('nao_encontrado', 404);
  if (anuncio.excluido_em) return recusa('excluido', 409);

  const { count, error: erroDaContagem } = await supabase
    .from('anuncio_fotos')
    .select('id', { count: 'exact', head: true })
    .eq('anuncio_id', anuncioId);
  if (erroDaContagem) {
    registrarRecusa('anuncios/importar/fotos', 'consulta_falhou');
    return recusa('consulta_falhou', 500);
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json({ ok: true, pulado: 'ja_tem_fotos', fotos: count });
  }

  const admin = criarClienteAdmin();
  const permitirLocal = process.env.NODE_ENV !== 'production';
  const inicio = Date.now();

  /** Baixa, converte e sobe uma foto; devolve o caminho no balde. */
  async function subir(url: string): Promise<{ caminho: string } | { motivo: string }> {
    if (Date.now() - inicio > PRAZO_MS) return { motivo: 'sem_tempo' };
    const busca = await buscarDeFora(url, {
      tempoMs: 30_000,
      teto: TETO,
      permitirLocal,
      aceitar: 'image/jpeg, image/webp;q=0.9, image/png;q=0.9, image/*;q=0.8',
    });
    if (!busca.ok) return { motivo: busca.motivo };
    const foto = await fotoEmJpeg(busca.bytes, TETO);
    if (!foto.ok) return { motivo: foto.motivo };
    const caminho = `${anuncioId}/${crypto.randomUUID()}.jpg`;
    const { error: erroDoBalde } = await admin.storage
      .from(BALDE)
      .upload(caminho, foto.jpeg, { contentType: 'image/jpeg', upsert: false });
    if (erroDoBalde) return { motivo: 'balde_recusou' };
    return { caminho };
  }

  // Baixa e sobe até 4 de cada vez, guardando cada resultado no lugar da sua URL.
  const subidas: ({ caminho: string } | { motivo: string })[] = new Array(urls.length);
  let proxima = 0;
  await Promise.all(
    Array.from({ length: Math.min(AO_MESMO_TEMPO, urls.length) }, async () => {
      while (proxima < urls.length) {
        const i = proxima++;
        subidas[i] = await subir(urls[i]!).catch(() => ({ motivo: 'falhou' }));
      }
    }),
  );

  // Registra na ordem do arquivo: a primeira que chegou é a capa.
  const fotos: FotoTrazida[] = [];
  for (const [i, url] of urls.entries()) {
    const subida = subidas[i]!;
    if ('motivo' in subida) {
      fotos.push({ url, ok: false, motivo: subida.motivo });
      continue;
    }
    const { data, error: erroDoRegistro } = await supabase.rpc('anuncio_foto_adicionar', {
      p_anuncio: anuncioId,
      p_caminho: subida.caminho,
    });
    const r = (data ?? {}) as { ok?: boolean; motivo?: string };
    if (erroDoRegistro || !r.ok) {
      // A linha não entrou: o arquivo sai do balde para não ficar órfão.
      await admin.storage.from(BALDE).remove([subida.caminho]);
      fotos.push({ url, ok: false, motivo: erroDoRegistro ? 'falhou' : (r.motivo ?? 'falhou') });
      continue;
    }
    fotos.push({ url, ok: true, motivo: null });
  }

  const falharam = fotos.filter((f) => !f.ok);
  if (falharam.length) {
    registrarAviso('anuncios/importar/fotos', 'fotos_que_falharam', {
      total: fotos.length,
      falharam: falharam.length,
      motivos: [...new Set(falharam.map((f) => f.motivo))].join(','),
    });
  }
  return NextResponse.json({ ok: true, fotos });
}
