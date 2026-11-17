import { describe, expect, it } from 'vitest';

import {
  enderecoDaApi,
  fraseDaRecusa,
  problemaDaUrl,
  resumoDosEscopos,
  rotuloDaEntrega,
  situacaoDaChave,
  situacaoDoWebhook,
  type Chave,
  type Entrega,
  type Escopo,
  type Webhook,
} from './integracoes-regras';

const ESCOPOS: Escopo[] = [
  { id: 'fichas:ler', nome: 'Ler fichas', descricao: '' },
  { id: 'fichas:escrever', nome: 'Criar leads e mexer em fichas', descricao: '' },
  { id: 'webhooks', nome: 'Avisos para fora', descricao: '' },
];

function chave(extra: Partial<Chave> = {}): Chave {
  return {
    id: 'c1',
    nome: 'Site',
    prefixo: 'trd_imova_3f9a1c',
    escopos: ['fichas:ler'],
    em_nome_de: { id: 'p1', nome: 'Rafael' },
    em_nome_de_tem_acesso: true,
    criada_por: { id: 'p1', nome: 'Rafael' },
    criada_em: '2026-11-17T12:00:00Z',
    usada_em: '2026-11-17T13:00:00Z',
    revogada_em: null,
    revogada_por: null,
    limite_por_minuto: 120,
    chamadas_24h: 3,
    erros_24h: 0,
    ...extra,
  };
}

function webhook(extra: Partial<Webhook> = {}): Webhook {
  return {
    id: 'w1',
    url: 'https://erp.exemplo.com.br/avisos',
    eventos: ['ficha.criada'],
    descricao: null,
    segredo_prefixo: 'whsec_ab12cd',
    ativo: true,
    pausado_em: null,
    pausado_motivo: null,
    falhas_seguidas: 0,
    ultima_entrega_em: null,
    ultima_falha_em: null,
    origem: 'ajustes',
    chave: null,
    criado_por: null,
    criado_em: '2026-11-17T12:00:00Z',
    pendentes: 0,
    entregues_7d: 0,
    falharam_7d: 0,
    ...extra,
  };
}

describe('o endereço da API', () => {
  it('é a função api do projeto Supabase da empresa', () => {
    expect(enderecoDaApi('https://kkqadgxvmzulcamuakzk.supabase.co')).toBe(
      'https://kkqadgxvmzulcamuakzk.supabase.co/functions/v1/api',
    );
    expect(enderecoDaApi('http://127.0.0.1:54321/')).toBe(
      'http://127.0.0.1:54321/functions/v1/api',
    );
  });
});

describe('a situação da chave', () => {
  it('revogada vence tudo, depois a pessoa sem acesso', () => {
    expect(
      situacaoDaChave(chave({ revogada_em: '2026-11-17T14:00:00Z', em_nome_de_tem_acesso: false }))
        .texto,
    ).toBe('Revogada');
    expect(situacaoDaChave(chave({ em_nome_de_tem_acesso: false })).tom).toBe('problema');
    expect(situacaoDaChave(chave({ usada_em: null })).texto).toBe('Ativa, nunca usada');
    expect(situacaoDaChave(chave()).texto).toBe('Ativa');
  });
});

describe('o resumo das permissões', () => {
  it('na ordem do catálogo, e "Tudo" quando tem todas', () => {
    expect(resumoDosEscopos(['webhooks', 'fichas:ler'], ESCOPOS)).toBe(
      'Ler fichas · Avisos para fora',
    );
    expect(resumoDosEscopos(['fichas:ler', 'fichas:escrever', 'webhooks'], ESCOPOS)).toBe('Tudo');
  });
});

describe('a situação do webhook', () => {
  it('diz por que foi pausado', () => {
    expect(
      situacaoDoWebhook(webhook({ ativo: false, pausado_motivo: 'destino_respondeu_410' })).texto,
    ).toMatch(/410/);
    expect(
      situacaoDoWebhook(webhook({ ativo: false, pausado_motivo: 'falhas_seguidas' })).tom,
    ).toBe('problema');
    expect(
      situacaoDoWebhook(webhook({ ativo: false, pausado_motivo: 'pausado_na_tela' })).tom,
    ).toBe('apagado');
  });
  it('ativo com falhas recentes aparece como problema', () => {
    expect(situacaoDoWebhook(webhook({ falhas_seguidas: 1 })).texto).toBe(
      'Ativo, mas as últimas falhou',
    );
    expect(situacaoDoWebhook(webhook({ falhas_seguidas: 3 })).texto).toBe(
      'Ativo, mas as últimas 3 falharam',
    );
    expect(situacaoDoWebhook(webhook()).texto).toBe('Ativo');
  });
});

describe('a entrega', () => {
  const base: Entrega = {
    id: 'e1',
    evento: 'ficha.criada',
    situacao: 'entregue',
    tentativas: 1,
    ultimo_status: 200,
    ultimo_erro: null,
    criado_em: '2026-11-17T12:00:00Z',
    entregue_em: '2026-11-17T12:00:01Z',
    proxima_em: '2026-11-17T12:00:00Z',
  };
  it('em português, com o status e as tentativas', () => {
    expect(rotuloDaEntrega(base)).toBe('Entregue (200)');
    expect(rotuloDaEntrega({ ...base, situacao: 'pendente', tentativas: 0 })).toBe('Na fila');
    expect(rotuloDaEntrega({ ...base, situacao: 'pendente', tentativas: 2 })).toBe(
      'Vai tentar de novo (2ª falhou)',
    );
    expect(rotuloDaEntrega({ ...base, situacao: 'falhou', tentativas: 8 })).toBe(
      'Desistiu depois de 8 tentativas',
    );
  });
});

describe('o endereço do webhook', () => {
  it('aceita https público', () => {
    expect(problemaDaUrl('https://erp.exemplo.com.br/crm/avisos?x=1')).toBeNull();
  });
  it('recusa o que o banco recusaria', () => {
    expect(problemaDaUrl('')).toMatch(/Escreva/);
    expect(problemaDaUrl('http://erp.exemplo.com.br')).toMatch(/https/);
    expect(problemaDaUrl('https://localhost:3000/x')).toMatch(/público/);
    expect(problemaDaUrl('https://192.168.0.10/x')).toMatch(/público/);
    expect(problemaDaUrl('https://10.1.2.3/x')).toMatch(/público/);
    expect(problemaDaUrl('https://172.20.0.1/x')).toMatch(/público/);
    expect(problemaDaUrl('https://maquina.local/x')).toMatch(/público/);
    expect(problemaDaUrl('https://' + 'a'.repeat(500) + '.com')).toMatch(/500/);
  });
});

describe('as recusas', () => {
  it('têm frase, e o motivo desconhecido tem uma genérica', () => {
    expect(fraseDaRecusa('em_nome_de_invalido')).toMatch(/admin ou gestor/);
    expect(fraseDaRecusa('qualquer_coisa')).toMatch(/recusou/);
  });
});
