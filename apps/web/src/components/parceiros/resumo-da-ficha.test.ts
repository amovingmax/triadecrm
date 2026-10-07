import { describe, expect, it } from 'vitest';

import {
  camposQueFaltam,
  estadoDoWhatsapp,
  montarRegua,
  presencaPublica,
  ultimoContatoDaFicha,
  ultimoContatoPorExtenso,
  type EtapaDoFunil,
} from './resumo-da-ficha';

/**
 * O que estes testes protegem: o cabeçalho da ficha é texto que decide o que
 * alguém faz em seguida — se escreve agora ou espera, se o parceiro está no
 * meio do funil ou saiu dele. Texto errado ali não dá erro: dá decisão errada.
 */

const CAPTACAO: EtapaDoFunil[] = [
  { id: 11, nome: 'Prospectado', posicao: 1 },
  { id: 12, nome: 'Contatado', posicao: 2 },
  { id: 13, nome: 'Respondeu', posicao: 3 },
  { id: 14, nome: 'Reunião marcada', posicao: 4 },
  { id: 15, nome: 'Publicado (ganho)', posicao: 5 },
  { id: 90, nome: 'Nutrição / dormente', posicao: 90 },
  { id: 98, nome: 'Perdido', posicao: 98 },
  { id: 99, nome: 'Opt-out / não contatar', posicao: 99 },
];

describe('a régua do funil', () => {
  it('só as etapas de trabalho entram: nutrição, perdido e opt-out ficam fora', () => {
    const regua = montarRegua(CAPTACAO, 13);
    expect(regua?.passos.map((p) => p.nome)).toEqual([
      'Prospectado',
      'Contatado',
      'Respondeu',
      'Reunião marcada',
      'Publicado (ganho)',
    ]);
    expect(regua?.total).toBe(5);
  });

  it('o que ficou para trás está feito, a atual é a atual, o resto está por fazer', () => {
    const regua = montarRegua(CAPTACAO, 13);
    expect(regua?.passos.map((p) => p.estado)).toEqual([
      'feito',
      'feito',
      'atual',
      'a_fazer',
      'a_fazer',
    ]);
    expect(regua?.posicao).toBe(3);
    expect(regua?.proxima).toBe('Reunião marcada');
    expect(regua?.fora).toBeNull();
  });

  it('na última etapa não há próxima', () => {
    const regua = montarRegua(CAPTACAO, 15);
    expect(regua?.posicao).toBe(5);
    expect(regua?.proxima).toBeNull();
  });

  it('a ordem é a da posição, não a da lista que veio do banco', () => {
    const embaralhadas = [CAPTACAO[3], CAPTACAO[0], CAPTACAO[2], CAPTACAO[1]].filter(
      (e): e is EtapaDoFunil => e !== undefined,
    );
    expect(montarRegua(embaralhadas, 11)?.passos.map((p) => p.nome)).toEqual([
      'Prospectado',
      'Contatado',
      'Respondeu',
      'Reunião marcada',
    ]);
  });

  it('parceiro perdido sai da régua: nada pintado, e o nome da saída escrito', () => {
    const regua = montarRegua(CAPTACAO, 98);
    expect(regua?.fora).toBe('Perdido');
    expect(regua?.posicao).toBeNull();
    expect(regua?.proxima).toBeNull();
    // Não se sabe até onde ele foi antes de sair: nenhuma etapa aparece como feita.
    expect(regua?.passos.every((p) => p.estado === 'a_fazer')).toBe(true);
  });

  // 07/10/2026: o funil começa no contato. "Prospectado" é a etapa de ENTRADA —
  // o negócio nasce nela, mas ela não é passo da régua.
  describe('com a etapa de entrada marcada', () => {
    const FUNIL: EtapaDoFunil[] = CAPTACAO.map((e) => (e.id === 11 ? { ...e, entrada: true } : e));

    it('a régua começa em Contatado: a entrada não é passo', () => {
      const regua = montarRegua(FUNIL, 13);
      expect(regua?.passos.map((p) => p.nome)).toEqual([
        'Contatado',
        'Respondeu',
        'Reunião marcada',
        'Publicado (ganho)',
      ]);
      expect(regua?.total).toBe(4);
      // "Respondeu" é a etapa 2 de 4, e não mais a 3 de 5.
      expect(regua?.posicao).toBe(2);
      expect(regua?.antes).toBeNull();
    });

    it('quem ainda está na entrada tem a régua apagada, e a próxima é a primeira do funil', () => {
      const regua = montarRegua(FUNIL, 11);
      expect(regua?.antes).toBe('Prospectado');
      expect(regua?.fora).toBeNull();
      expect(regua?.posicao).toBeNull();
      expect(regua?.proxima).toBe('Contatado');
      expect(regua?.passos.every((p) => p.estado === 'a_fazer')).toBe(true);
    });

    it('"ainda não entrou" e "saiu do funil" são coisas diferentes', () => {
      const perdido = montarRegua(FUNIL, 98);
      expect(perdido?.fora).toBe('Perdido');
      expect(perdido?.antes).toBeNull();
      expect(perdido?.proxima).toBeNull();
    });
  });

  it('etapa que não é do funil, ou funil sem etapa de trabalho, não tem régua', () => {
    expect(montarRegua(CAPTACAO, 777)).toBeNull();
    expect(montarRegua([{ id: 98, nome: 'Perdido', posicao: 98 }], 98)).toBeNull();
    expect(montarRegua([], 1)).toBeNull();
  });
});

