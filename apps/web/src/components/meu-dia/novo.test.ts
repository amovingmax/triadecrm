import { describe, expect, it } from 'vitest';

import {
  acaoDoItem,
  BLOCO_JANELA_ABERTA,
  BLOCO_SO_MODELO,
  blocosDoFiltro,
  corDoDisco,
  fracaoDoExpediente,
  fraseDaJanela,
  iniciais,
  primeiraDaFila,
  horasParaFechar,
  ladoDaJanela,
  motivoQueSobra,
  nomeDaSaudacao,
  pastilhaDaJanela,
  porOndeComecar,
  ritmoDaMeta,
  rotuloDaAcao,
  separarPelaJanela,
  textoDaPrevia,
} from './novo';
import { agruparFila, type ItemDoDia } from './tipos';

/**
 * O Meu dia novo da Imova (módulo `meuDiaNovo`). O que estes testes travam: a
 * leitura da janela pelas frases EXATAS que `public.meu_dia` escreve (se o banco
 * mudar a frase, é aqui que quebra, e não na tela em silêncio), a ordem do banco
 * preservada ao partir o bloco, e as contas do ritmo.
 */

function item(parcial: Partial<ItemDoDia>): ItemDoDia {
  return {
    prioridade: 3,
    tipo: 'tarefa_atrasada',
    motivo: 'Tarefa vencida há 2 h',
    titulo: 'Ligar D+1',
    quando: null,
    atrasoHoras: null,
    tarefaId: null,
    atividadeId: null,
    negocioId: null,
    organizacaoId: 'org-1',
    organizacao: 'Marina Costa',
    bairro: 'Ponta Negra',
    categoria: null,
    temperatura: null,
    funil: null,
    etapa: null,
    atendente: null,
    ...parcial,
  };
}

// As três frases que o banco escreve (20261002180000, item 0 de `public.meu_dia`).
const FECHOU = 'A janela de 24 h fechou: daqui só sai modelo aprovado';
const FECHA_EM = (h: number) => `A janela de 24 h fecha em ${h} h`;
const SEM_JANELA = 'Respondeu e ninguém falou com ele desde então';

function conversa(motivo: string, parcial: Partial<ItemDoDia> = {}): ItemDoDia {
  return item({
    prioridade: 0,
    tipo: 'conversa_esperando',
    motivo,
    titulo: 'Responder no WhatsApp',
    ...parcial,
  });
}

describe('a janela de 24 h, lida do motivo', () => {
  it('fechada só quando o banco diz que fechou', () => {
    expect(ladoDaJanela(conversa(FECHOU))).toBe('fechada');
    expect(ladoDaJanela(conversa(FECHA_EM(3)))).toBe('aberta');
  });

  it('sem janela conhecida fica do lado aberto, que é o erro barato', () => {
    expect(ladoDaJanela(conversa(SEM_JANELA))).toBe('aberta');
  });

  it('o que não é conversa não tem janela', () => {
    expect(ladoDaJanela(item({}))).toBeNull();
    expect(horasParaFechar(item({ motivo: FECHA_EM(2) }))).toBeNull();
  });

  it('lê as horas que faltam', () => {
    expect(horasParaFechar(conversa(FECHA_EM(1)))).toBe(1);
    expect(horasParaFechar(conversa(FECHA_EM(20)))).toBe(20);
    expect(horasParaFechar(conversa(FECHOU))).toBeNull();
    expect(horasParaFechar(conversa(SEM_JANELA))).toBeNull();
  });

  it('a pastilha diz quanto falta, e pede pressa até 3 h', () => {
    expect(pastilhaDaJanela(conversa(FECHA_EM(3)))).toEqual({
      texto: 'fecha em ',
      numero: '3 h',
      pressa: true,
    });
    expect(pastilhaDaJanela(conversa(FECHA_EM(4)))?.pressa).toBe(false);
    expect(pastilhaDaJanela(conversa(FECHOU))).toBeNull();
  });

  it('a frase da janela sai da linha: o bloco ou a pastilha já disseram', () => {
    expect(motivoQueSobra(conversa(FECHOU))).toBeNull();
    expect(motivoQueSobra(conversa(FECHA_EM(5)))).toBeNull();
    expect(motivoQueSobra(conversa(SEM_JANELA))).toBe(SEM_JANELA);
    expect(motivoQueSobra(item({ motivo: 'Tarefa vencida há 2 h' }))).toBe('Tarefa vencida há 2 h');
  });
});

