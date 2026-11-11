import { describe, expect, it } from 'vitest';

import {
  deQuemEhAAgenda,
  erroAoGravarQuemAtende,
  explicacaoDaEscolha,
  fraseDaFalha,
  horaCurta,
  lerFalhas,
  lerQuemAtende,
  rotuloDaPessoa,
  rotuloDoPadrao,
} from './calendly';

describe('o aviso do cancelamento que falhou', () => {
  it('diz de quem, de quando e o que fazer, no relógio de Natal', () => {
    // 13h UTC = 10h em Natal.
    expect(fraseDaFalha({ cliente: 'Maria', inicio: '2026-11-20T13:00:00Z' })).toBe(
      'Não consegui cancelar no Calendly o agendamento de Maria, de 20/11 às 10h. Cancele lá e avise o cliente.',
    );
  });

  it('com minutos, a hora leva os minutos', () => {
    expect(horaCurta('2026-11-20T17:30:00Z')).toBe('14h30');
    expect(horaCurta('2026-11-20T12:05:00Z')).toBe('9h05');
    expect(horaCurta('não é data')).toBe('');
  });

  it('sem nome nem horário, a frase continua de pé', () => {
    expect(fraseDaFalha({ cliente: '  ', inicio: null })).toBe(
      'Não consegui cancelar no Calendly o agendamento de um cliente. Cancele lá e avise o cliente.',
    );
  });

  it('o admin vê de quem é a agenda quando não é a dele', () => {
    expect(deQuemEhAAgenda({ donoId: 'b', donoNome: 'Caio' }, 'a')).toBe('Agenda de Caio');
    expect(deQuemEhAAgenda({ donoId: 'a', donoNome: 'Ana' }, 'a')).toBeNull();
    expect(deQuemEhAAgenda({ donoId: null, donoNome: null }, 'a')).toBeNull();
  });

  it('lê as linhas do banco e deixa de fora a linha estranha', () => {
    expect(
      lerFalhas([
        {
          id: 'x1',
          cliente: 'Maria',
          natureza: 'visita',
          inicio: '2026-11-20T13:00:00+00:00',
          situacao: 'recusado',
          motivo_recusa: 'dia_nao_util',
          erro: 'Calendly 401: Unauthenticated',
          dono_id: 'd1',
          dono_nome: 'Ana',
          organization_id: 'o1',
        },
        { cliente: 'sem id' },
        null,
      ]),
    ).toEqual([
      {
        id: 'x1',
        cliente: 'Maria',
        natureza: 'visita',
        inicio: '2026-11-20T13:00:00+00:00',
        erro: 'Calendly 401: Unauthenticated',
        donoId: 'd1',
        donoNome: 'Ana',
        organizationId: 'o1',
      },
    ]);
    expect(lerFalhas(null)).toEqual([]);
  });
});

describe('quem atende o que chega pelo Calendly', () => {
  const resposta = {
    pessoa_id: 'p2',
    email_sem_pessoa: null,
    ultimo_dono_nome: 'Rafael',
    pessoas: [
      { id: 'p1', nome: 'Rafael', papel: 'admin' },
      { id: 'p2', nome: 'Caio', papel: 'sdr' },
      { nome: 'sem id' },
    ],
  };

  it('lê a resposta do banco', () => {
    const quem = lerQuemAtende(resposta);
    expect(quem.pessoaId).toBe('p2');
    expect(quem.pessoas.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(lerQuemAtende(null)).toEqual({
      pessoaId: null,
      emailSemPessoa: null,
      ultimoDonoNome: null,
      pessoas: [],
    });
  });

  it('o padrão diz quem é hoje, quando o banco sabe', () => {
    expect(rotuloDoPadrao({ ultimoDonoNome: 'Rafael' })).toBe(
      'O dono da conta do Calendly (hoje, Rafael)',
    );
    expect(rotuloDoPadrao({ ultimoDonoNome: null })).toBe('O dono da conta do Calendly');
  });

  it('a pessoa vem com o papel', () => {
    expect(rotuloDaPessoa({ id: 'p2', nome: 'Caio', papel: 'sdr' })).toBe('Caio · SDR');
    expect(rotuloDaPessoa({ id: 'p3', nome: 'Zé', papel: '?' })).toBe('Zé');
  });

  it('a explicação acompanha a escolha', () => {
    expect(explicacaoDaEscolha(lerQuemAtende(resposta))).toContain('entra na agenda de Caio');
    expect(
      explicacaoDaEscolha(
        lerQuemAtende({ ...resposta, pessoa_id: null, email_sem_pessoa: 'x@fora.local' }),
      ),
    ).toContain('O e-mail gravado (x@fora.local) não é de ninguém ativo');
    expect(explicacaoDaEscolha(lerQuemAtende({ ...resposta, pessoa_id: null }))).toContain(
      'Sem escolha',
    );
  });

  it('os recados de recusa', () => {
    expect(erroAoGravarQuemAtende('42501')).toContain('Só um admin');
    expect(erroAoGravarQuemAtende('22023')).toContain('não está ativa');
    expect(erroAoGravarQuemAtende(undefined)).toContain('Não deu para gravar');
  });
});
