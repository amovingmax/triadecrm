import { describe, expect, it } from 'vitest';

import { frase, MOTIVO_DA_CRIACAO, MOTIVO_DO_LINK } from './dados';
import { CLAUSULAS, TERMO_VERSAO, textoCanonicoDoTermo } from './termo';
import { lerPreCadastro, lerRascunho, podeEmitirLink, ROTULO_SITUACAO } from './tipos';

/**
 * As RPCs do pré-cadastro devolvem `jsonb`, ou seja `unknown`. Estes testes cobrem
 * as formas que o painel pode receber de verdade: o rascunho que ainda não existe,
 * o payload completo e os payloads torto (campo faltando, lista onde era objeto).
 */

describe('lerPreCadastro', () => {
  it('lê o payload de quem ainda não tem rascunho', () => {
    const p = lerPreCadastro({ existe: false, tem_autorizacao: false });
    expect(p.existe).toBe(false);
    expect(p.temAutorizacao).toBe(false);
    expect(p.situacao).toBe('pending');
    expect(p.rascunho).toEqual([]);
    expect(p.linhaDoTempo).toEqual([]);
  });

  it('lê o payload completo, incluindo a linha do tempo', () => {
    const p = lerPreCadastro({
      existe: true,
      id: '8f2c0a5e-0000-4000-8000-000000000001',
      status: 'link_sent',
      publicado: false,
      rascunho: { nome_exibicao: 'Buffet Aurora', cidade: 'Natal', categorias: ['Buffet', 'Bar'] },
      origem: 'Instagram (curadoria manual)',
      fotos_publicas: 0,
      tem_autorizacao: true,
      link_ativo: true,
      link_expira_em: '2026-09-11T12:00:00Z',
      link_enviado_em: '2026-09-04T12:00:00Z',
      linha_do_tempo: [
        { evento: 'pre_registration_created', quando: '2026-09-04T11:00:00Z', quem: 'cs' },
        { evento: 'claim_link_sent', quando: '2026-09-04T12:00:00Z', quem: 'cs' },
      ],
    });

    expect(p.existe).toBe(true);
    expect(p.situacao).toBe('link_sent');
    expect(ROTULO_SITUACAO[p.situacao]).toBe('Link enviado');
    expect(p.temAutorizacao).toBe(true);
    expect(p.linkAtivo).toBe(true);
    expect(p.fotosPublicas).toBe(0);
    expect(p.linhaDoTempo).toHaveLength(2);
    expect(p.rascunho).toEqual([
      { campo: 'Nome', valor: 'Buffet Aurora' },
      { campo: 'Categorias', valor: 'Buffet, Bar' },
      { campo: 'Cidade', valor: 'Natal' },
    ]);
  });

  it('não quebra com situação desconhecida nem com linha do tempo torta', () => {
    const p = lerPreCadastro({
      existe: true,
      status: 'situacao_que_nao_existe',
      linha_do_tempo: [{ evento: 'claimed' }, null, 'texto solto', { quando: '2026-09-04' }],
    });
    expect(p.situacao).toBe('pending');
    expect(p.linhaDoTempo).toEqual([]);
  });

  it('devolve o estado seguro quando o payload não é objeto', () => {
    for (const bruto of [null, undefined, 'ok', 42, []]) {
      const p = lerPreCadastro(bruto);
      expect(p.existe).toBe(false);
      expect(p.temAutorizacao).toBe(false);
      expect(p.publicado).toBe(false);
    }
  });
});

describe('lerRascunho', () => {
  it('põe os campos na ordem de leitura e ignora os vazios', () => {
    const linhas = lerRascunho({
      site: 'https://buffetaurora.com.br',
      bairro: '',
      nome_exibicao: 'Buffet Aurora',
      instagram: 'buffetaurora',
      cidade: 'Natal',
    });
    expect(linhas.map((l) => l.campo)).toEqual(['Nome', 'Cidade', 'Instagram', 'Site']);
  });

  it('joga campo sem rótulo para o fim, com a chave crua', () => {
    const linhas = lerRascunho({ zzz_campo_novo: 'valor', nome_exibicao: 'Aurora' });
    expect(linhas).toEqual([
      { campo: 'Nome', valor: 'Aurora' },
      { campo: 'zzz_campo_novo', valor: 'valor' },
    ]);
  });

  it('achata lista e número, e descarta lista vazia', () => {
    expect(lerRascunho({ categorias: [], anos_de_mercado: 12 })).toEqual([
      { campo: 'Anos de mercado', valor: '12' },
    ]);
  });
});

describe('podeEmitirLink', () => {
  const base = lerPreCadastro({ existe: true, tem_autorizacao: true });

  it('exige rascunho e autorização', () => {
    expect(podeEmitirLink(base)).toBe(true);
    expect(podeEmitirLink({ ...base, temAutorizacao: false })).toBe(false);
    expect(podeEmitirLink({ ...base, existe: false })).toBe(false);
  });

  it('não emite para rascunho encerrado nem já reivindicado', () => {
    expect(podeEmitirLink({ ...base, recusadoEm: '2026-09-04T12:00:00Z' })).toBe(false);
    expect(podeEmitirLink({ ...base, apagadoEm: '2026-09-04T12:00:00Z' })).toBe(false);
    expect(podeEmitirLink({ ...base, reivindicadoEm: '2026-09-04T12:00:00Z' })).toBe(false);
  });
});

describe('frase de motivo', () => {
  it('traduz os motivos que as RPCs devolvem', () => {
    expect(frase(MOTIVO_DO_LINK, 'sem_autorizacao')).toContain('autorização registrada');
    expect(frase(MOTIVO_DA_CRIACAO, 'contato_suprimido')).toContain('não ser procurado');
  });

  it('tem saída para motivo que a tela não conhece', () => {
    expect(frase(MOTIVO_DO_LINK, 'motivo_do_futuro')).toContain('Avise no grupo do time');
  });
});

describe('texto canônico do termo', () => {
  it('começa pela versão e traz todas as cláusulas na ordem', () => {
    const texto = textoCanonicoDoTermo();
    expect(texto.startsWith(`Termo de autorização Komune ${TERMO_VERSAO}`)).toBe(true);
    for (const c of CLAUSULAS) {
      expect(texto).toContain(c.titulo);
      for (const p of c.paragrafos) expect(texto).toContain(p);
    }
  });

  it('é estável entre chamadas — é ele que vira o hash da prova', () => {
    expect(textoCanonicoDoTermo()).toBe(textoCanonicoDoTermo());
  });

  it('destaca a cláusula de dados e a de fotos (R06 PRE-06)', () => {
    const destacadas = CLAUSULAS.filter((c) => c.destaque).map((c) => c.id);
    expect(destacadas).toEqual(['dados', 'fotos']);
  });
});
