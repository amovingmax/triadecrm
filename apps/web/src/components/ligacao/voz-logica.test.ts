import { describe, expect, it } from 'vitest';
import { Constants } from '@komune/schema';

import { cronometro } from './chamada-cabecalho';
import {
  classificarFalha,
  codigoParaDiagnostico,
  duracaoLegivel,
  ESTADOS_DA_LINHA,
  estadoAoDesligar,
  avisoDaFalha,
  avisoDaRecusa,
  AVISO_DA_RECUSA,
  FRASE_DA_FALHA,
  TITULO_DA_FALHA,
  juntarEstados,
  linhaFoiAtendida,
  linhaViva,
  relogioDaLigacao,
  resultadoSugerido,
  ROTULO_DA_LINHA,
  segundosDeConversa,
} from './voz-logica';

describe('o estado da linha', () => {
  it('é o mesmo enum do banco, na mesma ordem', () => {
    expect([...ESTADOS_DA_LINHA]).toEqual([...Constants.app.Enums.voice_call_status]);
  });

  it('tem rótulo em português para cada estado', () => {
    for (const estado of ESTADOS_DA_LINHA) expect(ROTULO_DA_LINHA[estado]).toBeTruthy();
    expect(ROTULO_DA_LINHA.em_ligacao).toBe('Em ligação');
  });

  it('está viva só antes do fim', () => {
    expect(ESTADOS_DA_LINHA.filter(linhaViva)).toEqual([
      'preparando',
      'chamando',
      'tocando',
      'em_ligacao',
    ]);
  });
});

describe('juntar o que a tela sabe com o que o banco sabe', () => {
  it('avança quando o banco está na frente', () => {
    expect(juntarEstados('chamando', 'tocando')).toBe('tocando');
    expect(juntarEstados('tocando', 'em_ligacao')).toBe('em_ligacao');
  });

  it('não volta com leitura atrasada', () => {
    expect(juntarEstados('em_ligacao', 'tocando')).toBe('em_ligacao');
    expect(juntarEstados('chamando', 'preparando')).toBe('chamando');
  });

  it('o estado final do banco vale sempre', () => {
    expect(juntarEstados('em_ligacao', 'finalizada')).toBe('finalizada');
    expect(juntarEstados('cancelada', 'nao_atendida')).toBe('nao_atendida');
  });

  it('depois que a tela encerrou, leitura de linha viva não a ressuscita', () => {
    expect(juntarEstados('cancelada', 'tocando')).toBe('cancelada');
  });
});

describe('desligar pela tela', () => {
  it('conversa vira finalizada; antes de atender vira cancelada', () => {
    expect(estadoAoDesligar('em_ligacao', false)).toBe('finalizada');
    expect(estadoAoDesligar('tocando', false)).toBe('cancelada');
    expect(estadoAoDesligar('preparando', false)).toBe('cancelada');
  });

  it('erro vira falha, e o que já acabou não muda', () => {
    expect(estadoAoDesligar('chamando', true)).toBe('falha');
    expect(estadoAoDesligar('nao_atendida', true)).toBe('nao_atendida');
  });
});

describe('da linha para a tabulação', () => {
  it('sugere o resultado técnico sem adivinhar a falha', () => {
    expect(resultadoSugerido('finalizada')).toBe('atendida_humano');
    expect(resultadoSugerido('nao_atendida')).toBe('nao_atendeu');
    expect(resultadoSugerido('cancelada')).toBe('nao_atendeu');
    expect(resultadoSugerido('ocupado')).toBe('ocupado');
    expect(resultadoSugerido('falha')).toBeNull();
  });

  it('só há desfecho comercial quando alguém atendeu', () => {
    expect(linhaFoiAtendida('finalizada', null)).toBe(true);
    expect(linhaFoiAtendida('falha', '2026-10-06T14:00:00Z')).toBe(true);
    expect(linhaFoiAtendida('nao_atendida', null)).toBe(false);
    expect(linhaFoiAtendida('ocupado', null)).toBe(false);
  });
});