describe('o último contato, do jeito que se fala', () => {
  // 02/10/2026, 15:00 em Natal (UTC-3).
  const AGORA = new Date('2026-10-02T18:00:00Z');

  it('hoje, ontem e há N dias', () => {
    expect(ultimoContatoPorExtenso('2026-10-02T12:14:00Z', AGORA).texto).toBe('Hoje');
    expect(ultimoContatoPorExtenso('2026-10-01T20:00:00Z', AGORA).texto).toBe('Ontem');
    expect(ultimoContatoPorExtenso('2026-09-27T15:00:00Z', AGORA)).toEqual({
      texto: 'Há 5 dias',
      numero: '5',
    });
  });

  it('conta dias de calendário em Natal, não blocos de 24 horas', () => {
    // 01/10 às 23:30 de Natal é 02/10 02:30 em UTC: para quem olha, foi ontem.
    expect(ultimoContatoPorExtenso('2026-10-02T02:30:00Z', AGORA).texto).toBe('Ontem');
  });

  it('sem data não inventa: "Sem registro"', () => {
    expect(ultimoContatoPorExtenso(null, AGORA).texto).toBe('Sem registro');
    expect(ultimoContatoPorExtenso(undefined, AGORA).texto).toBe('Sem registro');
  });

  it('data no futuro (relógio do banco adiantado) vale como hoje, nunca negativa', () => {
    expect(ultimoContatoPorExtenso('2026-10-03T18:00:00Z', AGORA).texto).toBe('Hoje');
  });
});

describe('o último contato é o mais recente entre o negócio, a conversa e a atividade', () => {
  it('mensagem depois do último registro do negócio vale a mensagem', () => {
    expect(ultimoContatoDaFicha(['2026-10-01T19:58:00Z', '2026-10-02T15:14:00Z'])).toBe(
      '2026-10-02T15:14:00Z',
    );
  });

  it('ligação registrada depois da última mensagem vale a ligação', () => {
    expect(ultimoContatoDaFicha(['2026-10-02T17:00:00Z', '2026-10-01T15:14:00Z', null])).toBe(
      '2026-10-02T17:00:00Z',
    );
  });

  it('com uma data só, vale o que existe; sem nenhuma, não inventa', () => {
    expect(ultimoContatoDaFicha([null, '2026-10-02T15:14:00Z'])).toBe('2026-10-02T15:14:00Z');
    expect(ultimoContatoDaFicha(['2026-10-02T15:14:00Z', undefined])).toBe('2026-10-02T15:14:00Z');
    expect(ultimoContatoDaFicha([null, null, undefined])).toBeNull();
    expect(ultimoContatoDaFicha(['data quebrada'])).toBeNull();
    expect(ultimoContatoDaFicha([])).toBeNull();
  });
});

