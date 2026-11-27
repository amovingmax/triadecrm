/**
 * O motor das vantagens no worker mercado: lê o banco de mercado
 * (`public.mercado_motor_entrada` e `public.mercado_motor_anuncios`), monta a
 * base, roda o motor portado do protótipo e entrega a lista COMPLETA de cada
 * imóvel a `public.mercado_argumentos_propor`. Roda no pós-rodada, DEPOIS da
 * veracidade. Nada aqui decide o estado de uma vantagem: o banco decide
 * (nova nasce proposta; aprovada renova até 10% ou volta para aprovação; a
 * que sumiu vence). Rodar de novo na mesma rodada não duplica.
 */
import { ErroDaEsteira, type ClienteDoBanco } from '../../fila/esteira';
import type { Logger } from '../../lib/log';
import { somaDias } from './estatistica';
import {
  montarBaseDoBanco,
  type AnuncioDoBanco,
  type BaseMontada,
  type EntradaDoBanco,
} from './entrada';
import { rodarMotor, type SaidaDoMotor } from './motor';
import { proposicoes, type PropostaDoImovel } from './propor';
import { REGRAS_DO_DONO, type RegrasDasVantagens } from './regras-do-dono';
import type { Dossie } from './tipos';
import { vantagemDeValorizacao } from './valorizacao';
import { montarVantagens, VERSAO_DO_MOTOR } from './vantagens';

export { VERSAO_DO_MOTOR };

/** Quantos anúncios por página (a função do banco aceita até 2.000). */
const PAGINA = 1000;

export interface ResumoDoMotor {
  ok: boolean;
  motivo?: string;
  rodada?: string | null;
  anuncios?: number;
  imoveis?: number;
  vantagens?: number;
  novos?: number;
  renovados?: number;
  voltaram_para_aprovacao?: number;
  atualizados?: number;
  vencidos?: number;
  recusados?: Array<{ imovel: string; chave: unknown; erro: unknown }>;
  fora?: Array<{ imovel: string; id: string; motivo: string }>;
  avisos?: string[];
  /** No ensaio: o que seria entregue ao banco, imóvel por imóvel. */
  propostas?: PropostaDoImovel[];
}

export interface OpcoesDaRodadaDoMotor {
  /** Não grava: devolve o que entregaria (`propostas`). */
  ensaio?: boolean;
}

async function rpc<T>(
  cliente: ClienteDoBanco,
  nome: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await cliente.rpc(nome, args);
  if (error) throw new ErroDaEsteira(nome, error.message);
  return data as T;
}

/** Lê tudo o que o motor precisa do banco. Fora da Imova ou desligado: {ok: false}. */
export async function lerEntradaDoMotor(
  cliente: ClienteDoBanco,
): Promise<{ ok: true; entrada: EntradaDoBanco } | { ok: false; motivo: string }> {
  const e = await rpc<Record<string, unknown> | null>(cliente, 'mercado_motor_entrada', {});
  if (!e || e.ok !== true) return { ok: false, motivo: String(e?.motivo ?? 'sem_resposta') };
  const anuncios: AnuncioDoBanco[] = [];
  let depois: string | null = null;
  for (let pagina = 0; pagina < 200; pagina++) {
    const r: Record<string, unknown> | null = await rpc(cliente, 'mercado_motor_anuncios', {
      p_depois: depois,
      p_limite: PAGINA,
    });
    if (!r || r.ok !== true) return { ok: false, motivo: String(r?.motivo ?? 'sem_resposta') };
    anuncios.push(...((r.anuncios as AnuncioDoBanco[] | null) ?? []));
    depois = (r.proximo as string | null) ?? null;
    if (!depois) break;
  }
  return {
    ok: true,
    entrada: {
      hoje: String(e.hoje),
      rodada: (e.rodada as string | null) ?? null,
      carteira: (e.carteira as EntradaDoBanco['carteira']) ?? [],
      regioes: (e.regioes as EntradaDoBanco['regioes']) ?? [],
      ibge: (e.ibge as EntradaDoBanco['ibge']) ?? [],
      indices: (e.indices as EntradaDoBanco['indices']) ?? [],
      anuncios,
    },
  };
}

