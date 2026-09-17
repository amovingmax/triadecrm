import { describe, expect, it } from 'vitest';

import { faltasDoWhatsapp } from './aviso-whatsapp';
import {
  escolherModeloInicial,
  faltando,
  fraseDoBloqueio,
  preencher,
  previaSchema,
  quandoAbre,
  quandoFoi,
  rotuloDaVariavel,
  valorLimpo,
  tetoDaVariavel,
  valoresIniciais,
  variavelLivreDoModelo,
  type ModeloParaEnviar,
} from './envio-de-modelo';
import { fraseDaRecusaDoEnvio, MOTIVOS_DE_RECUSA_DO_ENVIO } from './mensagens';
import type { DependenciasDaMeta } from './tipos';

/**
 * O que estes testes protegem, na caixa de mandar WhatsApp pelo CRM:
 *
 *  1. **A prévia mostra o que vai chegar.** Preencher na tela de um jeito e no
 *     banco de outro faria a pessoa aprovar um texto e o parceiro receber outro.
 *  2. **Campo vazio é buraco visível**, não `{{detalhe}}` nem texto sem nada.
 *  3. **O bloqueio vira frase**, com a hora em que abre no fuso de Natal.
 *  4. **O aviso sai da tela quando o WhatsApp está de pé** — e não fica preso
 *     para sempre por um modelo que a Meta recusou.
 */

const ABERTURA: ModeloParaEnviar = {
  id: 1,
  codigo: 'AEB-ABR-A',
  nome: 'Abertura A (com origem) — Alimentos & Bebidas',
  tipo: 'abertura',
  variante: 'A',
  segmento: 'AEB',
  corpo: 'Oi, {{nome}}, tudo bem?\nVi o {{empresa}} no {{origem}} — a mesa de {{ detalhe }}.',
  variaveis: ['nome', 'empresa', 'origem', 'detalhe'],
};

describe('preencher', () => {
  it('troca cada variável pelo valor limpo, como app.modelo_renderizar', () => {
    expect(
      preencher(ABERTURA.corpo, {
        nome: 'Mariana',
        empresa: 'Buffet  Sabor',
        origem: 'Google Maps',
        detalhe: 'doces\nfinos',
      }),
    ).toBe('Oi, Mariana, tudo bem?\nVi o Buffet Sabor no Google Maps — a mesa de doces finos.');
  });

  it('mostra o campo vazio como buraco com o nome do campo', () => {
    expect(preencher('Vi o {{detalhe}}.', { detalhe: '   ' })).toBe(
      'Vi o [detalhe do trabalho que chamou atenção].',
    );
  });

  it('não interpreta cifrão nem barra do valor', () => {
    expect(preencher('Oi {{nome}}', { nome: 'R$ 5 $& \\1' })).toBe('Oi R$ 5 $& \\1');
  });
});

describe('atendente', () => {
  it('o nome de quem envia entra na prévia pelo que o banco sugeriu, sem campo para digitar', () => {
    const modelo: ModeloParaEnviar = {
      ...ABERTURA,
      corpo: 'Oi, {{nome}}! Aqui é {{atendente}}, da Komune.',
      variaveis: ['nome', 'atendente'],
    };
    const valores = valoresIniciais(modelo, { nome: 'Neuma', atendente: 'Matheus' });
    expect(preencher(modelo.corpo, valores)).toBe('Oi, Neuma! Aqui é Matheus, da Komune.');
    expect(faltando(modelo, valores)).toEqual([]);
  });
});

describe('valores', () => {
  it('valorLimpo tira quebra de linha, tab e espaço repetido', () => {
    expect(valorLimpo(' a\t b\n\nc ')).toBe('a b c');
  });

  it('parte do que o banco sugeriu e mantém o que a pessoa digitou', () => {
    expect(
      valoresIniciais(
        ABERTURA,
        { nome: 'Mariana', empresa: 'Buffet', lixo: 'x' },
        { nome: 'Mari' },
      ),
    ).toEqual({ nome: 'Mari', empresa: 'Buffet', origem: '', detalhe: '' });
  });

  it('lista o que falta, na ordem do modelo', () => {
    expect(faltando(ABERTURA, { nome: 'a', empresa: ' ', origem: 'c' })).toEqual([
      'empresa',
      'detalhe',
    ]);
  });

  it('variável desconhecida ganha rótulo legível', () => {
    expect(rotuloDaVariavel('link_do_mapa')).toBe('Link do mapa');
  });
});

