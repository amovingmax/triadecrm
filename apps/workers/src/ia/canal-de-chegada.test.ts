import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CANAIS_NO_PROMPT,
  SUBCANAIS_NO_PROMPT,
  canalDeChegadaV1,
  esquemaDeSaida,
  subcanalCabeNoCanal,
} from '@komune/prompts';
import { CANAIS_DE_CHEGADA, SUBCANAIS_POR_CANAL, subcanalValido } from '@komune/schema';

import { bancoFalso, type LinhaFalsa } from './banco-de-teste';
import { dataParaOModelo, semDadoPessoal } from './canal-de-chegada';
import { RecusaDoModeloError, corpoDaRequisicao, type PedidoAoModelo } from './cliente';
import { clienteDuble, fluxoDoEsquema, type OpcoesDoDuble } from './duble';
import { pedidoDoCorpo } from './duble-servidor';
import { OrcamentoEsgotadoError, type ContextoDaIa } from './execucao';
import { ErroDeterministico, eDeterministico, tratarTrabalho } from './tarefas';

import type { LogFields, Logger } from '../lib/log';

/**
 * O CANAL DE CHEGADA DA IMOVA (06/11/2026), NO WORKER, SEM REDE.
 *
 * O que estes casos provam é o meio: o payload com chave, o banco que manda pular, as
 * fotos que baixam (ou não) do balde, a etiqueta no lugar do uuid, o dado pessoal que
 * não chega nem ao modelo nem ao banco, a recusa do modelo que vira "não identificado"
 * e — o mais importante — que a tarefa só toca as duas funções do banco e o balde, e não
 * importa nada do WhatsApp, que é intocável.
 */

function loggerDeTeste(): { logger: Logger; linhas: { nivel: string; msg: string; campos: LogFields }[] } {
  const linhas: { nivel: string; msg: string; campos: LogFields }[] = [];
  const escrever =
    (nivel: string) =>
    (msg: string, campos?: LogFields): void => {
      linhas.push({ nivel, msg, campos: campos ?? {} });
    };
  return {
    linhas,
    logger: {
      debug: escrever('debug'),
      info: escrever('info'),
      warn: escrever('warn'),
      error: escrever('error'),
    },
  };
}

const CHEGADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONVERSA = '33333333-3333-4333-8333-333333333333';
const ORG = '11111111-1111-4111-8111-111111111111';
const CONTATO = '22222222-2222-4222-8222-222222222222';
const M1 = 'c0000001-0000-4000-8000-000000000001';
const M2 = 'c0000002-0000-4000-8000-000000000002';
const M3 = 'c0000003-0000-4000-8000-000000000003';
const M4 = 'c0000004-0000-4000-8000-000000000004';

/** PNG de 1×1: imagem de verdade, sem ser foto de ninguém. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const png = (): Blob => new Blob([Buffer.from(PNG_1X1, 'base64')], { type: 'image/jpeg' });

const PAYLOAD = {
  purpose: 'identificar_canal',
  chegada_id: CHEGADA,
  conversation_id: CONVERSA,
  chave: `${CHEGADA}:4@2026-11-06T17:03:00Z`,
};

/** A entrada como `public.canal_entrada_da_ia` a devolve (o contrato da migração). */
function entradaNoBanco(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chegada_id: CHEGADA,
    conversation_id: CONVERSA,
    organization_id: ORG,
    contact_id: CONTATO,
    peer_nome: 'Marta Lins',
    inicio_em: '2026-11-06T17:02:00Z',
    agora: '2026-11-06T17:10:00Z',
    pular: null,
    mensagens: [
      {
        id: M1,
        de: 'cliente',
        quando: '06/11 14:02',
        created_at: '2026-11-06T17:02:00Z',
        tipo: 'texto',
        texto: 'Boa tarde! Aqui é a Marta Lins',
        media_path: null,
        media_mime: null,
        foto_elegivel: false,
      },
      {
        id: M2,
        de: 'cliente',
        quando: '06/11 14:02',
        created_at: '2026-11-06T17:02:10Z',
        tipo: 'foto',
        texto: null,
        media_path: 'conversas/m2.jpg',
        media_mime: 'image/jpeg',
        foto_elegivel: true,
      },
      {
        // A figurinha: o banco nunca a marca como elegível, e ela não é baixada.
        id: M3,
        de: 'cliente',
        quando: '06/11 14:02',
        created_at: '2026-11-06T17:02:20Z',
        tipo: 'foto',
        texto: null,
        media_path: 'conversas/figurinha.webp',
        media_mime: 'image/webp',
        foto_elegivel: false,
      },
      {
        id: M4,
        de: 'cliente',
        quando: '06/11 14:03',
        created_at: '2026-11-06T17:03:00Z',
        tipo: 'texto',
        texto: 'Quanto está essa casa? Me liga no 84 99988-7766',
        media_path: null,
        media_mime: null,
        foto_elegivel: false,
      },
    ],
    fotos_indisponiveis: 0,
    fotos_max: 3,
    foto_bytes_max: 5 * 1024 * 1024,
    lida_ate: '2026-11-06T17:03:00Z',
    ...extras,
  };
}

