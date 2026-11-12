import { describe, expect, it } from 'vitest';

import {
  comecoPadrao,
  lerEnvio,
  lerPrevia,
  porqueOLinkNaoSai,
  previaComOComeco,
  recadoDoLink,
  type PreviaDoLink,
} from './link-da-agenda';

/**
 * "Enviar link da agenda" em Conversas (11/11/2026, só na Imova). Estes testes seguram
 * as frases de cada recusa do contrato, o porquê da opção desligada fora da janela e a
 * prévia com o começo que a pessoa escreveu.
 */

const LINK =
  'https://calendly.com/contato-imovaimobiliaria/30min?name=Maria&a1=Visita&utm_content=k3j9x2m1pq';

const VISITA: PreviaDoLink = {
  texto: `Oi, Maria! Para escolher o melhor horário da visita, é só tocar no link:\n\nImóvel: IM0003 · Rua das Algas, 120, Ponta Negra, Natal\n${LINK}`,
  link: LINK,
  codigo: 'IM0003',
  endereco: 'Rua das Algas, 120, Ponta Negra, Natal',
  titulo: 'Casa com 3 quartos',
};

const REUNIAO: PreviaDoLink = {
  texto: `Oi, Maria! Escolha o horário da reunião por aqui:\n${LINK}`,
  link: LINK,
  codigo: null,
  endereco: null,
  titulo: null,
};

describe('a prévia com o começo que a pessoa escreveu', () => {
  it('sem começo, é a prévia do banco letra por letra', () => {
    expect(previaComOComeco(VISITA, '')).toBe(VISITA.texto);
    expect(previaComOComeco(VISITA, '   ')).toBe(VISITA.texto);
  });

  it('o começo dela entra no lugar do padrão, e o imóvel e o link continuam', () => {
    expect(previaComOComeco(VISITA, ' Maria, segue o link para a visita: ')).toBe(
      `Maria, segue o link para a visita:\n\nImóvel: IM0003 · Rua das Algas, 120, Ponta Negra, Natal\n${LINK}`,
    );
    expect(previaComOComeco(REUNIAO, 'Pode escolher aqui:')).toBe(`Pode escolher aqui:\n${LINK}`);
  });

  it('o exemplo do campo é o começo padrão do banco', () => {
    expect(comecoPadrao(VISITA)).toBe(
      'Oi, Maria! Para escolher o melhor horário da visita, é só tocar no link:',
    );
    expect(comecoPadrao(REUNIAO)).toBe('Oi, Maria! Escolha o horário da reunião por aqui:');
  });

  it('prévia que já começa pelo imóvel ganha o começo dela em cima', () => {
    const semComeco = { ...VISITA, texto: `IM0003 · Rua das Algas, 120\n${LINK}` };
    expect(comecoPadrao(semComeco)).toBe('');
    expect(previaComOComeco(semComeco, 'Olá!')).toBe(
      `Olá!\n\nIM0003 · Rua das Algas, 120\n${LINK}`,
    );
  });
});

describe('o que o banco devolve', () => {
  it('a prévia precisa de texto e de link', () => {
    expect(lerPrevia({ ok: true, texto: 'Oi', link: LINK, codigo: 'IM0003' })).toMatchObject({
      ok: true,
      codigo: 'IM0003',
      endereco: null,
    });
    expect(lerPrevia({ ok: true, texto: 'Oi' })).toEqual({
      ok: false,
      motivo: 'resposta_estranha',
      detalhe: null,
    });
    expect(lerPrevia({ ok: false, motivo: 'sem_link_configurado' })).toEqual({
      ok: false,
      motivo: 'sem_link_configurado',
      detalhe: null,
    });
    expect(lerPrevia(null)).toMatchObject({ ok: false, motivo: 'resposta_estranha' });
  });

  it('o envio traz a mensagem, e a recusa da porteira traz o detalhe', () => {
    expect(lerEnvio({ ok: true, mensagem_id: 'm1', link: LINK, convite_id: 'c1' })).toEqual({
      ok: true,
      mensagemId: 'm1',
      link: LINK,
    });
    expect(lerEnvio({ ok: false, motivo: 'nao_pode_enviar', detalhe: 'numero_suprimido' })).toEqual(
      {
        ok: false,
        motivo: 'nao_pode_enviar',
        detalhe: 'numero_suprimido',
      },
    );
  });
});

describe('cada recusa do contrato em português claro', () => {
  it('tem frase própria, sem código do banco', () => {
    for (const motivo of [
      'sem_permissao',
      'tipo_invalido',
      'visita_sem_imovel',
      'anuncio_invalido',
      'sem_link_configurado',
      'fora_da_janela',
      'nao_pode_enviar',
    ]) {
      const frase = recadoDoLink(motivo);
      expect(frase).not.toMatch(/_/);
      expect(frase).not.toBe(recadoDoLink('motivo_que_nao_existe'));
    }
    expect(recadoDoLink('sem_link_configurado')).toMatch(/Link do Calendly/);
    expect(recadoDoLink('fora_da_janela')).toMatch(/24 h/);
  });

  it('"não pode enviar" usa a frase da porteira quando ela vem no detalhe', () => {
    expect(recadoDoLink('nao_pode_enviar', 'numero_suprimido')).toBe(
      'Este número está na lista de supressão. Nada sai para ele.',
    );
    expect(recadoDoLink('nao_pode_enviar', 'detalhe_desconhecido')).toBe(
      'O WhatsApp não deixou a mensagem sair agora.',
    );
  });
});

describe('a opção desligada fora da janela', () => {
  const aberta = {
    situacao: 'aberta',
    expiraEm: '2026-11-12T10:00:00Z',
    restanteMin: 300,
  } as const;

  it('com a janela aberta não há porquê', () => {
    expect(porqueOLinkNaoSai({ janela: aberta })).toBeNull();
  });

  it('fechada ou nunca aberta, diz o porquê no tom do relógio da janela', () => {
    expect(
      porqueOLinkNaoSai({
        janela: { situacao: 'fechada', expirouEm: '2026-11-10T10:00:00Z', fechadaHaMin: 90 },
      }),
    ).toMatch(/^Fora da janela de 24 h, a Meta só deixa passar modelo aprovado/);
    expect(porqueOLinkNaoSai({ janela: { situacao: 'nunca' } })).toMatch(
      /só existe depois que o cliente escreve/,
    );
  });

  it('quem pediu para sair e o contato bloqueado não recebem, nem com a janela aberta', () => {
    expect(porqueOLinkNaoSai({ janela: aberta, naoContatar: true })).toMatch(
      /pediu para não receber/,
    );
    expect(porqueOLinkNaoSai({ janela: aberta, bloqueada: true })).toMatch(/^Contato bloqueado/);
  });
});
