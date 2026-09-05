import { describe, expect, it } from 'vitest';

import { PRECOS, transcricaoAudioV1 } from '@komune/prompts';

import { bancoFalso, type LinhaFalsa } from './banco-de-teste';
import { clienteDuble } from './duble';
import { ChamadaBloqueadaError, executar, leadIdCurto, type ContextoDaIa } from './execucao';
import { RespostaIlegivelError } from './cliente';

import type { LogFields, Logger } from '../lib/log';

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

const ENTRADA = {
  leadId: 'lead-a1b2c3',
  canal: 'whatsapp' as const,
  duracaoSeg: 22,
  transcricaoBruta:
    'oi é... bom dia é a Joana né então tipo assim eu tenho interesse sim manda pra mim como funciona',
  confiancaAsr: 0.92,
  contexto: 'Buffet, primeira ligação atendida ontem.',
};

const CONTATO = {
  leadId: 'lead-a1b2c3',
  nome: 'Joana Medeiros',
  empresa: 'Buffet Aurora',
  telefones: ['+5584999880011'],
};

function montar(opcoes: Parameters<typeof bancoFalso>[1] = {}, dubleOpcoes = {}) {
  const banco = bancoFalso(
    {
      ai_runs: [],
      tasks: [],
      organizations: [{ id: 'org-1', owner_id: 'perfil-1' }],
      profiles: [{ id: 'perfil-1', is_active: true, role: 'admin', created_at: '2026-01-01' }],
    },
    opcoes,
  );
  const { logger, linhas } = loggerDeTeste();
  const duble = clienteDuble(dubleOpcoes);
  const contexto: ContextoDaIa = { cliente: banco.cliente, modelo: duble, logger };
  return { banco, contexto, linhas, duble };
}

describe('leadIdCurto', () => {
  it('não manda o uuid cru ao modelo: seis hexadecimais bastam', () => {
    expect(leadIdCurto('0f21ab34-1234-4321-8888-abcdefabcdef')).toBe('lead-0f21ab');
  });

  it('é curto demais para virar telefone — a janela local pede oito dígitos', () => {
    // 30112026 (oito dígitos, forma de data) é o caso que a auditoria recusa.
    // Com seis, nenhum sorteio alcança a janela.
    expect(leadIdCurto('30112026-0000-4000-8000-000000000000')).toBe('lead-301120');
    expect(leadIdCurto('30112026-0000-4000-8000-000000000000').replace(/\D/g, '')).toHaveLength(6);
  });

  it('sem ficha, inventa um id — a chamada não pode parar por falta de rótulo', () => {
    expect(leadIdCurto(null)).toMatch(/^lead-[0-9a-f]{6}$/);
  });
});