describe('o estado do WhatsApp', () => {
  const AGORA = new Date('2026-10-02T18:00:00Z');
  const daqui = (min: number) => new Date(AGORA.getTime() + min * 60_000).toISOString();
  const texto = (e: ReturnType<typeof estadoDoWhatsapp>) => e.apoio.map((p) => p.texto).join('');
  const conversa = (janelaExpiraEm: string | null, porLer = 0) => ({
    janelaExpiraEm,
    porLer,
    atendente: 'Heloísa',
    ultimaEntradaEm: null,
  });

  it('janela aberta diz quantas horas faltam', () => {
    const estado = estadoDoWhatsapp(
      { naoContatar: false, conversa: conversa(daqui(21 * 60 + 30)) },
      AGORA,
    );
    expect(estado.titulo).toBe('Janela aberta');
    expect(texto(estado)).toBe('por mais 21 h');
  });

  it('na última hora vira "fechando", em minutos: é a hora de responder', () => {
    const estado = estadoDoWhatsapp({ naoContatar: false, conversa: conversa(daqui(47)) }, AGORA);
    expect(estado.titulo).toBe('Janela fechando');
    expect(texto(estado)).toBe('faltam 47 min');
  });

  it('janela fechada avisa que só modelo aprovado atravessa', () => {
    const estado = estadoDoWhatsapp({ naoContatar: false, conversa: conversa(daqui(-90)) }, AGORA);
    expect(estado.titulo).toBe('Janela fechada');
    expect(texto(estado)).toBe('só modelo aprovado');
  });

  it('conversa em que o parceiro nunca escreveu não diz "fechada": a janela nunca abriu', () => {
    const estado = estadoDoWhatsapp({ naoContatar: false, conversa: conversa(null) }, AGORA);
    expect(estado.titulo).toBe('Sem resposta ainda');
  });

  it('as mensagens por ler entram na linha de apoio, com o dígito marcado', () => {
    const estado = estadoDoWhatsapp(
      { naoContatar: false, conversa: conversa(daqui(600), 2) },
      AGORA,
    );
    expect(texto(estado)).toBe('por mais 10 h · 2 por ler');
    expect(estado.apoio.filter((p) => p.numerico).map((p) => p.texto)).toEqual(['10', '2']);
  });

  it('erro ao ler a conversa não vira "nenhuma mensagem trocada"', () => {
    const estado = estadoDoWhatsapp({ naoContatar: false, conversa: null, falhou: true }, AGORA);
    expect(estado.titulo).toBe('Não carregou');
    expect(texto(estado)).not.toContain('nenhuma mensagem');
  });

  it('sem conversa nenhuma, diz isso', () => {
    const estado = estadoDoWhatsapp({ naoContatar: false, conversa: null }, AGORA);
    expect(estado.titulo).toBe('Sem conversa');
  });

  it('opt-out vem antes de tudo: janela aberta não vira convite a escrever', () => {
    const estado = estadoDoWhatsapp(
      { naoContatar: true, conversa: conversa(daqui(600), 3) },
      AGORA,
    );
    expect(estado.titulo).toBe('Não contatar');
    expect(texto(estado)).not.toContain('por ler');
  });
});

describe('o que falta na ficha', () => {
  const cheia = {
    instagram: 'abracadabra',
    site: 'https://abracadabra.com.br',
    email: 'oi@abracadabra.com.br',
    cnpj: '12345678000195',
    endereco: 'Rua das Flores, 10',
    pessoaFisica: false,
  };

  it('ficha completa não tem o que completar', () => {
    expect(camposQueFaltam(cheia)).toEqual([]);
  });

  it('lista o que falta, na ordem em que a ficha mostra', () => {
    const vazia = {
      ...cheia,
      instagram: null,
      site: null,
      email: null,
      cnpj: null,
      endereco: null,
    };
    expect(camposQueFaltam(vazia).map((f) => f.rotulo)).toEqual([
      'Instagram',
      'Site',
      'E-mail',
      'CNPJ',
      'Endereço',
    ]);
  });

  it('só espaços conta como vazio', () => {
    expect(camposQueFaltam({ ...cheia, site: '   ' }).map((f) => f.campo)).toEqual(['website']);
  });

  it('pessoa física não tem CNPJ a completar', () => {
    expect(camposQueFaltam({ ...cheia, cnpj: null, pessoaFisica: true })).toEqual([]);
  });
});

describe('a presença pública', () => {
  it('nota com vírgula e uma casa', () => {
    expect(presencaPublica({ nota: 4.8, avaliacoes: 132 })).toEqual({
      nota: '4,8',
      avaliacoes: 132,
    });
    expect(presencaPublica({ nota: 5, avaliacoes: 3 })?.nota).toBe('5,0');
  });

  it('mostra o que tem, e some quando não tem nada', () => {
    expect(presencaPublica({ nota: 4.5, avaliacoes: null })).toEqual({
      nota: '4,5',
      avaliacoes: null,
    });
    expect(presencaPublica({ nota: null, avaliacoes: 0 })).toBeNull();
    expect(presencaPublica({ nota: 0, avaliacoes: null })).toBeNull();
    expect(presencaPublica({ nota: null, avaliacoes: null })).toBeNull();
  });
});
