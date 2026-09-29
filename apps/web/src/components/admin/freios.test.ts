import { describe, expect, it } from 'vitest';

import { montarFreios } from './dados';

/**
 * Os três cartões de "Os freios", em Ajustes → Atendimento.
 *
 * ESTE ARQUIVO NASCEU DE UM DEFEITO EM PRODUÇÃO. Rafael abriu Ajustes em
 * 29/09/2026 e o cartão do robô estava VERMELHO: "O fusível disparou (sem
 * motivo): o robô está mudo", com um botão "Religar o bot" ao lado. No banco o
 * robô estava ativo e o fusível intacto.
 *
 * A causa: o mapeamento passava `freio` por um ajudante que devolve `{}` para
 * nulo, e a tela acende o alarme quando `freio !== null`. `{}` nunca é null, e
 * o alarme tocava sempre — inclusive num banco recém-criado, onde não há nada
 * para dar errado.
 *
 * Alarme que toca sempre é alarme que ninguém escuta, e o botão ao lado convida
 * a mexer no que não está quebrado. Por isso o caso "nada errado" é a primeira
 * asserção do arquivo.
 */
describe('montarFreios', () => {
  it('robô ativo e sem fusível não acende alarme nenhum', () => {
    const f = montarFreios({
      robo: { falas_por_conversa: 6, fusivel_por_hora: 120, falas_na_ultima_hora: 3, ativo: true, freio: null },
    });
    expect(f.robo.freio).toBeNull();
    expect(f.robo.ativo).toBe(true);
  });

  it('e o fusível AUSENTE também não — chave que não veio não é fusível disparado', () => {
    const f = montarFreios({ robo: { ativo: true } });
    expect(f.robo.freio).toBeNull();
  });

  it('quando o fusível dispara de verdade, o motivo chega inteiro à tela', () => {
    const f = montarFreios({
      robo: { ativo: false, freio: { parado_em: '2026-09-29T12:00:00-03:00', motivo: 'pingue_pongue' } },
    });
    expect(f.robo.freio?.motivo).toBe('pingue_pongue');
    expect(f.robo.ativo).toBe(false);
  });

  it('o número sem resposta da Meta fica em null, e não em zero', () => {
    // Zero seria "a Meta disse que o teto é zero", que é outra coisa: a tela
    // escreve "Ainda não perguntamos à Meta" justamente quando é null.
    const f = montarFreios({ numero: { usados: 4 } });
    expect(f.numero.teto_dia).toBeNull();
    expect(f.numero.qualidade).toBeNull();
    expect(f.numero.usados).toBe(4);
  });

  it('RPC vazia não quebra a tela: tudo zero, nada em alarme', () => {
    const f = montarFreios(null);
    expect(f.robo.freio).toBeNull();
    expect(f.orcamento.gasto_usd).toBe(0);
    expect(f.orcamento.situacao).toBe('ok');
  });
});
