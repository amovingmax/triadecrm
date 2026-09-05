/**
 * O desfazer de 48 h, do lado da tela (RF-BAS-17; laudo §3.6, §3.7 e §3.12g).
 *
 * Três coisas que a tela errava, e que só somem se forem medidas aqui:
 *   · §3.6 — o recibo afirmava uma causa falsa ("alguém já trabalhou") para
 *     fichas que ninguém tinha tocado. A frase agora sai de uma função pura, e
 *     ela não pode voltar a inventar trabalho humano.
 *   · §3.7 — o botão de desfazer era oferecido a quem importa (sdr), o servidor
 *     respondia 42501, e o tradutor de erros dizia "o servidor não respondeu
 *     como esperado" — escondendo o único fato acionável: chame um gestor.
 *   · §3.12g — "Decidir as N que ficaram na fila" contava LINHAS. Duas linhas
 *     da mesma empresa viram UM candidato; linha que não gerou candidato não vai
 *     para fila nenhuma. Medido no banco em 05/09/2026 com a planilha-ponte de
 *     verdade mais uma segunda ocorrência de "Rios Recepções": o recibo dizia
 *     31 e a fila do Radar recebia 30.
 */
import { describe, expect, it } from 'vitest';

import { ErroDoBanco, candidatosNaFila, fraseDoDesfazer, mensagemDoErro } from './dados';
import { podeDesfazerLote } from './tipos';
import type { Decisao, LinhaGravada } from './tipos';

function linha(
  decisao: Decisao,
  candidateId: string | null,
  motivo: string | null = null,
  nome = 'Empresa',
): LinhaGravada {
  return {
    linha: 2,
    nome,
    decisao,
    motivo,
    organization_id: null,
    organizacao: null,
    candidate_id: candidateId,
  };
}

describe('§3.7 — quem desfaz um lote', () => {
  it('só admin e gestor: é o espelho de app.is_manager()', () => {
    expect(podeDesfazerLote('admin')).toBe(true);
    expect(podeDesfazerLote('gestor')).toBe(true);
  });

  it('quem importa e não desfaz: a Heloísa é sdr', () => {
    expect(podeDesfazerLote('sdr')).toBe(false);
    expect(podeDesfazerLote('embaixador')).toBe(false);
    expect(podeDesfazerLote('leitura')).toBe(false);
    expect(podeDesfazerLote('financeiro')).toBe(false);
  });
});

describe('§3.7 — o 403 do desfazer chega traduzido', () => {
  it('diz que só gestor desfaz, em vez de "o servidor não respondeu como esperado"', () => {
    // Exatamente o que o PostgREST devolve hoje: code 42501, e a mensagem em
    // pt-BR do `raise exception` de public.esteira_desfazer_lote.
    const erro = new ErroDoBanco('Papel sdr não desfaz importação', '42501');
    expect(mensagemDoErro(erro)).toMatch(/gestor/i);
    expect(mensagemDoErro(erro)).not.toMatch(/não respondeu como esperado/i);
  });

  it('não confunde com o 403 de quem nem importa', () => {
    const erro = new ErroDoBanco('Papel leitura não importa planilha', '42501');
    expect(mensagemDoErro(erro)).toMatch(/não importa planilha/i);
  });

  it('continua traduzindo as recusas com nome próprio', () => {
    expect(mensagemDoErro(new Error('recusado:janela_de_48h_encerrada'))).toMatch(/48 horas/i);
  });
});

describe('§3.6 — a frase do recibo não inventa trabalho humano', () => {
  it('lote inteiro removido: diz só isso', () => {
    expect(fraseDoDesfazer({ organizacoes: 33, preservadas: 0 })).toBe('33 fichas removidas.');
  });

  it('uma ficha só: singular', () => {
    expect(fraseDoDesfazer({ organizacoes: 1, preservadas: 0 })).toBe('1 ficha removida.');
  });

  it('nada a remover não é culpa de ninguém', () => {
    expect(fraseDoDesfazer({ organizacoes: 0, preservadas: 0 })).toMatch(/não tinha ficha/i);
  });

  it('ficha preservada é explicada pelo que o banco de fato confere', () => {
    const frase = fraseDoDesfazer({ organizacoes: 2, preservadas: 3 });
    expect(frase).toMatch(/2 fichas removidas/);
    expect(frase).toMatch(/3 ficaram de pé/);
    // A causa verdadeira, e não "alguém já trabalhou" — que era falso para toda
    // ficha recém-importada, porque quem a tocara era o próprio importador.
    expect(frase).toMatch(/etapa|autorização|ligação|conversa/i);
    expect(frase).not.toMatch(/alguém já trabalhou/i);
  });

  it('nenhuma removida e todas presas: também não acusa ninguém', () => {
    const frase = fraseDoDesfazer({ organizacoes: 0, preservadas: 4 });
    expect(frase).toMatch(/4/);
    expect(frase).not.toMatch(/alguém já trabalhou/i);
  });
});

describe('§3.12g — a fila do Radar conta candidatos, não linhas', () => {
  it('duas linhas da mesma empresa são UM candidato', () => {
    expect(
      candidatosNaFila([
        linha('duplicata', 'c1', null, 'Rios Recepções'),
        linha('duplicata', 'c1', null, 'Rios Recepções'),
        linha('duplicata', 'c2', null, 'Grupo Eden'),
      ]),
    ).toBe(2);
  });

  // Estado real, medido em 05/09/2026 depois de desfazer um lote e reimportar a
  // mesma planilha: 64 linhas em "vai para revisão", das quais 34 voltam com
  // `ja_revisado` — candidato que existe mas NÃO está mais na fila (o status
  // dele não é `novo`, e `radar_fila` filtra por `novo`). Mandar decidir 64,
  // ou mesmo 34, é mandar procurar o que não está lá.
  it('candidato já revisado não está na fila do Radar', () => {
    expect(
      candidatosNaFila([
        linha('revisao', 'c1', 'ja_revisado'),
        linha('revisao', 'c2', 'categoria_desconhecida'),
        linha('revisao', null, 'sem_candidato'),
      ]),
    ).toBe(1);
  });

  it('linha que não gerou candidato não vai para fila nenhuma', () => {
    expect(candidatosNaFila([linha('revisao', null), linha('revisao', 'c9')])).toBe(1);
  });

  it('só duplicata e revisão vão para a fila', () => {
    expect(
      candidatosNaFila([
        linha('entra', 'c1'),
        linha('repetida', 'c2'),
        linha('nao_contatar', 'c3'),
        linha('erro', null),
        linha('duplicata', 'c4'),
      ]),
    ).toBe(1);
  });

  it('sem nada para decidir, é zero (e o botão some)', () => {
    expect(candidatosNaFila([linha('entra', 'c1')])).toBe(0);
  });
});