describe('bloqueio', () => {
  const quarta10h = new Date('2026-09-16T13:00:00Z'); // 10:00 em Natal

  it('diz quando abre, no fuso de Natal', () => {
    expect(quandoAbre('2026-09-16T17:00:00Z', quarta10h)).toBe('hoje às 14:00');
    expect(quandoAbre('2026-09-17T12:00:00Z', quarta10h)).toBe('quinta-feira às 09:00');
    expect(quandoAbre(null, quarta10h)).toBeNull();
  });

  it('diz há quanto tempo esperamos resposta', () => {
    expect(quandoFoi('2026-09-16T12:10:00Z', quarta10h)).toBe('hoje às 09:10');
    expect(quandoFoi('2026-09-15T20:00:00Z', quarta10h)).toBe('ontem às 17:00');
    expect(quandoFoi('2026-09-11T15:00:00Z', quarta10h)).toBe('sexta-feira, 11/09');
  });

  it('junta a frase do motivo com a hora em que abre', () => {
    expect(
      fraseDoBloqueio(
        { motivo: 'janela_depois_do_fechamento', quando: '2026-09-17T12:00:00Z' },
        MOTIVOS_DE_RECUSA_DO_ENVIO,
        quarta10h,
      ),
    ).toBe('O horário de envio de hoje já fechou. Abre quinta-feira às 09:00.');
  });

  it('motivo sem frase não passa em branco', () => {
    expect(fraseDoBloqueio({ motivo: 'algo_novo', quando: null }, {}, quarta10h)).toBe(
      'Agora não dá para mandar mensagem para este parceiro.',
    );
  });

  it('as recusas novas do banco têm frase, extraídas do texto exato da exceção', () => {
    expect(fraseDaRecusaDoEnvio('Envio recusado: modelo_sem_parametro (detalhe)')).toBe(
      MOTIVOS_DE_RECUSA_DO_ENVIO.modelo_sem_parametro,
    );
    expect(fraseDaRecusaDoEnvio('Envio recusado: whatsapp_nao_configurado (RF-CON-01)')).toBe(
      MOTIVOS_DE_RECUSA_DO_ENVIO.whatsapp_nao_configurado,
    );
    for (const motivo of [
      'ficha_sem_whatsapp',
      'modelo_inexistente',
      'modelo_de_sistema',
      'parametro_longo_demais',
      'modelo_nao_aprovado_na_meta',
    ]) {
      expect(fraseDaRecusaDoEnvio(`Envio recusado: ${motivo}`)).toBeTruthy();
    }
  });
});

describe('previaSchema', () => {
  it('lê a prévia como o banco devolve', () => {
    const lido = previaSchema.safeParse({
      numero_configurado: true,
      tem_whatsapp: true,
      conversa_id: null,
      janela_24h_aberta: false,
      primeiro_contato: true,
      sem_resposta_desde: null,
      bloqueio: null,
      teto: { usados: 3, teto: 20 },
      segmento: 'AEB',
      valores: { nome: 'Mariana', empresa: 'Buffet' },
      modelos: [ABERTURA],
      modelos_esperando_meta: 38,
    });
    expect(lido.success).toBe(true);
  });

  it('recusa resposta sem os campos que decidem o botão', () => {
    expect(previaSchema.safeParse({ numero_configurado: true }).success).toBe(false);
  });
});

describe('faltasDoWhatsapp', () => {
  const tudoPronto: DependenciasDaMeta = {
    numeroConfigurado: true,
    modelosAprovados: 12,
    modelosAguardando: 3,
    naFila: 0,
    worker: { estado: 'ok', ultimaBatidaEm: '2026-09-16T13:00:00Z' },
  };

  it('com número, envio rodando e modelo aprovado, o aviso some — mesmo com modelo recusado', () => {
    expect(faltasDoWhatsapp(tudoPronto)).toEqual([]);
  });

  it('diz cada peça que falta, na ordem em que destravam', () => {
    const faltas = faltasDoWhatsapp({
      numeroConfigurado: false,
      modelosAprovados: 0,
      modelosAguardando: 40,
      naFila: 2,
      worker: { estado: 'nunca', ultimaBatidaEm: null },
    });
    expect(faltas).toHaveLength(3);
    expect(faltas[0]).toContain('não foi conectado');
    expect(faltas[1]).toContain('envio está parado');
    expect(faltas[2]).toContain('não aprovou nenhum modelo');
  });
});

