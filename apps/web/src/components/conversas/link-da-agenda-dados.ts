'use client';

import { EMPRESA } from '@/lib/empresa';
import { createClient } from '@/lib/supabase/client';

import {
  lerEnvio,
  lerPrevia,
  type PreviaDoLink,
  type RespostaDoLink,
  type TipoDoLink,
} from './link-da-agenda';

/**
 * O que a folha "Enviar link da agenda" pede ao banco (11/11/2026, só na Imova;
 * migração 20261112160000, do agente do convite). Nenhuma regra aqui: a prévia e o
 * envio são funções do Postgres que conferem quem pode, a janela e a porteira, e
 * devolvem `{ ok, motivo }`. Nada de texto do banco chega à tela.
 */

/** O módulo existe nesta empresa? Na KOMUNE o botão nem aparece. */
export const LINK_DA_AGENDA_NA_EMPRESA: boolean = EMPRESA.modulos.agendaComImovel;

function motivoDoErro(codigo: string | undefined): string {
  if (codigo === '42501') return 'sem_permissao';
  // A função não existe no banco: a migração ainda não foi publicada.
  if (codigo === 'PGRST202' || codigo === '42883') return 'funcao_ausente';
  return 'erro_do_servidor';
}

/** A mensagem que sairia, sem gravar nada: `public.agenda_link_previa`. */
export async function carregarPreviaDoLink(p: {
  conversaId: string;
  tipo: TipoDoLink;
  anuncioId: string | null;
}): Promise<RespostaDoLink<PreviaDoLink>> {
  const { data, error } = await createClient().rpc('agenda_link_previa', {
    p_conversation_id: p.conversaId,
    p_tipo: p.tipo,
    p_anuncio_id: p.anuncioId ?? undefined,
  });
  if (error) return { ok: false, motivo: motivoDoErro(error.code), detalhe: null };
  return lerPrevia(data);
}

/**
 * Cria o convite e manda a mensagem pelo caminho normal: `public.agenda_enviar_link`.
 * `texto` é o começo que a pessoa escreveu; o banco acrescenta o imóvel e o link.
 */
export async function enviarLinkDaAgenda(p: {
  conversaId: string;
  tipo: TipoDoLink;
  anuncioId: string | null;
  texto: string | null;
}): Promise<RespostaDoLink<{ mensagemId: string | null; link: string | null }>> {
  const { data, error } = await createClient().rpc('agenda_enviar_link', {
    p_conversation_id: p.conversaId,
    p_tipo: p.tipo,
    p_anuncio_id: p.anuncioId ?? undefined,
    p_texto: p.texto ?? undefined,
  });
  if (error) return { ok: false, motivo: motivoDoErro(error.code), detalhe: null };
  return lerEnvio(data);
}

/**
 * A ficha da conversa, para achar o lead do portal também pela ficha (a folha aberta
 * pelo clipe só sabe a conversa). Sob a RLS de quem lê; sem ficha, nulo.
 */
export async function fichaDaConversa(conversaId: string): Promise<string | null> {
  const { data } = await createClient()
    .from('conversations')
    .select('organization_id')
    .eq('id', conversaId)
    .maybeSingle();
  return data?.organization_id ?? null;
}
