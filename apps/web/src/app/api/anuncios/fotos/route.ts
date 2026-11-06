/**
 * As fotos dos anúncios (04/11/2026), só na Imova.
 *
 * POST   { anuncio_id, tamanho }  → autorização de uso único para subir UMA foto
 * DELETE ?foto=<id>               → tira a foto do anúncio e apaga o arquivo
 *
 * O arquivo sobe DIRETO do navegador para o balde `anuncios` (a função da
 * Vercel não recebe corpo acima de 4,5 MB), com a autorização que só esta rota
 * emite, para um caminho escolhido aqui: `<anuncio_id>/<uuid>.jpg`. Antes, a
 * sessão de quem pede precisa alcançar o anúncio E poder mexer nele — a mesma
 * regra que `public.anuncio_foto_adicionar` confere depois, quando a foto é
 * registrada. O balde é público para LEITURA (o robô do Grupo OLX baixa sem
 * credencial); escrita, só por aqui.
 *
 * Apagar: a função do banco tira a linha com a sessão de quem pediu (e recusa
 * deixar anúncio no ar sem nenhuma foto); o arquivo sai com a chave de
 * serviço, porque apagar `storage.objects` por SQL deixaria o arquivo órfão.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getSession } from '@/lib/auth/session';
import { EMPRESA } from '@/lib/empresa';
import { registrarRecusa } from '@/lib/registro-do-servidor';
import { createClient } from '@/lib/supabase/server';
import { criarClienteAdmin, temChaveDeServico } from '@/lib/supabase/servidor-admin';

const BALDE = 'anuncios';
const TETO = 7 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function recusa(motivo: string, status: number) {
  return NextResponse.json({ ok: false, motivo }, { status });
}

async function preparar() {
  if (!EMPRESA.modulos.anuncios) return { erro: recusa('sem_modulo', 404) } as const;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erro: recusa('sem_sessao', 401) } as const;
  if (!temChaveDeServico()) {
    registrarRecusa('anuncios/fotos', 'nao_configurado');
    return { erro: recusa('nao_configurado', 503) } as const;
  }
  return { supabase } as const;
}

export async function POST(request: NextRequest) {
  const pronto = await preparar();
  if ('erro' in pronto) return pronto.erro;
  const { supabase } = pronto;

  const pedido = (await request.json().catch(() => null)) as {
    anuncio_id?: unknown;
    tamanho?: unknown;
  } | null;
  const anuncioId = typeof pedido?.anuncio_id === 'string' ? pedido.anuncio_id.trim() : '';
  const tamanho = Number(pedido?.tamanho);
  if (!UUID.test(anuncioId)) return recusa('pedido_incompleto', 400);
  if (!Number.isFinite(tamanho) || tamanho <= 0 || tamanho > TETO)
    return recusa('foto_grande_demais', 413);

  // O anúncio precisa ser visível E editável pela sessão de quem pede.
  const { data: anuncio, error } = await supabase
    .from('anuncios')
    .select('id, situacao, excluido_em')
    .eq('id', anuncioId)
    .maybeSingle();
  if (error) {
    registrarRecusa('anuncios/fotos', 'consulta_falhou');
    return recusa('consulta_falhou', 500);
  }
  if (!anuncio) return recusa('nao_encontrado', 404);
  if (anuncio.excluido_em) return recusa('excluido', 409);
  if (anuncio.situacao === 'no_ar') {
    const papel = (await getSession())?.papel;
    if (papel !== 'admin' && papel !== 'gestor') return recusa('so_gestao_mexe_no_ar', 403);
  }

  const caminho = `${anuncioId}/${crypto.randomUUID()}.jpg`;
  const { data, error: erroDoBalde } = await criarClienteAdmin()
    .storage.from(BALDE)
    .createSignedUploadUrl(caminho);
  if (erroDoBalde || !data) {
    registrarRecusa('anuncios/fotos', 'balde_recusou');
    return recusa('balde_recusou', 502);
  }
  return NextResponse.json({ ok: true, caminho: data.path, token: data.token });
}

export async function DELETE(request: NextRequest) {
  const pronto = await preparar();
  if ('erro' in pronto) return pronto.erro;
  const { supabase } = pronto;

  const fotoId = request.nextUrl.searchParams.get('foto') ?? '';
  if (!UUID.test(fotoId)) return recusa('pedido_incompleto', 400);

  const { data, error } = await supabase.rpc('anuncio_foto_remover', { p_foto: fotoId });
  if (error) {
    registrarRecusa('anuncios/fotos', 'remover_falhou');
    return recusa('falhou', 500);
  }
  const r = (data ?? {}) as { ok?: boolean; motivo?: string; caminho?: string };
  if (!r.ok || !r.caminho) return recusa(r.motivo ?? 'falhou', 409);

  // A linha já saiu; se o arquivo não sair, fica um órfão no balde, e a foto
  // some do anúncio do mesmo jeito. Não vale desfazer o que a pessoa pediu.
  const { error: erroDoBalde } = await criarClienteAdmin().storage.from(BALDE).remove([r.caminho]);
  if (erroDoBalde) registrarRecusa('anuncios/fotos', 'arquivo_ficou');
  return NextResponse.json({ ok: true });
}