describe('o relógio', () => {
  it('formata como o visor de um telefone, igual ao cronômetro da tela de ligar', () => {
    expect(relogioDaLigacao(207)).toBe('03:27');
    expect(relogioDaLigacao(3725)).toBe('1:02:05');
    expect(relogioDaLigacao(-4)).toBe('00:00');
    for (const s of [0, 59, 60, 599, 3599, 3600, 7325]) {
      expect(relogioDaLigacao(s)).toBe(cronometro(s));
    }
  });

  it('conta do atendimento, não do clique', () => {
    const agora = new Date('2026-10-06T14:03:27Z');
    expect(segundosDeConversa(null, null, agora)).toBe(0);
    expect(segundosDeConversa('2026-10-06T14:00:00Z', null, agora)).toBe(207);
    expect(segundosDeConversa('2026-10-06T14:00:00Z', '2026-10-06T14:01:00Z', agora)).toBe(60);
  });

  it('escreve a duração do histórico', () => {
    expect(duracaoLegivel(258)).toBe('04m 18s');
    expect(duracaoLegivel(0)).toBeNull();
    expect(duracaoLegivel(null)).toBeNull();
  });
});

describe('o que dizer quando deu errado', () => {
  it('microfone negado e microfone ausente são frases diferentes', () => {
    expect(classificarFalha({ nome: 'NotAllowedError' })).toBe('microfone_bloqueado');
    expect(classificarFalha({ codigo: 31401 })).toBe('microfone_bloqueado');
    expect(classificarFalha({ nome: 'NotFoundError' })).toBe('sem_microfone');
    expect(classificarFalha({ codigo: 31402 })).toBe('sem_microfone');
  });

  it('separa conexão, credencial e número', () => {
    expect(classificarFalha({ codigo: 31005 })).toBe('sem_conexao');
    expect(classificarFalha({ codigo: 53405 })).toBe('sem_conexao');
    expect(classificarFalha({ codigo: 20104 })).toBe('credencial');
    expect(classificarFalha({ codigo: 13224 })).toBe('numero_invalido');
  });

  it('o que não conhece vira a frase genérica', () => {
    expect(classificarFalha({ codigo: 99999 })).toBe('falha_na_telefonia');
    expect(classificarFalha({})).toBe('falha_na_telefonia');
  });

  it('nenhuma frase mostra código nem o nome do provedor', () => {
    for (const frase of Object.values(FRASE_DA_FALHA)) {
      expect(frase).not.toMatch(/\d{4,}|twilio/i);
    }
    for (const aviso of Object.values(AVISO_DA_RECUSA)) {
      expect(aviso.titulo + aviso.frase).not.toMatch(/\d{4,}|twilio/i);
    }
  });

  it('cada falha tem um título curto, que é o que se lê primeiro', () => {
    expect(TITULO_DA_FALHA.microfone_bloqueado).toBe('Microfone bloqueado');
    expect(TITULO_DA_FALHA.numero_invalido).toBe('Telefone inválido');
    expect(avisoDaFalha('sem_conexao')).toEqual({
      titulo: 'Sem conexão',
      frase: FRASE_DA_FALHA.sem_conexao,
    });
    for (const titulo of Object.values(TITULO_DA_FALHA))
      expect(titulo.length).toBeLessThanOrEqual(28);
  });

  it('a recusa do banco vira título e frase, e diz com quem está o parceiro', () => {
    expect(avisoDaRecusa('fora_da_janela').titulo).toBe('Fora do horário');
    expect(avisoDaRecusa('numero_invalido').titulo).toBe('Telefone inválido');
    expect(avisoDaRecusa('reservado_em_outro_lote', { dono: 'Heloísa' }).frase).toMatch(/Heloísa/);
    expect(avisoDaRecusa('ja_no_seu_lote', { loteNome: 'Buffets' }).frase).toMatch(/Buffets/);
    expect(avisoDaRecusa('motivo_que_nao_existe')).toEqual(avisoDaFalha('falha_na_telefonia'));
    expect(avisoDaRecusa(null)).toEqual(avisoDaFalha('falha_na_telefonia'));
  });

  it('o código vai para o diagnóstico, curto', () => {
    expect(codigoParaDiagnostico({ codigo: 31005 })).toBe('sdk_31005');
    expect(codigoParaDiagnostico({ nome: 'NotAllowedError' })).toBe('navegador_NotAllowedError');
    expect(codigoParaDiagnostico({})).toBe('navegador_desconhecido');
  });
});
