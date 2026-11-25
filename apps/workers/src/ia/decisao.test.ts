import { describe, expect, it } from 'vitest';

import { esquemaDeSaida, promptVigente } from '@komune/prompts';

import { bancoFalso, type TabelasFalsas } from './banco-de-teste';
import { clienteDuble, fluxoDoEsquema, type OpcoesDoDuble } from './duble';
import { falaDaDecisao, prepararDecisao, valoresDoTexto } from './decisao';
import type { ContextoDaIa } from './execucao';
import { tratarTrabalho } from './tarefas';

import type { LogFields, Logger } from '../lib/log';

/**
 * O AVISO DE DECISÃO (IMOVA, 25/11/2026), A PARTE DO WORKER, SEM REDE.
 *
 * O que estes casos protegem: o botão "Aceitar os R$ 4 milhões" só existe quando o cliente
 * escreveu o valor; a IA nunca diz que leva o caso "à equipe"; sugestão que não passa pela
 * rede sai da lista; e "Escrever outra resposta" nunca deixa o cliente sem a resposta que o
 * admin já deu (o texto da IA, ou o do admin quando a IA falha ou a rede segura).
 */

describe('os valores que o cliente escreveu', () => {
  it('lê milhões, mil, "k", "M", ponto de milhar e centavos', () => {
    expect(valoresDoTexto('O proprietário aceita 4 milhões?')).toEqual([4_000_000]);
    expect(valoresDoTexto('faço 3,8 mi à vista')).toEqual([3_800_000]);
    expect(valoresDoTexto('pago 4M')).toEqual([4_000_000]);
    expect(valoresDoTexto('aceita 4kk?')).toEqual([4_000_000]);
    expect(valoresDoTexto('ofereço 450 mil')).toEqual([450_000]);
    expect(valoresDoTexto('450k fecha?')).toEqual([450_000]);
    expect(valoresDoTexto('R$ 450.000 e eu fecho')).toEqual([450_000]);
    expect(valoresDoTexto('R$ 4.000.000,00')).toEqual([4_000_000]);
    expect(valoresDoTexto('aceita 300000?')).toEqual([300_000]);
  });

  it('número pequeno solto não é valor', () => {
    expect(valoresDoTexto('quero 2 quartos e 1 vaga')).toEqual([]);
    expect(valoresDoTexto('pago 450 à vista')).toEqual([]);
  });
});

describe('a fala antes da decisão', () => {
  it('a da IA sai como está quando não fala em equipe nem em corretor', () => {
    expect(falaDaDecisao('Vou estudar esse caso e te retorno.', 'pergunta')).toEqual({
      texto: 'Vou estudar esse caso e te retorno.',
      trocada: false,
    });
  });

  it('"equipe", "corretor" ou vazia: a frase segura', () => {
    expect(falaDaDecisao('Vou levar à equipe.', 'proposta')).toEqual({
      texto: 'Vou repassar sua proposta ao diretor e te retorno.',
      trocada: true,
    });
    expect(falaDaDecisao('Vou ver com o corretor.', 'pergunta').texto).toBe(
      'Vou verificar e te retorno.',
    );
    expect(falaDaDecisao('  ', 'pergunta').trocada).toBe(true);
  });
});

describe('a decisão conferida', () => {
  const limpar = (t: string) => t.trim();

  it('a proposta com o valor que ele escreveu fica proposta', () => {
    const d = prepararDecisao(
      {
        tipo: 'proposta',
        imovelCodigo: ' TE0004_IMOVA ',
        valorProposto: 4_000_000,
        pergunta: 'Aceita 4 milhões?',
        sugestoes: [],
      },
      { limpar, falasDoCliente: ['Qual o valor?', 'Achei caro. Aceita 4 milhões?'], contexto: [] },
    );
    expect(d).toMatchObject({
      tipo: 'proposta',
      valorProposto: 4_000_000,
      imovelCodigo: 'TE0004_IMOVA',
      ajustes: [],
    });
  });

  it('valor que ele não escreveu: vira pergunta, sem valor e sem sugestão', () => {
    const d = prepararDecisao(
      {
        tipo: 'proposta',
        imovelCodigo: null,
        valorProposto: 4_200_000,
        pergunta: 'Aceita 4 milhões?',
        sugestoes: [],
      },
      { limpar, falasDoCliente: ['Aceita 4 milhões?'], contexto: [] },
    );
    expect(d).toMatchObject({
      tipo: 'pergunta',
      valorProposto: null,
      sugestoes: [],
      ajustes: ['valor_nao_conferido'],
    });
  });

  it('sugestão com número que ninguém disse, código ou "equipe" sai da lista; repetida também', () => {
    const d = prepararDecisao(
      {
        tipo: 'pergunta',
        imovelCodigo: null,
        valorProposto: null,
        pergunta: 'Aceita permuta?',
        sugestoes: [
          { rotulo: 'Aceita', resposta: 'O proprietário aceita permuta.' },
          { rotulo: 'Com 30%', resposta: 'Aceita permuta com 30% de entrada.' },
          { rotulo: 'Equipe', resposta: 'A equipe vê isso com você.' },
        ],
      },
      { limpar, falasDoCliente: ['Aceita permuta?'], contexto: ['Aceita permuta?'] },
    );
    expect(d.sugestoes).toEqual([{ rotulo: 'Aceita', resposta: 'O proprietário aceita permuta.' }]);
    expect(d.ajustes).toEqual(['sugestao_descartada', 'sugestao_descartada']);
  });

  it('pergunta vazia vira a última fala do cliente', () => {
    const d = prepararDecisao(
      { tipo: 'pergunta', imovelCodigo: null, valorProposto: null, pergunta: ' ', sugestoes: [] },
      { limpar, falasDoCliente: ['Tem desconto à vista?'], contexto: [] },
    );
    expect(d.pergunta).toBe('Tem desconto à vista?');
  });
});

