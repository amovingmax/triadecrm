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
    // `wa` e `ai` ainda não aceitam opção nenhuma.
    expect(parseArgs(['wa', '--agendar'])).toMatchObject({ kind: 'error' });
  });

  it('erra com argumento solto', () => {
    expect(parseArgs(['ingest', 'casamentos'])).toMatchObject({ kind: 'error' });
  });
});
