import { createClient } from '@/lib/supabase/client';

import {
  fraseDoPerfil,
  lerOpcoesDeEnvio,
  lerPerfil,
  mesclarOpcoes,
  type ChaveDeEnvio,
  type OpcoesDeEnvio,
  type PerfilDoWhatsapp,
} from './whatsapp-regras';

/**
 * As leituras e gravações de Ajustes → WhatsApp (27/10/2026).
 *
 * As opções do envio são gravadas DIRETO em `app_settings`, como os pesos da
 * triagem: não há função para isso, e a RLS já decide quem escreve
 * (`app_settings_update`: admin e gestor). A linha `whatsapp.envio` é
 * compartilhada com o número conectado (`wa_conectar`) e com a assinatura, então
 * a gravação lê, mescla e grava com trava otimista: só grava se `updated_at`
 * ainda é o que foi lido (o gatilho `app_settings_validate` o renova a cada
 * gravação). Se alguém gravou no meio, lê de novo e mescla de novo.
 *
 * O perfil é só pelas funções `wa_perfil_ler` e `wa_perfil_salvar` (admin).
 */

export const CHAVE_DO_WHATSAPP = ['admin', 'whatsapp'] as const;
export const CHAVE_DOS_PEDIDOS_DO_PERFIL = ['admin', 'whatsapp', 'pedidos'] as const;

const DESCRICAO_DO_ENVIO = 'Tetos de volume do RF-CON-10 e o número conectado na Cloud API.';

export async function carregarWhatsapp(): Promise<{
  envio: OpcoesDeEnvio;
  perfil: PerfilDoWhatsapp | null;
}> {
  const { data, error } = await createClient()
    .from('app_settings')
    .select('key, value')
    .in('key', ['whatsapp.envio', 'whatsapp.perfil']);
  if (error) throw new Error('Não deu para ler as configurações do WhatsApp.');
  const valor = (chave: string) => (data ?? []).find((l) => l.key === chave)?.value ?? null;
  return {
    envio: lerOpcoesDeEnvio(valor('whatsapp.envio')),
    perfil: lerPerfil(valor('whatsapp.perfil')),
  };
}

export async function mudarOpcaoDeEnvio(
  mudanca: Partial<Record<ChaveDeEnvio, boolean>>,
): Promise<void> {
  const supabase = createClient();
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    const { data: linha, error } = await supabase
      .from('app_settings')
      .select('value, updated_at')
      .eq('key', 'whatsapp.envio')
      .maybeSingle();
    if (error) throw new Error('Não deu para ler a configuração atual. Tente de novo.');

    if (!linha) {
      // A linha nasce com a conexão do número (migração 20260914100000); sem
      // ela, a primeira opção a cria.
      const { error: erroDaCriacao } = await supabase.from('app_settings').insert({
        key: 'whatsapp.envio',
        value: mesclarOpcoes({}, mudanca),
        description: DESCRICAO_DO_ENVIO,
      });
      if (!erroDaCriacao) return;
      if (erroDaCriacao.code === '23505') continue;
      throw erroDaGravacao(erroDaCriacao.code);
    }

    const { data: gravadas, error: erroDaGravacaoAtual } = await supabase
      .from('app_settings')
      .update({ value: mesclarOpcoes(linha.value, mudanca) })
      .eq('key', 'whatsapp.envio')
      .eq('updated_at', linha.updated_at)
      .select('key');
    if (erroDaGravacaoAtual) throw erroDaGravacao(erroDaGravacaoAtual.code);
    if ((gravadas ?? []).length > 0) return;
    // Ninguém gravado: outra pessoa (ou o worker) mudou a linha no meio, ou a
    // RLS não deixou. Lê de novo; na terceira, desiste dizendo o provável.
  }
  throw new Error('Não salvou. Recarregue a página e tente de novo; isto é de admin e gestor.');
}

function erroDaGravacao(codigo: string | undefined): Error {
  return new Error(
    codigo === '42501'
      ? 'Seu perfil não muda esta opção. Isso é de admin e gestor.'
      : 'Não salvou. Tente de novo em alguns segundos.',
  );
}

async function rpcDoPerfil(
  funcao: 'wa_perfil_ler' | 'wa_perfil_salvar',
  args?: Record<string, unknown>,
) {
  const { data, error } = await createClient().rpc(funcao, args);
  if (error) throw new Error(fraseDoPerfil(error.code === '42501' ? 'sem_permissao' : ''));
  const r = (data ?? {}) as { ok?: boolean; motivo?: string };
  if (r.ok !== true) throw new Error(fraseDoPerfil(r.motivo));
}

/** Pede ao worker que leia o perfil da Meta. Ele grava em `whatsapp.perfil`. */
export function lerPerfilDoWhatsapp(): Promise<void> {
  return rpcDoPerfil('wa_perfil_ler');
}

/** Manda as mudanças (e a foto, por `foto_path`) para a Meta. */
export function salvarPerfilNoWhatsapp(dados: Record<string, unknown>): Promise<void> {
  return rpcDoPerfil('wa_perfil_salvar', { p_dados: dados });
}

export type PedidoDoPerfil = {
  id: number;
  tipo: string;
  estado: 'pendente' | 'fazendo' | 'feita' | 'falhou' | 'descartada';
  erro: string | null;
  pedida_em: string;
  feita_em: string | null;
};

/** Os últimos pedidos de ler e salvar o perfil, para dizer "esperando" e o porquê da recusa. */
export async function carregarPedidosDoPerfil(): Promise<PedidoDoPerfil[]> {
  const { data, error } = await createClient()
    .from('wa_acoes')
    .select('id, tipo, estado, erro, pedida_em, feita_em')
    .in('tipo', ['perfil_ler', 'perfil_salvar'])
    .order('pedida_em', { ascending: false })
    .limit(10);
  if (error) return [];
  return (data ?? []) as PedidoDoPerfil[];
}