// ---------------------------------------------------------------------------
// "Escrever outra resposta": o trabalho `responder_decisao`
// ---------------------------------------------------------------------------

const ORG = '11111111-1111-4111-8111-111111111111';
const CONTATO = '22222222-2222-4222-8222-222222222222';
const CONVERSA = '33333333-3333-4333-8333-333333333333';
const DECISAO = '44444444-4444-4444-8444-444444444444';
const PERFIL = '99999999-9999-4999-8999-999999999999';
const PAYLOAD = {
  purpose: 'responder_decisao',
  decisao_id: DECISAO,
  conversation_id: CONVERSA,
  chave: 'x',
};

function tabelas(): TabelasFalsas {
  return {
    ai_runs: [],
    tasks: [],
    organizations: [
      { id: ORG, owner_id: PERFIL, name: 'Marina Costa', phone_e164: '+5584988776655' },
    ],
    contacts: [
      {
        id: CONTATO,
        full_name: 'Marina Costa',
        first_name: 'Marina',
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
    conversation_id: CONVERSA,
    organization_id: ORG,
    contact_id: CONTATO,
    nome: 'Marina Costa',
    escolha: 'escrita',
    ja_respondida: false,
    pergunta: 'Vou usar FGTS e financiamento. Vocês ajudam com a documentação do banco?',
    resposta_da_ia: 'Boa pergunta. Vou verificar e te retorno.',
    texto_decidido: 'ajudamos sim, com toda a parte do banco',
    imovel: 'o terreno em Pipa',
    ...extras,
  };
}

function montar(
  entrada: Record<string, unknown> = entradaNoBanco(),
  opcoesDoDuble: OpcoesDoDuble = {},
) {
  const ditas: Record<string, unknown>[] = [];
  const banco = bancoFalso(tabelas(), {
    rpcs: {
      ia_decisao_entrada: () => entrada,
      ia_decisao_dizer: (argumentos) => {
        ditas.push(argumentos);
        return { ok: true, como: 'ia', mensagem: argumentos.p_texto };
      },
    },
  });
  const nada = (_msg: string, _campos?: LogFields): void => {};
  const logger: Logger = { debug: nada, info: nada, warn: nada, error: nada };
  const duble = clienteDuble(opcoesDoDuble);
  const contexto: ContextoDaIa = {
    cliente: banco.cliente,
    modelo: duble,
    logger,
    empresa: 'imova',
  };
  return { banco, contexto, duble, ditas };
}

describe('"Escrever outra resposta": a IA diz o que o admin escreveu', () => {
  it('o dublê reconhece o prompt pelo esquema', () => {
    expect(fluxoDoEsquema(esquemaDeSaida(promptVigente('resposta-da-decisao')))).toBe(
      'resposta_decisao',
    );
  });

  it('chama o modelo uma vez e manda o texto dele, com o ai_run que o pagou', async () => {
    const { contexto, duble, ditas } = montar();
    const r = await tratarTrabalho(contexto, PAYLOAD);
    expect(r).toMatchObject({ proposito: 'responder_decisao', feito: true });
    expect(duble.chamadas).toEqual(['resposta_decisao']);
    expect(ditas).toHaveLength(1);
    expect(ditas[0]).toMatchObject({
      p_id: DECISAO,
      p_texto: 'Simulação: ajudamos sim, com toda a parte do banco',
      p_prompt_version: 'resposta-da-decisao@v1',
    });
    expect(typeof ditas[0]?.p_ai_run_id).toBe('number');
  });

  it('a rede segura o texto (um número que o admin não escreveu): sai o texto do admin', async () => {
    const { contexto, ditas } = montar(entradaNoBanco(), {
      forcar: { resposta_decisao: { mensagem: 'A gente ajuda, e o prazo é de 30 dias.' } },
    });
    const r = await tratarTrabalho(contexto, PAYLOAD);
    expect(ditas[0]).toMatchObject({ p_id: DECISAO, p_texto: null });
    expect(r).toMatchObject({ motivo: 'saiu_como_o_admin_escreveu:numero_fora_do_contexto' });
  });

  it('o modelo falhou de vez: sai o texto do admin', async () => {
    const { contexto, ditas } = montar(entradaNoBanco(), {
      forcar: { resposta_decisao: { outra: 'coisa' } },
    });
    await tratarTrabalho(contexto, PAYLOAD);
    expect(ditas[0]).toMatchObject({ p_texto: null });
  });

  it('já respondida (a fila entregou de novo): não chama o modelo', async () => {
    const { contexto, duble, ditas } = montar(entradaNoBanco({ ja_respondida: true }));
    const r = await tratarTrabalho(contexto, PAYLOAD);
    expect(r).toMatchObject({ feito: false, motivo: 'ja_respondida' });
    expect(duble.chamadas).toEqual([]);
    expect(ditas).toEqual([]);
  });

  it('fora da Imova: sai da fila sem chamar o modelo', async () => {
    const { contexto, duble } = montar();
    const r = await tratarTrabalho({ ...contexto, empresa: 'komune' }, PAYLOAD);
    expect(r).toMatchObject({ feito: false, motivo: 'fora_da_ia_da_empresa' });
    expect(duble.chamadas).toEqual([]);
  });
});