/** A base e o dossiê da rodada, sem banco (a parte pura: testável com a entrada pronta). */
export function calcularDossie(
  entrada: EntradaDoBanco,
  regras: RegrasDasVantagens = REGRAS_DO_DONO,
): {
  montada: BaseMontada;
  motor: SaidaDoMotor;
  dossie: Dossie;
} {
  const montada = montarBaseDoBanco(entrada);
  const coleta = montada.base.coleta;
  const motor = rodarMotor(montada.base, { alvo: montada.alvo, gerado_em: entrada.hoje, regras });
  const dossie = montarVantagens(montada.base, motor, {
    ordem: montada.ordem,
    valido_anuncios: somaDias(coleta, 14),
    rodada: { id: `${coleta}-crm`, gerado_em: entrada.hoje, motor: VERSAO_DO_MOTOR },
    regras,
  });
  // A valorização da região (regra 2 do dono, 27/11/2026): só com sinal nas fontes, e
  // nunca no imóvel cujo caderno trava a conversa de investimento (o repasse da loja).
  if (regras.valorizacao)
    for (const im of dossie.imoveis) {
      if (im.travas_objecao?.investimento) continue;
      if (im.vantagens.some((v) => v.id === 'V1.valorizacao')) continue;
      const v1 = vantagemDeValorizacao(im.regiao, montada.base, entrada);
      if (v1) im.vantagens.push(v1);
    }
  return { montada, motor, dossie };
}

/** As listas que vão ao banco, imóvel por imóvel (sem banco: testável com a entrada pronta). */
export function calcularPropostas(entrada: EntradaDoBanco): {
  propostas: PropostaDoImovel[];
  avisos: string[];
  anuncios: number;
} {
  const { montada, motor, dossie } = calcularDossie(entrada);
  return {
    propostas: proposicoes(dossie, motor.provas, montada),
    avisos: montada.avisos,
    anuncios: montada.base.anuncios.length,
  };
}

/** A rodada do motor: lê, calcula e entrega imóvel por imóvel (ou só mostra, no ensaio). */
export async function rodarMotorDeVantagens(
  cliente: ClienteDoBanco,
  logger: Logger,
  opcoes: OpcoesDaRodadaDoMotor = {},
): Promise<ResumoDoMotor> {
  const lida = await lerEntradaDoMotor(cliente);
  if (!lida.ok) return { ok: false, motivo: lida.motivo };
  const { entrada } = lida;
  if (!entrada.rodada) return { ok: false, motivo: 'sem_rodada_de_coleta', rodada: null };
  const { propostas, avisos, anuncios } = calcularPropostas(entrada);
  const resumo: ResumoDoMotor = {
    ok: true,
    rodada: entrada.rodada,
    anuncios,
    imoveis: propostas.length,
    vantagens: propostas.reduce((s, p) => s + p.itens.length, 0),
    novos: 0,
    renovados: 0,
    voltaram_para_aprovacao: 0,
    atualizados: 0,
    vencidos: 0,
    recusados: [],
    fora: propostas.flatMap((p) => p.fora.map((f) => ({ imovel: p.imovel, ...f }))),
    avisos,
  };
  if (opcoes.ensaio) return { ...resumo, propostas };
  for (const p of propostas) {
    const r = await rpc<Record<string, unknown> | null>(cliente, 'mercado_argumentos_propor', {
      p_imovel: p.imovel,
      p_argumentos: p.itens,
      p_motor_versao: VERSAO_DO_MOTOR,
      p_nao_use: p.nao_use,
    });
    if (!r || r.ok !== true) {
      logger.warn('vantagens: o banco recusou a lista do imóvel', {
        imovel: p.imovel,
        motivo: r?.motivo ?? null,
      });
      resumo.recusados!.push({ imovel: p.imovel, chave: null, erro: r?.motivo ?? 'sem_resposta' });
      continue;
    }
    for (const k of [
      'novos',
      'renovados',
      'voltaram_para_aprovacao',
      'atualizados',
      'vencidos',
    ] as const)
      resumo[k] = (resumo[k] ?? 0) + Number(r[k] ?? 0);
    for (const x of (r.recusados as Array<Record<string, unknown>> | null) ?? [])
      resumo.recusados!.push({ imovel: p.imovel, chave: x.chave, erro: x.erro });
  }
  return resumo;
}
