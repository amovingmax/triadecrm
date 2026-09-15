import { describe, expect, it } from 'vitest';

import { pedidoValido, PRAZO_DO_PEDIDO_MS } from '@/components/conversas/pedido-de-modelo';

import { estadoAoDiscar } from './chamada-maquina';
import {
  MODELO_CONFIRMACAO,
  MODELO_RESUMO_FORNECEDOR,
  MODELO_RESUMO_PRODUTOR,
  MODELO_TENTEI_LIGAR,
  mensagemDeDepois,
} from './depois-da-ligacao';
import { horaFalada, horarioFalado } from './roteiro-texto';
import {
  ENTRADAS_DA_ATIVACAO,
  entradaDaLigacao,
  NO_DE_ABERTURA,
  noValeNaVariante,
  opcoesDeHorario,
  validarRoteiro,
  varianteDoFunil,
  type NoRoteiro,
  type Roteiro,
} from './tipos';

/**
 * O roteiro v3 (migração 20260915100000): três caminhos num roteiro só.
 *
 *  1. **A variante sai do funil do lote**, como `app.variante_da_ligacao` — e a
 *     ativação só vale quando o roteiro a tem, para os lotes da v2 seguirem de pé.
 *  2. **A ativação entra pela etapa**, como `app.entrada_da_ligacao`.
 *  3. **O fechamento oferece dois horários concretos** em dias úteis.
 *  4. **O recibo pede a mensagem certa no WhatsApp**, e o recado até a caixa de
 *     envio não sobrevive a outra organização nem a um quarto de hora.
 */

describe('onde um nó vale', () => {
  it('captacao vale para fornecedor e produtor, e nunca para ativação', () => {
    expect(noValeNaVariante('captacao', 'fornecedor')).toBe(true);
    expect(noValeNaVariante('captacao', 'produtor')).toBe(true);
    expect(noValeNaVariante('captacao', 'ativacao')).toBe(false);
    expect(noValeNaVariante('ambas', 'ativacao')).toBe(true);
    expect(noValeNaVariante('ativacao', 'fornecedor')).toBe(false);
  });
});

describe('a variante pelo funil do lote', () => {
  it('segue o slug do funil, não o tipo da organização', () => {
    expect(varianteDoFunil('ativacao', 'fornecedor', true)).toBe('ativacao');
    expect(varianteDoFunil('produtor', 'fornecedor', true)).toBe('produtor');
    expect(varianteDoFunil('fornecedor', 'cerimonialista', true)).toBe('fornecedor');
  });

  it('lote de ativação com roteiro sem ativação (v2) cai na regra antiga', () => {
    expect(varianteDoFunil('ativacao', 'cerimonialista', false)).toBe('produtor');
    expect(varianteDoFunil('ativacao', 'fornecedor', false)).toBe('fornecedor');
  });
});

describe('a entrada da ativação pela etapa', () => {
  it('cada etapa abre pelo motivo dela', () => {
    expect(entradaDaLigacao('ativacao', 'publicado')).toBe(ENTRADAS_DA_ATIVACAO.perfil);
    expect(entradaDaLigacao('ativacao', 'perfil_completo')).toBe(ENTRADAS_DA_ATIVACAO.perfil);
    expect(entradaDaLigacao('ativacao', 'primeiro_lead')).toBe(ENTRADAS_DA_ATIVACAO.pedido);
    expect(entradaDaLigacao('ativacao', 'lead_respondido')).toBe(ENTRADAS_DA_ATIVACAO.respondido);
    expect(entradaDaLigacao('ativacao', 'em_risco')).toBe(ENTRADAS_DA_ATIVACAO.reativar);
    expect(entradaDaLigacao('ativacao', null)).toBe(ENTRADAS_DA_ATIVACAO.perfil);
  });

  it('a captação sempre entra pela abertura', () => {
    expect(entradaDaLigacao('fornecedor', 'em_risco')).toBe(NO_DE_ABERTURA);
    expect(entradaDaLigacao('produtor', null)).toBe(NO_DE_ABERTURA);
  });

  it('a máquina começa no nó de entrada e o põe no caminho', () => {
    expect(estadoAoDiscar(ENTRADAS_DA_ATIVACAO.pedido)).toEqual({
      noAtual: 'ativ_abertura_pedido',
      caminho: ['ativ_abertura_pedido'],
      capturas: {},
      atendeu: false,
    });
    expect(estadoAoDiscar().noAtual).toBe(NO_DE_ABERTURA);
  });
});