describe('separarPelaJanela', () => {
  const fila = [
    conversa(FECHOU, { organizacaoId: 'a', organizacao: 'A' }),
    conversa(FECHA_EM(2), { organizacaoId: 'b', organizacao: 'B' }),
    conversa(FECHOU, { organizacaoId: 'c', organizacao: 'C' }),
    conversa(SEM_JANELA, { organizacaoId: 'd', organizacao: 'D' }),
    item({ prioridade: 3, organizacaoId: 'e', organizacao: 'E' }),
  ];

  it('parte o bloco de quem respondeu em aberta e só modelo, no topo e nessa ordem', () => {
    const blocos = separarPelaJanela(agruparFila(fila));
    expect(blocos.map((b) => b.id)).toEqual([BLOCO_JANELA_ABERTA.id, BLOCO_SO_MODELO.id, 'agora']);
  });

  it('mantém a ordem do banco dentro de cada parte', () => {
    const [abertos, fechados] = separarPelaJanela(agruparFila(fila));
    expect(abertos?.itens.map((i) => i.organizacao)).toEqual(['B', 'D']);
    expect(fechados?.itens.map((i) => i.organizacao)).toEqual(['A', 'C']);
  });

  it('a parte vazia some', () => {
    const blocos = separarPelaJanela(agruparFila([conversa(FECHOU)]));
    expect(blocos.map((b) => b.id)).toEqual([BLOCO_SO_MODELO.id]);
  });

  it('não toca nos outros blocos nem perde item', () => {
    const antes = agruparFila(fila);
    const depois = separarPelaJanela(antes);
    const contar = (bs: typeof antes) => bs.reduce((n, b) => n + b.itens.length, 0);
    expect(contar(depois)).toBe(contar(antes));
    expect(depois.at(-1)).toBe(antes.at(-1));
  });

  it('a frase de abertura aponta a primeira conversa com janela aberta', () => {
    expect(porOndeComecar(separarPelaJanela(agruparFila(fila)))).toBe(
      'Comece por B: a janela fecha em 2 h.',
    );
    expect(porOndeComecar(separarPelaJanela(agruparFila([conversa(FECHOU)])))).toBeNull();
    expect(
      porOndeComecar(separarPelaJanela(agruparFila([conversa(SEM_JANELA, { organizacao: null })]))),
    ).toBe('Comece por quem escreveu de fora da base: respondeu e está esperando.');
  });
});

