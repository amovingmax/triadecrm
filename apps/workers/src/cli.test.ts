import { describe, expect, it } from 'vitest';

import { parseArgs, WORKER_COMMANDS } from './cli';

describe('parseArgs', () => {
  it.each(WORKER_COMMANDS)('aceita o comando "%s"', (command) => {
    expect(parseArgs([command])).toEqual({ kind: 'run', command, opcoes: {} });
  });

  it('mostra ajuda com -h, --help e help', () => {
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['wa', '--help'])).toEqual({ kind: 'help' });
  });

  it('erra sem comando ou com comando desconhecido', () => {
    expect(parseArgs([])).toMatchObject({ kind: 'error' });
    expect(parseArgs(['bullmq'])).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('bullmq'),
    });
  });

  it('ignora o separador "--" repassado pelo pnpm run', () => {
    expect(parseArgs(['--', 'ingest'])).toEqual({ kind: 'run', command: 'ingest', opcoes: {} });
    expect(parseArgs(['--', '--help'])).toEqual({ kind: 'help' });
  });

  it('lê as opções da coleta', () => {
    expect(
      parseArgs([
        'ingest',
        '--agendar',
        '--fonte=casamentos_com_br',
        '--categorias=cerimonialista,buffet-casamento',
        '--paginas=2',
        '--uma-vez',
      ]),
    ).toEqual({
      kind: 'run',
      command: 'ingest',
      opcoes: {
        agendar: true,
        fonte: 'casamentos_com_br',
        categorias: 'cerimonialista,buffet-casamento',
        paginas: '2',
        'uma-vez': true,
      },
    });
  });

  it('erra com opções não reconhecidas, e diz quais valem', () => {
    // Um `--pagians=3` digitado errado não pode virar uma coleta diferente da pedida.
    expect(parseArgs(['ingest', '--pagians=3'])).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('--paginas'),
    });
    expect(parseArgs(['ingest', '--foo'])).toMatchObject({ kind: 'error' });
    // Opção de outro comando não vale em `wa`.
    expect(parseArgs(['wa', '--agendar'])).toMatchObject({ kind: 'error' });
  });

  it('wa aceita --conectar e --sincronizar-modelos', () => {
    expect(parseArgs(['wa', '--conectar'])).toEqual({
      kind: 'run',
      command: 'wa',
      opcoes: { conectar: true },
    });
    expect(parseArgs(['wa', '--sincronizar-modelos'])).toEqual({
      kind: 'run',
      command: 'wa',
      opcoes: { 'sincronizar-modelos': true },
    });
  });

  it('erra com argumento solto', () => {
    expect(parseArgs(['ingest', 'casamentos'])).toMatchObject({ kind: 'error' });
  });
});

describe('WORKER_COMANDO (a imagem rodando só com variável de ambiente)', () => {
  it('sem comando na linha, vale WORKER_COMANDO', () => {
    expect(parseArgs([], { WORKER_COMANDO: 'wa' })).toEqual({
      kind: 'run',
      command: 'wa',
      opcoes: {},
    });
  });

  it('só opções na linha: WORKER_COMANDO completa o comando', () => {
    expect(parseArgs(['--uma-vez'], { WORKER_COMANDO: 'wa' })).toEqual({
      kind: 'run',
      command: 'wa',
      opcoes: { 'uma-vez': true },
    });
  });

  it('aceita opções dentro de WORKER_COMANDO', () => {
    expect(parseArgs([], { WORKER_COMANDO: '  wa   --conectar ' })).toEqual({
      kind: 'run',
      command: 'wa',
      opcoes: { conectar: true },
    });
  });

  it('A LINHA SEMPRE GANHA: o Compose com `command: [ingest]` não vira wa', () => {
    expect(parseArgs(['ingest'], { WORKER_COMANDO: 'wa' })).toEqual({
      kind: 'run',
      command: 'ingest',
      opcoes: {},
    });
  });

  it('ajuda continua sendo ajuda', () => {
    expect(parseArgs(['--help'], { WORKER_COMANDO: 'wa' })).toEqual({ kind: 'help' });
  });

  it('vazio ou só espaço é o mesmo que ausente', () => {
    expect(parseArgs([], { WORKER_COMANDO: '   ' })).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('WORKER_COMANDO'),
    });
    expect(parseArgs([], {})).toMatchObject({ kind: 'error' });
  });

  it('comando desconhecido em WORKER_COMANDO diz de onde veio', () => {
    expect(parseArgs([], { WORKER_COMANDO: 'bullmq' })).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('em WORKER_COMANDO: "bullmq"'),
    });
  });
});