interface Montagem {
  readonly entrada?: Record<string, unknown>;
  readonly empresa?: string | null;
  readonly arquivos?: Record<string, Blob | Error>;
  readonly duble?: OpcoesDoDuble;
  readonly rpcs?: Record<string, (argumentos: Record<string, unknown>) => unknown>;
}

function montar(opcoes: Montagem = {}) {
  const gravacoes: Record<string, unknown>[] = [];
  const banco = bancoFalso(
    { ai_runs: [], tasks: [] },
    {
      rpcs: {
        canal_entrada_da_ia: () => opcoes.entrada ?? entradaNoBanco(),
        canal_gravar_da_ia: (argumentos) => {
          gravacoes.push(argumentos);
          const resultado = argumentos.p_resultado as { canal: string };
          return { gravado: true, motivo: null, canal: resultado.canal };
        },
        ...opcoes.rpcs,
      },
      arquivos: opcoes.arquivos ?? { 'mensagens/conversas/m2.jpg': png() },
    },
  );
  const { logger, linhas } = loggerDeTeste();
  const duble = clienteDuble(opcoes.duble);
  const pedidos: PedidoAoModelo[] = [];
  const contexto: ContextoDaIa = {
    cliente: banco.cliente,
    modelo: {
      conversar: (pedido) => {
        pedidos.push(pedido);
        return duble.conversar(pedido);
      },
    },
    logger,
    empresa: opcoes.empresa === undefined ? 'imova' : opcoes.empresa,
    baldeDeMidias: 'mensagens',
  };
  return { banco, contexto, duble, pedidos, gravacoes, linhas };
}

