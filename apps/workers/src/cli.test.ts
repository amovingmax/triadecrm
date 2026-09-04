import { describe, expect, it } from 'vitest';

import { parseArgs, WORKER_COMMANDS } from './cli';

describe('parseArgs', () => {
  it.each(WORKER_COMMANDS)('aceita o comando "%s"', (command) => {
    expect(parseArgs([command])).toEqual({ kind: 'run', command });
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
    expect(parseArgs(['--', 'ingest'])).toEqual({ kind: 'run', command: 'ingest' });
    expect(parseArgs(['--', '--help'])).toEqual({ kind: 'help' });
  });

  it('erra com opções não reconhecidas', () => {
    expect(parseArgs(['ingest', '--foo'])).toMatchObject({ kind: 'error' });
  });
});
