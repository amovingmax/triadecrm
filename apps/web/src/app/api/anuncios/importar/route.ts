/**
 * Ler o arquivo de anúncios do sistema atual pelo endereço (05/11/2026), só na Imova.
 *
 * POST { url, guardar? } → o que `lerArquivoVrsync` leu: { ok, cabecalho, anuncios,
 *                          avisos, guardado } ou { ok: false, motivo }.
 * POST { guardado: true } → o mesmo, com o endereço guardado no CRM
 *                           (`public.sistema_atual_endereco`), sem o navegador vê-lo.
 *
 * Com `guardar`, o endereço que abriu e era mesmo um arquivo de anúncios fica
 * guardado (`public.sistema_atual_endereco_salvar`): da próxima vez, o botão
 * "Atualizar do sistema atual" lê sem perguntar (06/11/2026).
 *
 * O sistema que publica hoje os anúncios da Imova no Canal Pro deixa um arquivo
 * VRSync num endereço (Configurações da conta > Integração de anúncios). O
 * navegador não o lê direto (outro domínio, sem CORS); este servidor busca, lê
 * e devolve. Não grava anúncio: quem traz para o CRM é a folha, anúncio por
 * anúncio, por `public.anuncio_importar`.
 *
 * Só admin e gestor (trazer anúncio é decisão da gestão). O endereço passa por
 * `seguranca-de-url` e a conexão confere o IP (`buscar-de-fora.ts`); fora de
 * produção, a máquina local é permitida, para ensaiar com o arquivo do próprio
 * CRM. Até 30 MB e 60 s. Se o endereço só abre para o robô do Grupo OLX, a
 * resposta é a recusa dele (status_403): a pessoa baixa o arquivo e escolhe no
 * computador.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { lerArquivoVrsync, textoDoArquivo } from '@/components/anuncios/arquivo-vrsync';
import { getSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { EMPRESA } from '@/lib/empresa';
import { registrarRecusa } from '@/lib/registro-do-servidor';

import { buscarDeFora } from './buscar-de-fora';

export const runtime = 'nodejs';
// A busca tem 60 s; a leitura de um arquivo grande, mais alguns.
export const maxDuration = 90;

const TETO = 30 * 1024 * 1024;

function recusa(motivo: string, status: number) {
  return NextResponse.json({ ok: false, motivo }, { status });
}

export async function POST(request: NextRequest) {
  if (!EMPRESA.modulos.anuncios) return recusa('sem_modulo', 404);
  const sessao = await getSession();
  if (!sessao) return recusa('sem_sessao', 401);
  if (sessao.papel !== 'admin' && sessao.papel !== 'gestor') return recusa('sem_permissao', 403);

  const pedido = (await request.json().catch(() => null)) as {
    url?: unknown;
    guardar?: unknown;
    guardado?: unknown;
  } | null;
  const supabase = await createClient();
  let url = typeof pedido?.url === 'string' ? pedido.url.trim() : '';
  const doGuardado = pedido?.guardado === true;
  if (doGuardado) {
    const { data, error } = await supabase.rpc('sistema_atual_endereco');
    if (error) {
      registrarRecusa('anuncios/importar', 'endereco_guardado', { erro: error.code });
      return recusa('falhou', 500);
    }
    url = typeof data === 'string' ? data : '';
    if (!url) return recusa('sem_endereco', 409);
  }
  if (!url) return recusa('url_invalida', 400);

  const busca = await buscarDeFora(url, {
    tempoMs: 60_000,
    teto: TETO,
    permitirLocal: process.env.NODE_ENV !== 'production',
    aceitar: 'application/xml, text/xml;q=0.9, */*;q=0.5',
  });
  if (!busca.ok) {
    // O endereço pode ter a chave do arquivo: no log vai só o motivo.
    registrarRecusa('anuncios/importar', busca.motivo);
    return recusa(busca.motivo, busca.motivo.startsWith('url_') ? 400 : 502);
  }

  const lido = lerArquivoVrsync(textoDoArquivo(busca.bytes));
  if (!lido.ok) {
    registrarRecusa('anuncios/importar', lido.motivo, { linha: lido.linha });
    return NextResponse.json(lido, { status: 422 });
  }

  // Guarda só o endereço que abriu e era um arquivo de anúncios.
  let guardado = doGuardado;
  if (!doGuardado && pedido?.guardar === true && lido.anuncios.length > 0) {
    const { data } = await supabase.rpc('sistema_atual_endereco_salvar', { p_url: url });
    guardado = (data as { ok?: boolean } | null)?.ok === true;
  }
  return NextResponse.json({ ...lido, guardado });
}