describe('o validador com o terceiro caminho', () => {
  const no = (parcial: Partial<NoRoteiro> & Pick<NoRoteiro, 'id' | 'tipo'>): NoRoteiro => ({
    variante: 'ambas',
    texto: 'Fala.',
    saidas: [],
    desfecho: null,
    resultadoTecnico: null,
    campo: null,
    nota: null,
    ...parcial,
  });
  const roteiro = (nos: NoRoteiro[]): Roteiro => ({
    id: '00000000-0000-4000-8000-000000000000',
    slug: 't',
    nome: 't',
    versao: 1,
    nos,
  });
  const fim = no({ id: 'fim', tipo: 'fim', desfecho: 'lig_interessado' });

  it('uma árvore de dois caminhos (a v2) continua válida', () => {
    const v2 = roteiro([
      no({
        id: 'abertura',
        tipo: 'pergunta',
        saidas: [{ rotulo: 'Ok', destino: 'fim', valor: null }],
      }),
      fim,
    ]);
    expect(validarRoteiro(v2)).toEqual([]);
  });

  it('árvore com ativação precisa das quatro entradas e de saída na ativação', () => {
    const quebrada = roteiro([
      no({
        id: 'abertura',
        tipo: 'pergunta',
        saidas: [{ rotulo: 'Ok', destino: 'so_captacao', valor: null }],
      }),
      no({
        id: 'so_captacao',
        tipo: 'fim',
        variante: 'captacao',
        desfecho: 'lig_interessado',
      }),
      no({
        id: 'ativ_abertura_perfil',
        tipo: 'fim',
        variante: 'ativacao',
        desfecho: 'lig_interessado',
      }),
    ]);
    const erros = validarRoteiro(quebrada);
    expect(erros).toContain('Falta o nó de entrada da ativação "ativ_abertura_pedido".');
    expect(erros).toContain('"abertura" fica sem saída na variante ativacao.');
  });
});

describe('os dois horários do fechamento', () => {
  it('próximo dia útil às 10h e o seguinte às 15h', () => {
    // Quarta, 16/09/2026.
    expect(opcoesDeHorario('2026-09-16', [])).toEqual([
      '2026-09-17T10:00:00-03:00',
      '2026-09-18T15:00:00-03:00',
    ]);
  });

  it('pula sábado, domingo e feriado', () => {
    // Sexta, 09/10/2026; segunda 12/10 é feriado.
    expect(opcoesDeHorario('2026-10-09', ['2026-10-12'])).toEqual([
      '2026-10-13T10:00:00-03:00',
      '2026-10-14T15:00:00-03:00',
    ]);
  });

  it('fala a hora como se diz ao telefone', () => {
    expect(horaFalada('2026-09-17T10:00:00-03:00')).toBe('às 10h');
    expect(horaFalada('2026-09-17T14:30:00-03:00')).toBe('às 14h30');
    expect(horarioFalado('2026-09-17T10:00:00-03:00', new Date('2026-09-16T13:00:00Z'))).toBe(
      'amanhã às 10h',
    );
  });
});

describe('a mensagem de depois da ligação', () => {
  const base = {
    variante: 'fornecedor' as const,
    resultado: 'atendida_humano' as const,
    desfechoSlug: null,
    caminho: [] as string[],
    reuniaoEm: null,
    reuniaoFormato: null,
  };

  it('reunião marcada pede a confirmação, com dia, hora e formato', () => {
    expect(
      mensagemDeDepois({
        ...base,
        desfechoSlug: 'lig_reuniao_marcada',
        reuniaoEm: '2026-09-17T10:00:00-03:00',
        reuniaoFormato: 'meet',
      }),
    ).toEqual({
      codigo: MODELO_CONFIRMACAO,
      rotulo: 'Mandar a confirmação no WhatsApp',
      valores: { data: '17/09', hora: '10h', formato: 'Google Meet' },
    });
  });

  it('quem pediu o material recebe o resumo da própria variante', () => {
    const caminho = ['abertura', 'obj_whatsapp', 'fim_material'];
    expect(mensagemDeDepois({ ...base, caminho })?.codigo).toBe(MODELO_RESUMO_FORNECEDOR);
    expect(mensagemDeDepois({ ...base, variante: 'produtor', caminho })?.codigo).toBe(
      MODELO_RESUMO_PRODUTOR,
    );
  });

  it('"tentei te ligar" só para fornecedor, que é a proposta que ele fala', () => {
    expect(mensagemDeDepois({ ...base, resultado: 'nao_atendeu' })?.codigo).toBe(
      MODELO_TENTEI_LIGAR,
    );
    expect(
      mensagemDeDepois({ ...base, resultado: 'caixa_postal', variante: 'produtor' }),
    ).toBeNull();
    expect(
      mensagemDeDepois({ ...base, resultado: 'nao_atendeu', variante: 'ativacao' }),
    ).toBeNull();
    expect(mensagemDeDepois({ ...base, resultado: 'numero_invalido' })).toBeNull();
  });

  it('sem nada combinado, nenhum botão', () => {
    expect(mensagemDeDepois({ ...base, desfechoSlug: 'lig_sem_interesse' })).toBeNull();
  });
});

describe('o recado até a caixa de envio', () => {
  const agora = 1_800_000_000_000;
  const guardado = JSON.stringify({
    organizacaoId: 'org-1',
    codigo: MODELO_CONFIRMACAO,
    valores: { data: '17/09', hora: 10 },
    em: agora - 60_000,
  });

  it('vale para a mesma organização e só com valores de texto', () => {
    expect(pedidoValido(guardado, 'org-1', agora)).toEqual({
      organizacaoId: 'org-1',
      codigo: MODELO_CONFIRMACAO,
      valores: { data: '17/09' },
      em: agora - 60_000,
    });
  });

  it('não vale para outra organização, vencido ou quebrado', () => {
    expect(pedidoValido(guardado, 'org-2', agora)).toBeNull();
    expect(pedidoValido(guardado, 'org-1', agora + PRAZO_DO_PEDIDO_MS)).toBeNull();
    expect(pedidoValido('{', 'org-1', agora)).toBeNull();
    expect(pedidoValido(null, 'org-1', agora)).toBeNull();
  });
});
