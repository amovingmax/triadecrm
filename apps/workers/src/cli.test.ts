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

  it('"ingest" deixou de ser comando: o coletor do Radar saiu em 25/09/2026', () => {
    // Não é detalhe de parse. Uma máquina antiga com `command: ['ingest']` no
    // Compose, ou um `WORKER_COMANDO=ingest` esquecido num .env, precisa PARAR
    // com a frase certa — e não subir um processo que dorme para sempre.
    expect(parseArgs(['ingest'])).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('ingest'),
    });
    expect(parseArgs([], { WORKER_COMANDO: 'ingest' })).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('em WORKER_COMANDO: "ingest"'),
    });
  });

  it('ignora o separador "--" repassado pelo pnpm run', () => {
    expect(parseArgs(['--', 'wa'])).toEqual({ kind: 'run', command: 'wa', opcoes: {} });
    expect(parseArgs(['--', '--help'])).toEqual({ kind: 'help' });
  });

  it('erra com opções não reconhecidas, e diz quais valem', () => {
    // Um `--conetar` digitado errado não pode virar uma conexão diferente da pedida.
    expect(parseArgs(['wa', '--conetar'])).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('--conectar'),
    });
    expect(parseArgs(['wa', '--foo'])).toMatchObject({ kind: 'error' });
    // Opção de outro comando não vale em `ai`.
    expect(parseArgs(['ai', '--conectar'])).toMatchObject({ kind: 'error' });
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
    expect(parseArgs(['wa', 'casamentos'])).toMatchObject({ kind: 'error' });
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

  it('A LINHA SEMPRE GANHA: o Compose com `command: [rotas]` não vira wa', () => {
    expect(parseArgs(['rotas'], { WORKER_COMANDO: 'wa' })).toEqual({
      kind: 'run',
      command: 'rotas',
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