describe('executar', () => {
  it('grava a chamada em ai_runs com os quatro contadores e devolve a saída validada', async () => {
    const { banco, contexto } = montar();

    const primeira = await executar(contexto, transcricaoAudioV1, ENTRADA, CONTATO, {
      organizationId: 'org-1',
    });

    expect(primeira.saida.textoLimpo).toContain('interesse');
    const linha = banco.tabelas.ai_runs?.[0] as LinhaFalsa;
    expect(linha.purpose).toBe('transcribe_audio');
    expect(linha.model).toBe('claude-haiku-4-5');
    expect(linha.prompt_version).toBe('transcricao-audio@v1');
    expect(linha.status).toBe('ok');
    expect(linha.organization_id).toBe('org-1');
    // Primeira chamada: o bloco de sistema é ESCRITO no cache.
    expect(Number(linha.tokens_cache_write)).toBeGreaterThan(0);
    expect(Number(linha.tokens_cache_read)).toBe(0);
    expect(Number(linha.tokens_in)).toBeGreaterThan(0);
    expect(Number(linha.cost_usd)).toBeGreaterThan(0);

    // Segunda chamada do mesmo prompt: agora o cache é LIDO, e é 12,5 vezes
    // mais barato por token. Sem as duas colunas, esta conta não existiria.
    await executar(contexto, transcricaoAudioV1, ENTRADA, CONTATO, { organizationId: 'org-1' });
    const segunda = banco.tabelas.ai_runs?.[1] as LinhaFalsa;
    expect(Number(segunda.tokens_cache_write)).toBe(0);
    expect(Number(segunda.tokens_cache_read)).toBeGreaterThan(0);
    expect(Number(segunda.cost_usd)).toBeLessThan(Number(linha.cost_usd));

    // E a conta bate com a tabela de preços do ADR-10, não com uma constante daqui.
    const preco = PRECOS['claude-haiku-4-5'];
    const esperado =
      (Number(linha.tokens_in) * preco.entrada +
        Number(linha.tokens_out) * preco.saida +
        Number(linha.tokens_cache_write) * preco.escritaDeCache) /
      1_000_000;
    expect(Number(linha.cost_usd)).toBeCloseTo(Math.round(esperado * 1e5) / 1e5, 5);
  });

  it('o telefone do cadastro nunca chega ao modelo: sai como marcador e volta reidratado', async () => {
    const { contexto } = montar();
    const executada = await executar(
      contexto,
      transcricaoAudioV1,
      { ...ENTRADA, transcricaoBruta: 'meu contato é 84 99988-0011, pode chamar' },
      CONTATO,
      { organizationId: 'org-1' },
    );
    // O dublê devolve o que recebeu: se o número tivesse passado, ele apareceria aqui.
    expect(executada.saida.textoLimpo).not.toContain('99988');
    expect(executada.saida.textoLimpo).toContain('[[TELEFONE_1]]');
    expect(executada.mapa.porMarcador.get('[[TELEFONE_1]]')).toBe('84 99988-0011');
  });

  it('PII na montagem para a chamada, registra bloqueado com custo zero e abre tarefa', async () => {
    const { banco, contexto, duble, linhas } = montar();

    // Este é o falso positivo CONHECIDO e medido da auditoria (README de
    // packages/prompts, "o que barra chamada legítima"): data com hora colada
    // soma dez dígitos começando por um par que é DDD válido. A auditoria é
    // burra de propósito e recusa; e recusar é o comportamento certo enquanto
    // ninguém decidir o contrário. O teste existe para o dia em que alguém
    // afrouxar isso sem querer.
    const erro = await executar(
      contexto,
      transcricaoAudioV1,
      { ...ENTRADA, transcricaoBruta: 'a reunião ficou pro dia 21/11/2026 às 14:30, fechado' },
      CONTATO,
      { organizationId: 'org-1' },
    ).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ChamadaBloqueadaError);
    // A chamada NÃO saiu.
    expect(duble.chamadas).toHaveLength(0);

    const linha = banco.tabelas.ai_runs?.[0] as LinhaFalsa;
    expect(linha.status).toBe('bloqueado');
    expect(Number(linha.cost_usd)).toBe(0);
    expect(Number(linha.tokens_in)).toBe(0);
    expect(String(linha.error)).toContain('TELEFONE');

    // O erro virou trabalho para gente, com a ficha junto.
    const tarefa = banco.tabelas.tasks?.[0] as LinhaFalsa;
    expect(tarefa.assignee_id).toBe('perfil-1');
    expect(tarefa.origin).toBe('ai');
    expect(String(tarefa.title)).toContain('transcricao-audio');
    expect(linhas.some((l) => l.nivel === 'warn' && l.msg.includes('guardrail'))).toBe(true);
  });

  it('sem dono na ficha, a tarefa vai para o admin mais antigo — e o registro fica de qualquer jeito', async () => {
    const banco = bancoFalso({
      ai_runs: [],
      tasks: [],
      organizations: [{ id: 'org-2', owner_id: null }],
      profiles: [
        { id: 'perfil-novo', is_active: true, role: 'admin', created_at: '2026-05-01' },
        { id: 'perfil-antigo', is_active: true, role: 'admin', created_at: '2026-01-01' },
      ],
    });
    const { logger } = loggerDeTeste();
    const contexto: ContextoDaIa = { cliente: banco.cliente, modelo: clienteDuble(), logger };

    await executar(
      contexto,
      transcricaoAudioV1,
      { ...ENTRADA, transcricaoBruta: 'a reunião ficou pro dia 21/11/2026 às 14:30' },
      { ...CONTATO, leadId: 'lead-000002' },
      { organizationId: 'org-2' },
    ).catch(() => undefined);

    expect((banco.tabelas.tasks?.[0] as LinhaFalsa).assignee_id).toBe('perfil-antigo');
  });

  it('erro do modelo vira ai_runs "erro" e sobe — a fila é quem decide repetir', async () => {
    const { banco, contexto } = montar({}, { falharCom: () => new Error('502 do gateway') });

    await expect(
      executar(contexto, transcricaoAudioV1, ENTRADA, CONTATO, { organizationId: 'org-1' }),
    ).rejects.toThrow('502');

    const linha = banco.tabelas.ai_runs?.[0] as LinhaFalsa;
    expect(linha.status).toBe('erro');
    expect(String(linha.error)).toContain('502');
    expect(Number(linha.cost_usd)).toBe(0);
  });

  it('saída fora do schema da versão é erro, e a saída torta fica gravada', async () => {
    const { banco, contexto } = montar({}, { forcar: { transcricao: { textoLimpo: 42 } } });

    await expect(
      executar(contexto, transcricaoAudioV1, ENTRADA, CONTATO, { organizationId: 'org-1' }),
    ).rejects.toBeInstanceOf(RespostaIlegivelError);

    const linha = banco.tabelas.ai_runs?.[0] as LinhaFalsa;
    expect(linha.status).toBe('erro');
    expect(String(linha.error)).toContain('transcricao-audio@v1');
    // A saída torta é o que explica o eval vermelho de amanhã.
    expect(linha.output).toEqual({ textoLimpo: 42 });
    // Tokens contam mesmo quando a saída não serve: o modelo cobrou por eles.
    expect(Number(linha.tokens_out)).toBeGreaterThan(0);
  });

  it('custo do banco diferente do de packages/prompts vira aviso na hora', async () => {
    const { banco, contexto, linhas } = montar({ custoDoBanco: () => 9.99 });

    await executar(contexto, transcricaoAudioV1, ENTRADA, CONTATO, { organizationId: 'org-1' });

    const aviso = linhas.find((l) => l.nivel === 'warn' && l.msg.includes('divergiram'));
    expect(aviso).toBeDefined();
    expect(aviso?.campos.custo_do_banco).toBe(9.99);
    expect(banco.tabelas.ai_runs).toHaveLength(1);
  });
});
