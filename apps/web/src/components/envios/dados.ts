'use client';

import { z } from 'zod';

import { createClient } from '@/lib/supabase/client';

import {
  envioSchema,
  itemDoEnvioSchema,
  modeloSchema,
  pessoaDoPublicoSchema,
  previaSchema,
  publicoSalvoSchema,
  type AcaoDoBotao,
  type Assinatura,
  type Envio,
  type FiltroDoPublico,
  type ItemDoEnvio,
  type Modelo,
  type PessoaDoPublico,
  type Previa,
  type PublicoSalvo,
  type RegraDaVariavel,
  type TipoDoEnvio,
} from './tipos';

/**
 * As conversas desta tela com o Postgres. Nenhuma manda mensagem: criar um
 * envio grava a fila, e quem manda é o relógio do banco, uma por vez, pela
 * mesma porteira do botão da conversa.
 */

export class ErroDoEnvio extends Error {
  readonly motivo: string;
  readonly variavel: string | undefined;

  constructor(motivo: string, variavel?: string) {
    super(motivo);
    this.name = 'ErroDoEnvio';
    this.motivo = motivo;
    this.variavel = variavel;
  }
}

const respostaSchema = z.object({
  ok: z.boolean(),
  motivo: z.string().optional(),
  variavel: z.string().optional(),
});

function conferir(data: unknown): Record<string, unknown> {
  const r = respostaSchema.passthrough().parse(data);
  if (!r.ok) throw new ErroDoEnvio(r.motivo ?? 'erro', r.variavel);
  return r;
}

export async function buscarPublico(filtro: FiltroDoPublico): Promise<PessoaDoPublico[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('envio_em_massa_publico', { p_filtro: filtro });
  if (error) throw new ErroDoEnvio(error.code === '42501' ? 'sem_permissao' : error.message);
  return z.array(pessoaDoPublicoSchema).parse(data ?? []);
}

/** Os recortes que a campanha ganhou na Fase 5: etiqueta do parceiro e setor da conversa. */
export async function buscarEtiquetasESetores(): Promise<{
  etiquetas: { id: number; nome: string }[];
  setores: { id: number; nome: string }[];
}> {
  const supabase = createClient();
  const [etiquetas, setores] = await Promise.all([
    supabase.from('tags').select('id, name').order('name'),
    supabase.from('setores').select('id, nome').eq('ativo', true).order('posicao'),
  ]);
  if (etiquetas.error) throw new ErroDoEnvio(etiquetas.error.message);
  if (setores.error) throw new ErroDoEnvio(setores.error.message);
  return {
    etiquetas: (etiquetas.data ?? []).map((t) => ({ id: t.id, nome: t.name })),
    setores: setores.data ?? [],
  };
}

/**
 * Os cumprimentos que dá para mandar em massa: ativos e aprovados pela Meta.
 * Fora da janela, a campanha só abre conversa com eles (22/09/2026).
 */
export async function buscarCumprimentos(): Promise<Modelo[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('message_templates')
    .select('id, template_code, name, body, category, kind, botoes')
    .eq('is_active', true)
    .eq('channel', 'whatsapp')
    .eq('meta_status', 'approved')
    .not('meta_template_name', 'is', null)
    .like('template_code', 'GEN-ABR-OLA-%')
    .order('template_code');
  if (error) throw new ErroDoEnvio(error.message);
  return z.array(modeloSchema).parse(data ?? []);
}

export async function buscarTetoDeHoje(): Promise<{ teto: number; usados: number } | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('envio_em_massa_teto');
  if (error) return null;
  const r = z.object({ ok: z.boolean(), teto: z.number().optional(), usados: z.number().optional() }).parse(data);
  return r.ok && r.teto !== undefined ? { teto: r.teto, usados: r.usados ?? 0 } : null;
}

export type ConfigDoEnvio = {
  nome: string;
  tipo: TipoDoEnvio;
  modeloId: number | null;
  texto: string;
  variaveis: Record<string, RegraDaVariavel>;
  assinatura: Assinatura;
  atendentes: string[];
  porHora: number;
  /** ISO; `null` é agora. */
  inicio: string | null;
  filtro: FiltroDoPublico;
  /** Para onde vai quem toca no botão de link (https). */
  linkDestino: string;
  /** Por texto do botão de resposta. */
  acoes: Record<string, AcaoDoBotao>;
};

function paraOBanco(c: ConfigDoEnvio, organizacoes: string[]) {
  return {
    nome: c.nome.trim(),
    tipo: c.tipo,
    modelo_id: c.tipo === 'modelo' ? c.modeloId : null,
    texto: c.tipo === 'texto' ? c.texto : null,
    variaveis: c.variaveis,
    assinatura: c.assinatura,
    atendentes: c.assinatura === 'revezar' ? c.atendentes : [],
    por_hora: c.porHora,
    inicio: c.inicio,
    filtro: c.filtro,
    link_destino: c.linkDestino.trim() || null,
    acoes: c.acoes,
    organizacoes,
  };
}

export async function buscarPrevia(c: ConfigDoEnvio, organizacoes: string[]): Promise<Previa> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('envio_em_massa_previa', {
    p_config: paraOBanco(c, []),
    p_organizacoes: organizacoes,
  });
  if (error) throw new ErroDoEnvio(error.message);
  return previaSchema.parse(data);
}

export async function criarEnvio(c: ConfigDoEnvio, organizacoes: string[]): Promise<{ id: string; itens: number }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('envio_em_massa_criar', {
    p_config: paraOBanco(c, organizacoes),
  });
  if (error) throw new ErroDoEnvio(error.message);
  const r = conferir(data);
  return { id: String(r.id), itens: Number(r.itens) };
}

export async function listarEnvios(): Promise<Envio[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('envios_em_massa_lista');
  if (error) throw new ErroDoEnvio(error.code === '42501' ? 'sem_permissao' : error.message);
  return z.array(envioSchema).parse(data ?? []);
}

export async function detalharEnvio(id: string): Promise<{ envio: Envio; itens: ItemDoEnvio[] }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('envio_em_massa_detalhe', { p_id: id });
  if (error) throw new ErroDoEnvio(error.message);
  const r = conferir(data);
  const e = z.record(z.string(), z.unknown()).parse(r.envio);
  return {
    envio: envioSchema.parse({ ...e, criado_por: e.criado_por_nome ?? null }),
    itens: z.array(itemDoEnvioSchema).parse(r.itens ?? []),
  };
}

export async function mudarEnvio(id: string, acao: 'pausar' | 'retomar' | 'cancelar'): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('envio_em_massa_mudar', { p_id: id, p_acao: acao });
  if (error) throw new ErroDoEnvio(error.message);
  conferir(data);
}

export async function listarPublicosSalvos(): Promise<PublicoSalvo[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('publicos_salvos')
    .select('id, nome, filtro')
    .order('nome');
  if (error) throw new ErroDoEnvio(error.message);
  return z.array(publicoSalvoSchema).parse(data ?? []);
}

export async function salvarPublico(nome: string, filtro: FiltroDoPublico): Promise<void> {
  const supabase = createClient();
  const { data: sessao } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('publicos_salvos')
    .insert({ nome: nome.trim(), filtro, criado_por: sessao.user?.id ?? '' });
  if (error) throw new ErroDoEnvio(error.message);
}

export async function apagarPublico(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('publicos_salvos').delete().eq('id', id);
  if (error) throw new ErroDoEnvio(error.message);
}