describe('rotuloDaAcao', () => {
  it('diz em palavras o que o toque faz', () => {
    expect(rotuloDaAcao(conversa(FECHA_EM(3)))).toBe('Responder');
    expect(rotuloDaAcao(conversa(FECHOU))).toBe('Enviar modelo');
    expect(rotuloDaAcao(item({ tipo: 'desfecho_pendente' }))).toBe('Registrar resultado');
    expect(rotuloDaAcao(item({ tipo: 'sem_proxima_acao' }))).toBe('Combinar próximo passo');
    expect(rotuloDaAcao(item({ tipo: 'negocio_parado' }))).toBe('Combinar próximo passo');
    expect(rotuloDaAcao(item({ tipo: 'tarefa_hoje', titulo: 'Mandar a proposta' }))).toBe(
      'Abrir ficha',
    );
    expect(rotuloDaAcao(item({ tipo: 'reuniao_proxima' }))).toBe('Abrir ficha');
  });

  it('a tarefa de ligar diz "Ligar", pela mesma regra do ícone', () => {
    expect(acaoDoItem(item({ tipo: 'tarefa_hoje', titulo: 'Ligar D+1' }))).toEqual({
      rotulo: 'Ligar',
      icone: 'ligar',
      destaque: false,
    });
    expect(rotuloDaAcao(item({ tipo: 'proxima_acao_atrasada', titulo: 'Telefonar' }))).toBe(
      'Ligar',
    );
    // A reunião com "Ligar" no título continua abrindo a ficha: o verbo só vale
    // para tarefa e próxima ação.
    expect(rotuloDaAcao(item({ tipo: 'reuniao_proxima', titulo: 'Ligar D+1' }))).toBe(
      'Abrir ficha',
    );
  });

  it('só a conversa com a janela aberta ganha o botão cheio', () => {
    expect(acaoDoItem(conversa(FECHA_EM(3))).destaque).toBe(true);
    expect(acaoDoItem(conversa(FECHOU)).destaque).toBe(false);
    expect(acaoDoItem(conversa(FECHA_EM(3)), { somenteLeitura: true }).destaque).toBe(false);
  });

  it('no dia de outra pessoa, toda linha só abre a ficha', () => {
    expect(rotuloDaAcao(conversa(FECHOU), { somenteLeitura: true })).toBe('Ver ficha');
  });
});

describe('textoDaPrevia', () => {
  it('texto entre aspas, numa linha só', () => {
    expect(
      textoDaPrevia({ type: 'text', body: 'Consigo visitar\nsábado?', transcript: null }),
    ).toBe('“Consigo visitar sábado?”');
  });

  it('mídia vira frase, e o áudio transcrito mostra o que foi dito', () => {
    expect(textoDaPrevia({ type: 'audio', body: null, transcript: null })).toBe('Enviou um áudio');
    expect(textoDaPrevia({ type: 'audio', body: null, transcript: ' Me liga amanhã ' })).toBe(
      'Áudio: “Me liga amanhã”',
    );
    expect(textoDaPrevia({ type: 'image', body: null, transcript: null })).toBe('Enviou uma foto');
    expect(textoDaPrevia({ type: 'image', body: 'a cozinha', transcript: null })).toBe(
      'Foto: “a cozinha”',
    );
    expect(textoDaPrevia({ type: 'document', body: 'x.pdf', transcript: null })).toBe(
      'Enviou um documento',
    );
  });

  it('nada para mostrar vira null, e a linha fica sem prévia', () => {
    expect(textoDaPrevia({ type: 'text', body: '   ', transcript: null })).toBeNull();
    expect(textoDaPrevia({ type: 'system', body: 'x', transcript: null })).toBeNull();
  });
});

describe('o ritmo da meta', () => {
  // 15:42 em Fortaleza (UTC-3) = 18:42 UTC: 6h42 de um expediente de 9h.
  const tarde = new Date('2026-11-10T18:42:00Z');

  it('conta o expediente no relógio de Fortaleza, de 9h às 18h', () => {
    expect(fracaoDoExpediente(new Date('2026-11-10T11:00:00Z'))).toBe(0); // 08:00
    expect(fracaoDoExpediente(new Date('2026-11-10T12:00:00Z'))).toBe(0); // 09:00
    expect(fracaoDoExpediente(tarde)).toBeCloseTo(6.7 / 9, 5);
    expect(fracaoDoExpediente(new Date('2026-11-10T22:30:00Z'))).toBe(1); // 19:30
  });

  it('abaixo do ritmo diz quanto falta para alcançar', () => {
    const r = ritmoDaMeta(6, 15, fracaoDoExpediente(tarde));
    expect(r.situacao).toBe('abaixo');
    expect(r.esperado).toBe(11);
    expect(r.frase).toBe('5 abaixo do ritmo');
    expect(r.marca).toBe(74);
  });

  it('no ritmo quando já fez o esperado para agora', () => {
    expect(ritmoDaMeta(7, 10, fracaoDoExpediente(tarde)).situacao).toBe('no_ritmo');
  });

  it('meta batida não tem marca; sem meta não tem ritmo', () => {
    expect(ritmoDaMeta(2, 2, 0.5)).toMatchObject({ situacao: 'batida', marca: null });
    expect(ritmoDaMeta(12, null, 0.5)).toMatchObject({ situacao: 'sem_meta', marca: null });
    expect(ritmoDaMeta(12, 0, 0.5).situacao).toBe('sem_meta');
  });

  it('antes das 9h não há marca colada no zero', () => {
    expect(ritmoDaMeta(0, 40, 0)).toMatchObject({ situacao: 'cedo', marca: null });
  });

  it('depois do expediente, a frase é o que faltou', () => {
    expect(ritmoDaMeta(30, 40, 1).frase).toBe('Faltaram 10');
  });
});