/** Todo uuid, para provar que nenhum vai ao modelo. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe('as listas do prompt são as do banco', () => {
  it('canais e subcanais do prompt são cópia fiel de @komune/schema', () => {
    expect([...CANAIS_NO_PROMPT]).toEqual([...CANAIS_DE_CHEGADA]);
    expect(SUBCANAIS_NO_PROMPT).toEqual(SUBCANAIS_POR_CANAL);
  });

  it('a regra do par canal × subcanal é a mesma nos dois lados, para todo par', () => {
    const subcanais = [...new Set(Object.values(SUBCANAIS_POR_CANAL).flat()), 'qr_da_placa', 'site'];
    for (const canal of [...CANAIS_DE_CHEGADA, 'outro']) {
      for (const subcanal of subcanais) {
        expect(subcanalCabeNoCanal(canal, subcanal), `${canal}/${subcanal}`).toBe(
          subcanalValido(canal, subcanal),
        );
      }
    }
  });
});

describe('identificar_canal: o caminho inteiro', () => {
  it('baixa a foto elegível, chama o Haiku 5.5 com ela e grava com os uuids de volta', async () => {
    const { banco, contexto, duble, gravacoes } = montar();
    const resultado = await tratarTrabalho(contexto, PAYLOAD);

    expect(resultado).toMatchObject({ proposito: 'identificar_canal', feito: true });
    expect(duble.chamadas).toEqual(['canal']);
    expect(duble.imagens).toEqual([1]);
    // Só a foto elegível foi baixada; a figurinha nem foi pedida ao Storage.
    expect(banco.downloads).toEqual([{ balde: 'mensagens', caminho: 'conversas/m2.jpg' }]);

    const run = banco.tabelas.ai_runs?.[0] as LinhaFalsa;
    expect(run.purpose).toBe('identificar_canal');
    expect(run.prompt_version).toBe('canal-de-chegada@v1');
    expect(run.model).toBe('claude-haiku-5-5');
    expect(run.conversation_id).toBe(CONVERSA);
    expect(run.status).toBe('ok');

    expect(gravacoes).toHaveLength(1);
    const gravacao = gravacoes[0]!;
    expect(gravacao.p_chegada_id).toBe(CHEGADA);
    // `ai_runs.id` é bigint: vai o número, como em `ia_gravar_ficha`.
    expect(gravacao.p_ai_run_id).toBe(run.id);
    expect(typeof gravacao.p_ai_run_id).toBe('number');
    expect(gravacao.p_lida_ate).toBe('2026-11-06T17:03:00Z');
    expect(gravacao.p_resultado).toEqual({
      canal: 'placa',
      subcanal: 'foto_da_placa',
      confianca: 0.9,
      evidencias: [
        {
          message_id: M2,
          tipo: 'foto',
          trecho: 'Simulação: o dublê trata a primeira foto como placa da Imova',
        },
      ],
      foto: {
        message_id: M2,
        peca: 'placa',
        marca: 'imova',
        descricao: 'Simulação: o dublê não vê a imagem',
        codigo_do_imovel: null,
      },
      motivo: 'Simulação: 1 foto(s) recebida(s); a primeira foi tratada como placa.',
    });
  });

  it('o modelo vê etiquetas, a hora de Natal e a foto anunciada — nunca uuid, nome ou telefone', async () => {
    const { contexto, pedidos } = montar();
    await tratarTrabalho(contexto, PAYLOAD);

    const pedido = pedidos[0]!;
    expect(pedido.mensagem).toContain('agora: 06/11/2026 às 14:10');
    expect(pedido.mensagem).toContain('começo desta chegada: 06/11/2026 às 14:02');
    expect(pedido.mensagem).toContain('[m2] em 06/11 às 14:02 — cliente mandou a foto f1');
    expect(pedido.mensagem).toContain('[m3] em 06/11 às 14:02 — cliente mandou uma foto que não veio para você');
    expect(pedido.mensagem).toContain('Aqui é a [[NOME_1]]');
    expect(pedido.mensagem).not.toContain('Marta');
    expect(pedido.mensagem).not.toMatch(/99988[-\s]?7766/);
    expect(pedido.mensagem).not.toMatch(UUID);
    expect(pedido.imagens?.map((i) => ({ mime: i.mime, rotulo: i.rotulo }))).toEqual([
      // O Storage disse JPEG; os bytes dizem PNG, e vai o que os bytes dizem.
      { mime: 'image/png', rotulo: 'Foto f1, enviada na mensagem m2' },
    ]);
  });

  it('o telefone que o CRM conhece, quando o banco o manda, sai pela passada que não falha', async () => {
    const entrada = entradaNoBanco({ peer_telefone: '+5584999887766' });
    const mensagens = (entrada.mensagens as Record<string, unknown>[]).map((m) =>
      m.id === M4 ? { ...m, texto: 'meu zap é 84 9 9988 7766' } : m,
    );
    const { contexto, pedidos } = montar({ entrada: { ...entrada, mensagens } });
    await tratarTrabalho(contexto, PAYLOAD);
    expect(pedidos[0]?.mensagem).toContain('meu zap é [[TELEFONE_1]]');
  });

  it('a tarefa só toca as duas funções do canal, o balde e a linha de ai_runs', async () => {
    const { banco, contexto } = montar();
    await tratarTrabalho(contexto, PAYLOAD);

    const rpcs = banco.chamadasDeRpc.map((c) => c.nome);
    // As do canal são exatamente duas, nesta ordem.
    expect(rpcs.filter((n) => n.startsWith('canal_'))).toEqual(['canal_entrada_da_ia', 'canal_gravar_da_ia']);
    // O resto é a guarda de sempre de qualquer trabalho de IA: supressão antes (fila) e
    // na entrega, e o freio do orçamento. Nada mais.
    for (const nome of rpcs) {
      expect(['ia_alvo_suprimido', 'canal_entrada_da_ia', 'alvo_suprimido', 'ia_pode_gastar', 'canal_gravar_da_ia']).toContain(nome);
    }
    // Tabela, só a contabilidade. Nem `messages`, nem `conversations`, nem saída.
    expect([...new Set(banco.acessos)]).toEqual(['insert:ai_runs']);
    expect(banco.downloads.every((d) => d.balde === 'mensagens')).toBe(true);
  });

  it('não importa nada do WhatsApp, e não lê nem escreve mensagem ou conversa', () => {
    const fonte = (arquivo: string): string =>
      readFileSync(fileURLToPath(new URL(arquivo, import.meta.url)), 'utf8');
    for (const arquivo of ['./canal-de-chegada.ts', './tarefas.ts', './cliente.ts', './execucao.ts', './banco.ts']) {
      const importacoes = [...fonte(arquivo).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const modulo of importacoes) {
        expect(modulo, `${arquivo} importa ${modulo}`).not.toMatch(/whatsapp|\/saida|\/graph|\/entrada/);
      }
    }
    const canal = fonte('./canal-de-chegada.ts');
    expect(canal).not.toMatch(/\.from\(\s*['"](messages|conversations|wa_outbound|wa_acoes)['"]/);
    expect(canal).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});

describe('identificar_canal: quando não há o que ler', () => {
  it('o banco manda pular: conclui sem baixar, sem chamar o modelo e sem gravar', async () => {
    const { banco, contexto, duble, gravacoes } = montar({
      entrada: { chegada_id: CHEGADA, pular: 'marcada_por_gente' },
    });
    const resultado = await tratarTrabalho(contexto, PAYLOAD);
    expect(resultado).toMatchObject({ feito: false, motivo: 'marcada_por_gente' });
    expect(duble.chamadas).toHaveLength(0);
    expect(gravacoes).toHaveLength(0);
    expect(banco.downloads).toHaveLength(0);
    expect(banco.tabelas.ai_runs ?? []).toHaveLength(0);
  });

  it('chegada que não existe: a forma exata que a migração devolve também é pular', async () => {
    const { contexto, duble } = montar({
      entrada: {
        chegada_id: CHEGADA,
        pular: 'nao_achada',
        mensagens: [],
        fotos_indisponiveis: 0,
        fotos_max: 0,
        foto_bytes_max: 0,
      },
    });
    expect(await tratarTrabalho(contexto, PAYLOAD)).toMatchObject({ feito: false, motivo: 'nao_achada' });
    expect(duble.chamadas).toHaveLength(0);
  });

  it('motivo novo do banco também é motivo para pular', async () => {
    const { contexto, duble } = montar({ entrada: { pular: 'um_motivo_de_amanha' } });
    expect(await tratarTrabalho(contexto, PAYLOAD)).toMatchObject({ feito: false, motivo: 'um_motivo_de_amanha' });
    expect(duble.chamadas).toHaveLength(0);
  });

  it('payload sem chave é recusado: sem ela não há novas tentativas nem dívida de orçamento', async () => {
    const { banco, contexto } = montar();
    const { chave: _chave, ...semChave } = PAYLOAD;
    await expect(tratarTrabalho(contexto, semChave)).rejects.toBeInstanceOf(ErroDeterministico);
    expect(banco.chamadasDeRpc.filter((c) => c.nome.startsWith('canal_'))).toHaveLength(0);
  });

  it('o banco fora do contrato é erro determinístico, não rede a esperar', async () => {
    const { contexto } = montar({ entrada: { pular: null, conversation_id: null } });
    const erro = await tratarTrabalho(contexto, PAYLOAD).catch((e: unknown) => e);
    expect(eDeterministico(erro)).toBe(true);
  });
});

describe('identificar_canal: as fotos', () => {
  it('foto que não baixa fica de fora e é contada; o trabalho segue', async () => {
    const { contexto, duble, pedidos, gravacoes, linhas } = montar({
      arquivos: { 'mensagens/conversas/m2.jpg': new Error('a rede caiu no meio') },
    });
    const resultado = await tratarTrabalho(contexto, PAYLOAD);

    expect(resultado.feito).toBe(true);
    expect(duble.imagens).toEqual([0]);
    expect(pedidos[0]?.imagens).toBeUndefined();
    expect(pedidos[0]?.mensagem).toContain('[m2] em 06/11 às 14:02 — cliente mandou uma foto que não veio para você');
    expect(pedidos[0]?.mensagem).toContain('fotos: nenhuma enviada a você; 1 não puderam ser enviadas');
    expect((gravacoes[0]?.p_resultado as { canal: string }).canal).toBe('nao_identificado');
    expect(linhas.some((l) => l.nivel === 'warn' && l.msg.includes('foto fora da leitura'))).toBe(true);
  });

  it('arquivo que não está no balde conta do mesmo jeito', async () => {
    const { pedidos, contexto } = montar({ arquivos: {} });
    await tratarTrabalho(contexto, PAYLOAD);
    expect(pedidos[0]?.mensagem).toContain('1 não puderam ser enviadas');
  });

  it('foto acima do teto do banco, ou de tipo que a API não lê, não vai', async () => {
    const grande = montar({ entrada: entradaNoBanco({ foto_bytes_max: 10 }) });
    await tratarTrabalho(grande.contexto, PAYLOAD);
    expect(grande.duble.imagens).toEqual([0]);

    const heic = entradaNoBanco();
    const mensagens = (heic.mensagens as Record<string, unknown>[]).map((m) =>
      m.id === M2 ? { ...m, media_mime: 'image/heic' } : m,
    );
    const outra = montar({ entrada: { ...heic, mensagens } });
    await tratarTrabalho(outra.contexto, PAYLOAD);
    expect(outra.duble.imagens).toEqual([0]);
  });

  it('nunca mais que três, nem que o banco deixe mais', async () => {
    const base = entradaNoBanco({ fotos_max: 5 });
    const fotos = [1, 2, 3, 4, 5].map((n) => ({
      id: `c00000f${n}-0000-4000-8000-00000000000${n}`,
      de: 'cliente',
      quando: '06/11 14:02',
      created_at: `2026-11-06T17:02:0${n}Z`,
      tipo: 'foto',
      texto: null,
      media_path: `conversas/f${n}.jpg`,
      media_mime: 'image/jpeg',
      foto_elegivel: true,
    }));
    const arquivos = Object.fromEntries(fotos.map((f) => [`mensagens/${f.media_path}`, png()]));
    const { banco, contexto, duble, pedidos } = montar({ entrada: { ...base, mensagens: fotos }, arquivos });
    await tratarTrabalho(contexto, PAYLOAD);
    expect(duble.imagens).toEqual([3]);
    expect(banco.downloads).toHaveLength(3);
    expect(pedidos[0]?.mensagem).toContain('fotos: 3 enviada(s) a você, antes deste texto; 2 não puderam ser enviadas');
  });

  it('worker sem balde: as fotos contam como indisponíveis, e nada é baixado', async () => {
    const { banco, contexto, pedidos } = montar();
    const { baldeDeMidias: _balde, ...semBalde } = contexto;
    await tratarTrabalho(semBalde, PAYLOAD);
    expect(banco.downloads).toHaveLength(0);
    expect(pedidos[0]?.mensagem).toContain('1 não puderam ser enviadas');
  });
});

describe('identificar_canal: o que volta do modelo', () => {
  it('prova com etiqueta inventada cai; nome e telefone viram palavra neutra antes do banco', async () => {
    const { contexto, gravacoes } = montar({
      duble: {
        forcar: {
          canal: {
            canal: 'placa',
            subcanal: 'texto_da_placa',
            confianca: 0.7,
            evidencias: [
              { messageId: 'm9', tipo: 'texto', trecho: 'mensagem que não existe' },
              { messageId: 'm4', tipo: 'texto', trecho: '[[NOME_1]] pediu para ligar no 84 99988-7766' },
            ],
            foto: {
              fotoId: 'f7',
              peca: 'placa',
              marca: 'imova',
              descricao: 'Placa com o telefone (84) 3222-1188 e o código SA0012',
              codigoDoImovel: 'SA0012',
            },
            motivo: 'A [[NOME_1]] citou a placa; @[[INSTAGRAM_1]] não conta.',
          },
        },
      },
    });
    await tratarTrabalho(contexto, PAYLOAD);
    const resultado = gravacoes[0]?.p_resultado as {
      evidencias: { message_id: string; trecho: string }[];
      foto: unknown;
      motivo: string;
    };
    expect(resultado.evidencias).toEqual([
      { message_id: M4, tipo: 'texto', trecho: '[nome] pediu para ligar no [número]' },
    ]);
    // `f7` não foi enviada: a descrição não tem a que foto se prender.
    expect(resultado.foto).toBeNull();
    expect(resultado.motivo).toBe('A [nome] citou a placa; @[perfil do Instagram] não conta.');
  });

  it('a recusa do modelo grava Não identificado, com o motivo e o ai_run, e conclui', async () => {
    const uso = { entrada: 2900, saida: 8, escritaDeCache: 0, leituraDeCache: 0 };
    const { banco, contexto, gravacoes } = montar({
      duble: { falharCom: () => new RecusaDoModeloError('general_harms', uso, 'claude-haiku-5-5') },
    });
    const resultado = await tratarTrabalho(contexto, PAYLOAD);

    expect(resultado).toMatchObject({ feito: true, motivo: 'recusa_do_modelo' });
    const run = banco.tabelas.ai_runs?.[0] as LinhaFalsa;
    expect(run.status).toBe('erro');
    expect(Number(run.tokens_in)).toBe(2900);
    expect(gravacoes[0]?.p_ai_run_id).toBe(run.id);
    expect(gravacoes[0]?.p_resultado).toEqual({
      canal: 'nao_identificado',
      subcanal: 'desconhecido',
      confianca: 0,
      evidencias: [],
      foto: null,
      motivo: 'A IA não conseguiu ler o começo desta conversa',
    });
  });

  it('nos outros prompts, a recusa é determinística: conclui na fila em vez de girar', () => {
    const recusa = new RecusaDoModeloError(null, { entrada: 1, saida: 1, escritaDeCache: 0, leituraDeCache: 0 }, 'x');
    expect(eDeterministico(recusa)).toBe(true);
  });

  it('o freio do orçamento recusa: a dívida é anotada com a chave do payload', async () => {
    const { banco, contexto, duble } = montar({
      rpcs: { ia_pode_gastar: () => ({ pode: false, motivo: 'alerta_80' }) },
    });
    const erro = await tratarTrabalho(contexto, PAYLOAD).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(OrcamentoEsgotadoError);
    expect(duble.chamadas).toHaveLength(0);
    const adiado = banco.chamadasDeRpc.find((c) => c.nome === 'ia_adiar_trabalho');
    expect(adiado?.argumentos).toMatchObject({ p_purpose: 'identificar_canal', p_chave: PAYLOAD.chave });
  });
});

describe('identificar_canal: só na Imova', () => {
  it('na KOMUNE sai da fila sem chamar o modelo nem o banco do canal', async () => {
    for (const empresa of ['komune', null]) {
      const { banco, contexto, duble } = montar({ empresa });
      const resultado = await tratarTrabalho(contexto, PAYLOAD);
      expect(resultado).toMatchObject({ feito: false, motivo: 'fora_da_ia_da_empresa' });
      expect(duble.chamadas).toHaveLength(0);
      expect(banco.chamadasDeRpc).toHaveLength(0);
      expect(banco.downloads).toHaveLength(0);
    }
  });

  it('na Imova, os trabalhos com prompt da KOMUNE continuam saindo da fila', async () => {
    const { contexto, duble } = montar();
    const resultado = await tratarTrabalho(contexto, {
      purpose: 'classify_inbound',
      chave: `msg:${M1}`,
      message_id: M1,
    });
    expect(resultado).toMatchObject({ feito: false, motivo: 'fora_da_ia_da_empresa' });
    expect(duble.chamadas).toHaveLength(0);
  });
});

describe('as peças soltas', () => {
  it('a data vai no formato que a auditoria aceita, na hora de Natal', () => {
    expect(dataParaOModelo('2026-11-06T17:10:00Z')).toBe('06/11/2026 às 14:10');
    expect(dataParaOModelo('2026-11-07T02:30:00Z')).toBe('06/11/2026 às 23:30');
    expect(dataParaOModelo(null)).toBe('—');
    expect(dataParaOModelo('não é data')).toBe('—');
  });

  it('oito algarismos ou mais viram "[número]"; código, preço e data ficam', () => {
    expect(semDadoPessoal('liga 84 99988-7766 ou (84) 3222-1188')).toBe('liga [número] ou ([número]');
    expect(semDadoPessoal('placa SA0012, R$ 1.250.000, dia 06/11/2026 às 14:10')).toBe(
      'placa SA0012, R$ 1.250.000, dia 06/11/2026 às 14:10',
    );
    expect(semDadoPessoal('[[TELEFONE_1]] e [[EMAIL_2]] e [[DOCUMENTO_1]]')).toBe('[número] e [e-mail] e [documento]');
  });

  it('o dublê reconhece o canal pelo schema e lê "pelo insta" como Redes sociais', async () => {
    expect(fluxoDoEsquema(esquemaDeSaida(canalDeChegadaV1))).toBe('canal');
    const duble = clienteDuble();
    const resposta = await duble.conversar({
      modelo: 'claude-haiku-5-5',
      sistema: canalDeChegadaV1.sistema,
      mensagem: '[m1] em 06/11 às 14:02 — cliente: vi vocês pelo insta',
      maxTokens: 2000,
      esquema: esquemaDeSaida(canalDeChegadaV1),
    });
    expect(canalDeChegadaV1.saida.parse(resposta.json)).toMatchObject({
      canal: 'redes_sociais',
      subcanal: 'instagram',
      evidencias: [{ messageId: 'm1', tipo: 'texto' }],
    });
  });

  it('o dublê HTTP lê as imagens do corpo que o cliente de verdade monta', () => {
    const pedido: PedidoAoModelo = {
      modelo: 'claude-haiku-5-5',
      sistema: 'sistema',
      mensagem: '[m1] em 06/11 às 14:02 — cliente mandou a foto f1',
      maxTokens: 2000,
      esquema: esquemaDeSaida(canalDeChegadaV1),
      imagens: [{ mime: 'image/png', base64: PNG_1X1, rotulo: 'Foto f1, enviada na mensagem m1' }],
    };
    const corpo = JSON.parse(JSON.stringify(corpoDaRequisicao(pedido))) as Record<string, unknown>;
    const lido = pedidoDoCorpo(corpo);
    expect(lido.mensagem).toBe(pedido.mensagem);
    expect(lido.imagens).toEqual(pedido.imagens);
  });
});
