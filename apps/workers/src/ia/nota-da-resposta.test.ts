import { describe, expect, it } from 'vitest';

import { esquemaDeSaida, promptVigente } from '@komune/prompts';

import { bancoFalso, type TabelasFalsas } from './banco-de-teste';
import { clienteDuble, fluxoDoEsquema, type OpcoesDoDuble } from './duble';
import type { ContextoDaIa } from './execucao';
import { tituloSeguro } from './nota-da-resposta';
import { tratarTrabalho } from './tarefas';

import type { LogFields, Logger } from '../lib/log';

/**
 * A IA APRENDE COM AS RESPOSTAS (IMOVA, 27/11/2026), A PARTE DO WORKER, SEM REDE.
 *
 * O que estes casos protegem: a sugestão só nasce de pergunta respondida e uma vez só; o
 * combinado com um cliente não vira nota; texto que a rede segura não vai ao banco (e o
 * outro alcance, se passar, vai); o nome da ficha nova não inventa número; e nada disso
 * chama o modelo fora da Imova.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const CONTATO = '22222222-2222-4222-8222-222222222222';
const CONVERSA = '33333333-3333-4333-8333-333333333333';
const DECISAO = '44444444-4444-4444-8444-444444444444';
const PERFIL = '99999999-9999-4999-8999-999999999999';
const PAYLOAD = { purpose: 'sugerir_nota', decisao_id: DECISAO, chave: 'sugerir_nota:x' };

function tabelas(): TabelasFalsas {
  return {
    ai_runs: [],
    tasks: [],
    organizations: [{ id: ORG, owner_id: PERFIL, name: 'Carla Mendes', phone_e164: '+5584988776655' }],
    contacts: [
      {
        id: CONTATO,
        full_name: 'Carla Mendes',
        first_name: 'Carla',
        phone_e164: '+5584988776655',
        email: null,
        instagram_handle: null,
      },
    ],
    profiles: [{ id: PERFIL, is_active: true, role: 'admin', created_at: '2026-01-01' }],
  };
}

function entradaNoBanco(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    existe: true,
    tipo: 'pergunta',
    situacao: 'respondida',
    escolha: 'sugestao',
    conversation_id: CONVERSA,
    organization_id: ORG,
    contact_id: CONTATO,
    nome: 'Carla Mendes',
    pergunta: 'energia individualizada?',
    resposta:
      'Sim, a sala tem energia individualizada, ou seja, o consumo é medido e pago separadamente, à parte do condomínio.',
    ja_sugerida: false,
    tem_ficha: false,
    imovel: {
      frase: 'a sala em Ponta Negra',
      tipo: 'sala_comercial',
      titulo: 'Sala comercial no Brisa Mall',
      area: 19,
      bairro: 'Ponta Negra',
      cidade: 'Natal',
      negocio: 'aluguel',
    },
    ...extras,
  };
}

function montar(entrada: Record<string, unknown> = entradaNoBanco(), opcoesDoDuble: OpcoesDoDuble = {}) {
  const sugeridas: Record<string, unknown>[] = [];
  const banco = bancoFalso(tabelas(), {
    rpcs: {
      ia_nota_entrada: () => entrada,
      ia_nota_sugerir: (argumentos) => {
        sugeridas.push(argumentos);
        return { ok: true, id: 'x', escopo: argumentos.p_escopo };
      },
    },
  });
  const nada = (_msg: string, _campos?: LogFields): void => {};
  const logger: Logger = { debug: nada, info: nada, warn: nada, error: nada };
  const duble = clienteDuble(opcoesDoDuble);
  const contexto: ContextoDaIa = { cliente: banco.cliente, modelo: duble, logger, empresa: 'imova' };
  return { contexto, duble, sugeridas };
}

describe('a nota da resposta: o trabalho sugerir_nota', () => {
  it('o dublê reconhece o prompt pelo esquema', () => {
    expect(fluxoDoEsquema(esquemaDeSaida(promptVigente('nota-da-resposta')))).toBe('nota_resposta');
  });

  it('chama o modelo uma vez e sugere a nota do imóvel, com o nome da ficha nova', async () => {
    const { contexto, duble, sugeridas } = montar();
    const r = await tratarTrabalho(contexto, PAYLOAD);
    expect(r).toMatchObject({ proposito: 'sugerir_nota', feito: true });
    expect(duble.chamadas).toEqual(['nota_resposta']);
    expect(sugeridas).toHaveLength(1);
    expect(sugeridas[0]).toMatchObject({
      p_decisao_id: DECISAO,
      p_texto_geral: null,
      p_escopo: 'imovel',
      p_titulo_da_ficha: 'IMÓVEL DE SIMULAÇÃO',
      p_prompt_version: 'nota-da-resposta@v1',
    });
    expect(String(sugeridas[0]?.p_texto_imovel)).toContain('energia individualizada');
    expect(typeof sugeridas[0]?.p_ai_run_id).toBe('number');
  });

  it('o imóvel que já tem ficha não manda nome de ficha', async () => {
    const { contexto, sugeridas } = montar(entradaNoBanco({ tem_ficha: true }));
    await tratarTrabalho(contexto, PAYLOAD);
    expect(sugeridas[0]).toMatchObject({ p_titulo_da_ficha: null });
  });

  it('combinado com um cliente: o modelo diz que não vira nota, e nada vai ao banco', async () => {
    const { contexto, duble, sugeridas } = montar(
      entradaNoBanco({ pergunta: 'Posso visitar amanhã?', resposta: 'Pode sim, amanhã às 10h.' }),
    );
    const r = await tratarTrabalho(contexto, PAYLOAD);
    expect(r).toMatchObject({ feito: false, motivo: 'nao_vira_nota' });
    expect(duble.chamadas).toEqual(['nota_resposta']);
    expect(sugeridas).toEqual([]);
  });

  it('a rede segura a nota com número que ninguém disse; o outro alcance, se passar, vai', async () => {
    const { contexto, sugeridas } = montar(entradaNoBanco(), {
      forcar: {
        nota_resposta: {
          viraNota: true,
          porque: 'fato',
          textoDoImovel: 'Energia individualizada; a conta média é de R$ 120.',
          textoGeral: 'Energia: as salas do Brisa Mall têm energia individualizada.',
          alcance: 'imovel',
          tituloDaFicha: null,
        },
      },
    });
    const r = await tratarTrabalho(contexto, PAYLOAD);
    expect(r).toMatchObject({ feito: true });
    expect(sugeridas[0]).toMatchObject({
      p_texto_imovel: null,
      p_texto_geral: 'Energia: as salas do Brisa Mall têm energia individualizada.',
    });
  });

  it('as duas notas seguradas: nada vai ao banco', async () => {
    const { contexto, sugeridas } = montar(entradaNoBanco(), {
      forcar: {
        nota_resposta: {
          viraNota: true,
          porque: 'fato',
          textoDoImovel: 'Para saber, ligue 84 98820-9001.',
          textoGeral: null,
          alcance: 'imovel',
          tituloDaFicha: null,
        },
      },
    });
    const r = await tratarTrabalho(contexto, PAYLOAD);
    expect(r).toMatchObject({ feito: false, motivo: 'rede_segurou:telefone' });
    expect(sugeridas).toEqual([]);
  });

  it('proposta, decisão ainda aberta ou já sugerida: não chama o modelo', async () => {
    for (const extras of [{ tipo: 'proposta' }, { situacao: 'aberta' }, { ja_sugerida: true }]) {
      const { contexto, duble, sugeridas } = montar(entradaNoBanco(extras));
      const r = await tratarTrabalho(contexto, PAYLOAD);
      expect(r.feito).toBe(false);
      expect(duble.chamadas).toEqual([]);
      expect(sugeridas).toEqual([]);
    }
  });

  it('o modelo falhou de vez: sem sugestão, sem erro', async () => {
    const { contexto, sugeridas } = montar(entradaNoBanco(), { forcar: { nota_resposta: { outra: 'coisa' } } });
    const r = await tratarTrabalho(contexto, PAYLOAD);
    expect(r).toMatchObject({ feito: false, motivo: 'erro_do_modelo' });
    expect(sugeridas).toEqual([]);
  });

  it('fora da Imova: sai da fila sem chamar o modelo', async () => {
    const { contexto, duble } = montar();
    const r = await tratarTrabalho({ ...contexto, empresa: 'komune' }, PAYLOAD);
    expect(r).toMatchObject({ feito: false, motivo: 'fora_da_ia_da_empresa' });
    expect(duble.chamadas).toEqual([]);
  });
});

describe('o nome da ficha nova', () => {
  const contexto = ['Sala comercial no Brisa Mall', '19', 'Ponta Negra', 'Natal'];
  it('vai em maiúsculas quando os números estão no anúncio', () => {
    expect(tituloSeguro('Sala de 19 m² no Brisa Mall, Ponta Negra, Natal', contexto)).toBe(
      'SALA DE 19 M² NO BRISA MALL, PONTA NEGRA, NATAL',
    );
  });
  it('número inventado, código ou dois-pontos: o banco monta o nome', () => {
    expect(tituloSeguro('SALA DE 20 M² NO BRISA MALL', contexto)).toBeNull();
    expect(tituloSeguro('SALA SA0012 NO BRISA MALL', contexto)).toBeNull();
    expect(tituloSeguro('FICHA: SALA', contexto)).toBeNull();
  });
});