describe('nomeDaSaudacao', () => {
  it('o primeiro nome, como sempre', () => {
    expect(nomeDaSaudacao('Gustavo Teixeira')).toBe('Gustavo');
    expect(nomeDaSaudacao('  ')).toBe('');
    expect(nomeDaSaudacao(null)).toBe('');
  });

  it('nunca um e-mail', () => {
    expect(nomeDaSaudacao('gestor.teste@teste.local')).toBe('Gestor');
    expect(nomeDaSaudacao('ana@imova.com.br')).toBe('Ana');
  });
});

describe('os grupos em cartão e os filtros', () => {
  const fila = [
    conversa(FECHA_EM(2), { organizacaoId: 'b', organizacao: 'Bruna Lima' }),
    conversa(FECHOU, { organizacaoId: 'a', organizacao: 'Ana' }),
    item({ prioridade: 3, organizacaoId: 'e', organizacao: 'E' }),
  ];
  const blocos = separarPelaJanela(agruparFila(fila));

  it('o filtro mostra só o grupo escolhido, e "tudo" mostra todos', () => {
    expect(blocosDoFiltro(blocos, 'tudo')).toBe(blocos);
    expect(blocosDoFiltro(blocos, 'agora').map((b) => b.id)).toEqual(['agora']);
  });

  it('o grupo que saiu da fila não deixa a tela vazia', () => {
    expect(blocosDoFiltro(blocos, 'parados')).toBe(blocos);
  });

  it('o selo vai para a primeira linha do que está na tela', () => {
    expect(primeiraDaFila(blocos)?.organizacao).toBe('Bruna Lima');
    expect(primeiraDaFila(blocosDoFiltro(blocos, 'agora'))?.organizacao).toBe('E');
    expect(primeiraDaFila([])).toBeNull();
  });

  it('aviso do sistema não ganha o selo', () => {
    const aviso = item({ organizacaoId: null, negocioId: null, titulo: 'Dead-letter' });
    expect(primeiraDaFila(agruparFila([aviso]))).toBeNull();
  });

  it('a frase do topo: por onde começar, ou nenhuma janela aberta', () => {
    expect(fraseDaJanela(blocos)).toBe('Comece por Bruna Lima: a janela fecha em 2 h.');
    expect(fraseDaJanela(separarPelaJanela(agruparFila([conversa(FECHOU)])))).toBe(
      'Nenhuma janela aberta agora.',
    );
  });
});

describe('o disco de iniciais', () => {
  it('primeira e última palavra, em maiúscula', () => {
    expect(iniciais('Paula Ramos')).toBe('PR');
    expect(iniciais('marina da costa')).toBe('MC');
    expect(iniciais('Imova')).toBe('I');
    expect(iniciais('Ótica Ângela')).toBe('ÓÂ');
  });

  it('sem letra, sem disco', () => {
    expect(iniciais('+55 84 99999-0000')).toBe('');
    expect(iniciais(null)).toBe('');
  });

  it('a mesma pessoa tem sempre a mesma cor', () => {
    expect(corDoDisco('Paula Ramos', 4)).toBe(corDoDisco('Paula Ramos', 4));
    expect(corDoDisco('Paula Ramos', 4)).toBeGreaterThanOrEqual(0);
    expect(corDoDisco('Paula Ramos', 4)).toBeLessThan(4);
  });
});
