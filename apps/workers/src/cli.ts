/**
 * Parse dos argumentos do CLI dos workers. Sem dependências, para ser testável e rápido.
 */

export const WORKER_COMMANDS = ['ingest', 'wa', 'ai', 'rotas'] as const;
export type WorkerCommand = (typeof WORKER_COMMANDS)[number];

/**
 * Opções aceitas por comando. A lista é fechada de propósito: um `--pagians=3`
 * digitado errado precisa parar o comando, não rodar uma coleta diferente da que
 * a pessoa pediu e ser descoberto depois no banco.
 */
export const OPCOES_POR_COMANDO: Record<WorkerCommand, readonly string[]> = {
  ingest: ['uma-vez', 'agendar', 'fonte', 'categorias', 'paginas', 'rotulo'],
  wa: ['uma-vez', 'conectar', 'sincronizar-modelos'],
  ai: ['uma-vez'],
  rotas: ['uma-vez', 'geocodificar'],
};

export const USAGE = `Uso: workers <comando> [opções]

Comandos:
  ingest   Radar: coleta nas fontes públicas → esteira de ingestão (RF-RAD, anexos R03/R06)
  wa       WhatsApp: recebe, registra opt-out e envia pela Cloud API da Meta (D5, RF-CON)
  ai       IA: classificação, rascunhos, resumos e Assistente (D6, ADR-10)
  rotas    Rotas de visita: geocodificação (Nominatim) e ordem das paradas no OSRM (RF-ROT)

Opções de "ingest":
  --agendar              Abre um lote e enfileira a coleta antes de começar a consumir.
  --fonte=<slug>         Fonte a coletar (padrão: casamentos_com_br). Só com --agendar.
  --categorias=a,b,c     Categorias da fonte a coletar (padrão: o catálogo inteiro da fonte).
  --paginas=<n>          Teto de páginas de listagem por categoria (padrão: 1).
  --rotulo=<texto>       Rótulo do lote, como aparece no relatório.
  --uma-vez              Esvazia as filas uma vez e sai, em vez de ficar rodando.

Opções de "wa":
  --uma-vez              Esvazia as filas de entrada e de saída uma vez e sai.
  --conectar             Conecta o número de ponta a ponta, uma vez, e sai: lê o número na
                         Meta, registra na Cloud API (se preciso), assina os webhooks, grava
                         o número no CRM e manda os modelos para aprovação.
  --sincronizar-modelos  Só manda os modelos para aprovação e atualiza o status deles, e sai.

Opções de "ai":
  --uma-vez              Esvazia a fila ai_jobs uma vez e sai, em vez de ficar rodando.

Opções de "rotas":
  --geocodificar         Faz UMA passada de geocodificação no Nominatim (1 req/s) e sai.
                         Não entra no laço da fila: as perguntas acabam.
  --uma-vez              Esvazia a fila rotas_jobs uma vez e sai, em vez de ficar rodando.

Opções gerais:
  -h, --help   Mostra esta ajuda

Cada comando lê as variáveis de ambiente do processo (.env na raiz do repo, em dev,
ou env_file do Docker Compose na máquina dedicada) e as valida antes de iniciar.

Sem comando na linha, vale WORKER_COMANDO (ex.: WORKER_COMANDO=wa): é assim que uma
nuvem roda a imagem só com variáveis de ambiente.
`;

/** Opções já separadas: `--uma-vez` vira `true`, `--paginas=2` vira `"2"`. */
export type OpcoesDoComando = Readonly<Record<string, string | true>>;

export type ParsedArgs =
  | { kind: 'run'; command: WorkerCommand; opcoes: OpcoesDoComando }
  | { kind: 'help' }
  | { kind: 'error'; message: string };

export function isWorkerCommand(value: string): value is WorkerCommand {
  return (WORKER_COMMANDS as readonly string[]).includes(value);
}

/** O que o parse lê do ambiente. Só isto: o resto do ambiente é do `env.ts`. */
export interface AmbienteDoCli {
  WORKER_COMANDO?: string | undefined;
}

/**
 * O comando que vem de `WORKER_COMANDO` quando a linha não traz um. Aceita
 * opções junto (`WORKER_COMANDO="wa --uma-vez"`), separadas por espaço.
 */
function comandoDoAmbiente(ambiente: AmbienteDoCli): string[] {
  const bruto = ambiente.WORKER_COMANDO?.trim() ?? '';
  return bruto === '' ? [] : bruto.split(/\s+/);
}

/**
 * Interpreta `argv` já sem `node` e o caminho do script (ou seja, `process.argv.slice(2)`).
 *
 * A ORDEM: comando posicional na linha → `WORKER_COMANDO` → erro. A linha
 * ganha sempre, para que o Compose (`command: ['ingest']`) continue mandando
 * mesmo numa máquina cujo `.env` tenha `WORKER_COMANDO` definido.
 */
export function parseArgs(argv: readonly string[], ambiente: AmbienteDoCli = {}): ParsedArgs {
  // `pnpm run <script> -- <args>` repassa o "--" literalmente; ele é só separador e pode ser ignorado.
  const semSeparador = argv.filter((arg) => arg !== '--');
  const primeiro = semSeparador[0];
  const pediuAjuda = primeiro === '-h' || primeiro === '--help' || primeiro === 'help';

  // Sem comando posicional (linha vazia, ou só opções): o ambiente completa.
  const doAmbiente =
    !pediuAjuda && (primeiro === undefined || primeiro.startsWith('--'))
      ? comandoDoAmbiente(ambiente)
      : [];
  const [first, ...rest] = [...doAmbiente, ...semSeparador];

  if (first === undefined || first === '-h' || first === '--help' || first === 'help') {
    return first === undefined
      ? {
          kind: 'error',
          message: 'Informe um comando (na linha, ou em WORKER_COMANDO).',
        }
      : { kind: 'help' };
  }

  if (!isWorkerCommand(first)) {
    const origem = doAmbiente.length > 0 ? ' em WORKER_COMANDO' : '';
    return {
      kind: 'error',
      message: `Comando desconhecido${origem}: "${first}". Comandos válidos: ${WORKER_COMMANDS.join(', ')}.`,
    };
  }

  if (rest.some((arg) => arg === '-h' || arg === '--help')) {
    return { kind: 'help' };
  }

  const aceitas = OPCOES_POR_COMANDO[first];
  const opcoes: Record<string, string | true> = {};

  for (const argumento of rest) {
    if (!argumento.startsWith('--')) {
      return { kind: 'error', message: `Argumento solto: "${argumento}". Use --opcao=valor.` };
    }
    const corpo = argumento.slice(2);
    const igual = corpo.indexOf('=');
    const nome = igual < 0 ? corpo : corpo.slice(0, igual);
    const valor = igual < 0 ? true : corpo.slice(igual + 1);

    if (!aceitas.includes(nome)) {
      const lista = aceitas.length > 0 ? aceitas.map((o) => `--${o}`).join(', ') : 'nenhuma';
      return {
        kind: 'error',
        message: `Opção não reconhecida em "${first}": --${nome}. Opções aceitas: ${lista}.`,
      };
    }
    opcoes[nome] = valor;
  }

  return { kind: 'run', command: first, opcoes };
}