describe('a abertura livre (migração 20260916100000)', () => {
  const LIVRE: ModeloParaEnviar = {
    id: 9,
    codigo: 'GEN-ABR-LIVRE',
    nome: 'Abertura livre — você escreve o meio',
    tipo: 'abertura',
    variante: null,
    segmento: 'GEN',
    corpo:
      'Oi, {{nome}}! Aqui é {{atendente}}, da Komune, o aplicativo de eventos de Natal. {{mensagem}} Se não for o momento, é só responder SAIR.',
    variaveis: ['nome', 'atendente', 'mensagem'],
  };

  it('o texto livre cabe em 900 caracteres; o resto continua em 200', () => {
    expect(tetoDaVariavel('mensagem')).toBe(900);
    expect(tetoDaVariavel('nome')).toBe(200);
  });

  it('a variável livre do modelo é achada, e não vira campo de formulário', () => {
    expect(variavelLivreDoModelo(LIVRE)).toBe('mensagem');
    expect(variavelLivreDoModelo(ABERTURA)).toBeNull();
  });

  it('a caixa abre no modelo em que se escreve, mesmo com outros na frente', () => {
    expect(escolherModeloInicial([ABERTURA, LIVRE], {})?.codigo).toBe('GEN-ABR-LIVRE');
  });

  it('sem modelo livre, abre no que o banco já preenche inteiro', () => {
    const pronto: ModeloParaEnviar = {
      ...ABERTURA,
      id: 7,
      codigo: 'GEN-FUP-D3-V1',
      corpo: 'Oi, {{nome}}, passando para saber se você viu.',
      variaveis: ['nome'],
    };
    expect(escolherModeloInicial([ABERTURA, pronto], { nome: 'Mariana' })?.codigo).toBe(
      'GEN-FUP-D3-V1',
    );
    expect(escolherModeloInicial([], {})).toBeNull();
  });

  it('o que a pessoa escreve sai num parágrafo só, como a Meta exige', () => {
    expect(
      preencher(LIVRE.corpo, {
        nome: 'Ana',
        atendente: 'Rafael',
        mensagem: 'Linha um\nLinha dois',
      }),
    ).toContain('Linha um Linha dois');
  });
});

describe('o cumprimento abre a conversa', () => {
  const cumprimento = {
    id: 90,
    codigo: 'GEN-ABR-CUMPRIMENTO',
    nome: 'Cumprimento curto',
    tipo: 'abertura',
    variante: 'A',
    segmento: null,
    corpo: '{{saudacao}}! Aqui é {{atendente}}, da Komune. Falo com a pessoa responsável?',
    variaveis: ['saudacao', 'atendente'],
  } as const;
  const livre = {
    id: 91,
    codigo: 'GEN-ABR-LIVRE',
    nome: 'Abertura livre',
    tipo: 'abertura',
    variante: 'A',
    segmento: null,
    corpo: 'Oi, {{nome}}! Aqui é {{atendente}}. {{mensagem}}',
    variaveis: ['nome', 'atendente', 'mensagem'],
  } as const;

  it('no PRIMEIRO contato escolhe o cumprimento, que não tem campo para preencher', () => {
    const escolhido = escolherModeloInicial([livre, cumprimento], { atendente: 'Matheus' }, true);
    expect(escolhido?.codigo).toBe('GEN-ABR-CUMPRIMENTO');
  });

  it('na RETOMADA escolhe a moldura livre: já se sabe com quem se fala', () => {
    // Cumprimentar de novo seria começar do zero uma conversa que existe.
    const escolhido = escolherModeloInicial([livre, cumprimento], { atendente: 'Matheus' }, false);
    expect(escolhido?.codigo).toBe('GEN-ABR-LIVRE');
  });

  it('sem o cumprimento aprovado, o primeiro contato cai na moldura livre', () => {
    // A Meta pode demorar ou recusar. A tela não pode ficar sem saída por isso.
    const escolhido = escolherModeloInicial([livre], { atendente: 'Matheus' }, true);
    expect(escolhido?.codigo).toBe('GEN-ABR-LIVRE');
  });
});

