/**
 * Parse dos argumentos do CLI dos workers. Sem dependências, para ser testável e rápido.
 */

export const WORKER_COMMANDS = ['ingest', 'wa', 'ai'] as const;
export type WorkerCommand = (typeof WORKER_COMMANDS)[number];

export const USAGE = `Uso: workers <comando> [opções]

Comandos:
  ingest   Radar: scrapers, planilhas e base CNPJ → esteira de ingestão (D4, RF-RAD)
  wa       WhatsApp: envios, cadências e áudios pela Cloud API da Meta (D5, RF-CON)
  ai       IA: classificação, rascunhos, resumos e Assistente (D6, ADR-10)

Opções:
  -h, --help   Mostra esta ajuda

Cada comando lê as variáveis de ambiente do processo (.env na raiz do repo, em dev,
ou env_file do Docker Compose na máquina dedicada) e as valida antes de iniciar.
`;

export type ParsedArgs =
  { kind: 'run'; command: WorkerCommand } | { kind: 'help' } | { kind: 'error'; message: string };

export function isWorkerCommand(value: string): value is WorkerCommand {
  return (WORKER_COMMANDS as readonly string[]).includes(value);
}

/** Interpreta `argv` já sem `node` e o caminho do script (ou seja, `process.argv.slice(2)`). */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  // `pnpm run <script> -- <args>` repassa o "--" literalmente; ele é só separador e pode ser ignorado.
  const [first, ...rest] = argv.filter((arg) => arg !== '--');

  if (first === undefined || first === '-h' || first === '--help' || first === 'help') {
    return first === undefined
      ? { kind: 'error', message: 'Informe um comando.' }
      : { kind: 'help' };
  }

  if (!isWorkerCommand(first)) {
    return {
      kind: 'error',
      message: `Comando desconhecido: "${first}". Comandos válidos: ${WORKER_COMMANDS.join(', ')}.`,
    };
  }

  const unknown = rest.filter((arg) => arg !== '-h' && arg !== '--help');
  if (unknown.length > 0) {
    return { kind: 'error', message: `Opções não reconhecidas: ${unknown.join(' ')}.` };
  }
  if (rest.length > 0) {
    return { kind: 'help' };
  }

  return { kind: 'run', command: first };
}
