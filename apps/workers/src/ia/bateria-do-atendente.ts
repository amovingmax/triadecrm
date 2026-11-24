/**
 * `workers ai --ensaio=bateria`: a bateria de ensaio da IA que atende da Imova contra o
 * modelo de verdade (23/11/2026).
 *
 * Os 40 casos e a régua moram em `packages/prompts` (`atendente-imova/bateria.ts`) e são
 * provados sem rede no `pnpm test`. Aqui cada caso vai ao modelo pelo MESMO caminho da IA
 * que atende (`atendente.ts`): a base de produção (`ia_atendente_base`, caderno e imóveis
 * do dia), o modelo da configuração, a v7 com a busca no mapa quando o worker tem mapa,
 * a pseudonimização, a auditoria e o freio do orçamento. A resposta é reidratada e limpa
 * como a que o cliente leria, passa pela régua e, se pedido, pela IA avaliadora
 * (`avaliacao-do-atendimento@v2`), que dá a nota como dá às conversas reais.
 *
 * O que NÃO faz: não lê nem grava conversa, não chama `ia_atendente_responder` nem
 * nenhuma função que mande mensagem, não mexe no caderno nem nos anúncios. Grava só o que
 * toda chamada de IA grava (a linha em `ai_runs`, sem conversa, que é o que o freio do
 * orçamento conta) e o cache do mapa (`ia_lugares_no_mapa`), como uma busca real.
 *
 * O teto (`--teto`, em US$) é conferido antes de cada caso: passou, a rodada para e diz
 * até onde foi. O freio do orçamento do mês (`ia_pode_gastar`) continua valendo por cima.
 */
import {
  type ACOES_DA_IA_NO_DIA,
  type CasoDaBateria,
  type EntradaDaAvaliacao,
  type EntradaDoAtendenteV6,
  type PromptVersionado,
  type SaidaDaAvaliacaoV2,
  type SaidaDoAtendenteV6,
  MAX_BUSCAS_NO_MAPA,
  MAX_VOLTAS_DO_ATENDENTE,
  atendenteImovaV6,
  atendenteImovaV7,
  avaliacaoDoAtendimentoV2,
  casosDaBateria,
  conferirCasoDaBateria,
  entradaDoCaso,
  quandoDaFala,
  reidratar,
  sistemaComBaseV6,
  sistemaComBaseV7,
} from '@komune/prompts';

import { ErroDaEsteira } from '../fila/esteira';
import {
  baseDoBanco,
  limparTexto,
  modeloEscolhido,
  semOCalendlyNoTexto,
  semOLinkDaAgenda,
  soOPrimeiroNome,
} from './atendente';
import { type UsoDaBusca, ferramentaBuscarNoMapa } from './busca-no-mapa';
import {
  type ContextoDaIa,
  OrcamentoEsgotadoError,
  executar,
  executarComFerramentas,
} from './execucao';

/** O aviso que o CRM manda quando a IA passa sem texto (`ia.atendente.aviso_corretor`). */
const AVISO_PADRAO = 'Vou verificar isso direitinho e já te retorno por aqui.';

export interface OpcoesDaBateria {
  /** 7 (vigente, com a busca no mapa) ou 6 (sem mapa). */
  readonly versao: 6 | 7;
  /** Quantas vezes cada caso roda (a IA não responde sempre igual). */
  readonly repeticoes: number;
  /** Teto da rodada inteira, em US$, conferido antes de cada caso. */
  readonly tetoUsd: number;
  /** Chamar a IA avaliadora em cada resposta. */
  readonly juiza: boolean;
  /** Só estes casos (ids); vazio, todos. */
  readonly casos?: readonly string[];
}

export interface NotaDaJuiza {
  readonly duvida: number | null;
  readonly informacao: number | null;
  readonly satisfacao: number | null;
  readonly interesse: string;
  readonly lacuna: string;
  readonly melhorar: string | null;
}

export interface RespostaDaBateria {
  readonly caso: string;
  readonly rodada: number;
  readonly acao: SaidaDoAtendenteV6['acao'] | null;
  readonly mensagem: string;
  readonly agenda: SaidaDoAtendenteV6['agenda'];
  readonly buscas: readonly string[];
  readonly motivo: string;
  readonly confianca: number | null;
  readonly falhas: readonly string[];
  readonly nota: NotaDaJuiza | null;
  readonly custoUsd: number;
}

export interface ResultadoDaBateria {
  readonly promptVersion: string;
  readonly modelo: string;
  readonly baseVersao: unknown;
  readonly inicio: string;
  readonly fim: string;
  readonly repeticoes: number;
  readonly tetoUsd: number;
  /** A rodada parou antes do fim (teto ou orçamento do mês). */
  readonly parouEm: string | null;
  readonly respostas: readonly RespostaDaBateria[];
  readonly custoUsd: number;
}

async function rpc<T>(
  contexto: ContextoDaIa,
  funcao: string,
  argumentos: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await contexto.cliente.rpc(funcao, argumentos);
  if (error) throw new ErroDaEsteira(funcao, error.message);
  return data as T;
}

/** A ação do atendente como a avaliadora a conhece (`ia_respostas.acao`). */
function acaoNoDia(acao: SaidaDoAtendenteV6['acao']): (typeof ACOES_DA_IA_NO_DIA)[number] {
  switch (acao) {
    case 'passar_para_corretor':
      return 'passou_para_pessoa';
    case 'enviar_link_da_agenda':
      return 'enviou_link';
    case 'nao_responder':
      return 'nao_respondeu';
    case 'responder':
    default:
      return 'respondeu';
  }
}

/** O que o cliente veria: o texto, o aviso padrão na passagem sem texto, o link no fim. */
function oQueSaiu(acao: SaidaDoAtendenteV6['acao'], mensagem: string): string {
  if (acao === 'passar_para_corretor' && mensagem === '') return AVISO_PADRAO;
  if (acao === 'enviar_link_da_agenda') return `${mensagem}\n\n[link da agenda]`.trim();
  return mensagem;
}

/** A entrada da avaliadora: a conversa do caso mais a resposta, num dia só. */
export function entradaDaJuiza(
  caso: CasoDaBateria,
  acao: SaidaDoAtendenteV6['acao'],
  saiu: string,
): EntradaDaAvaliacao {
  const entrada = entradaDoCaso(caso);
  const quando = quandoDaFala(caso.agora, 0);
  return {
    leadId: entrada.leadId,
    dia: caso.agora.slice(0, 10),
    respostas: 1,
    acoes: [{ acao: acaoNoDia(acao), quando }],
    atitudeAntes: null,
    atitudeDepois: null,
    mensagens: [
      ...entrada.mensagens.map((m) => ({
        messageId: m.messageId,
        de: m.de === 'sistema' ? ('automatica' as const) : m.de,
        quando: m.quando,
        texto: (m.texto ?? '').slice(0, 1200),
      })),
      {
        messageId: `m${entrada.mensagens.length + 1}`,
        de: 'ia' as const,
        quando,
        texto: saiu.slice(0, 1200),
      },
    ],
  };
}

export async function rodarBateria(
  contexto: ContextoDaIa,
  opcoes: OpcoesDaBateria,
): Promise<ResultadoDaBateria> {
  if (contexto.empresa !== 'imova')
    throw new Error('a bateria é da IA que atende, que só existe na Imova');
  const comMapa = opcoes.versao === 7;
  const mapa = contexto.mapa;
  if (
    comMapa &&
    (mapa === undefined || typeof contexto.modelo.conversarComFerramentas !== 'function')
  ) {
    throw new Error(
      'a v7 precisa do mapa no worker (NOMINATIM_USER_AGENT); sem ele, rode com --versao=6',
    );
  }

  const lida = baseDoBanco.parse(await rpc(contexto, 'ia_atendente_base', {}));
  const base = {
    ...lida,
    caderno: lida.caderno.map((k) => ({ ...k, texto: semOLinkDaAgenda(k.texto) })),
  };
  const modelo = (await modeloEscolhido(contexto)) as typeof atendenteImovaV6.modelo;
  const prompt: PromptVersionado<EntradaDoAtendenteV6, SaidaDoAtendenteV6> = comMapa
    ? { ...atendenteImovaV7, modelo, sistema: sistemaComBaseV7(base) }
    : { ...atendenteImovaV6, modelo, sistema: sistemaComBaseV6(base) };
  const promptVersion = `${prompt.id}@v${prompt.versao}`;

  // Só existe com a v7 (conferido acima): é o que decide entre o laço e a chamada única.
  const busca = comMapa ? mapa : undefined;
  const casos = casosDaBateria(opcoes.casos);
  const respostas: RespostaDaBateria[] = [];
  const inicio = new Date().toISOString();
  let gasto = 0;
  let parouEm: string | null = null;

  rodadas: for (let rodada = 1; rodada <= opcoes.repeticoes; rodada += 1) {
    for (const caso of casos) {
      if (gasto >= opcoes.tetoUsd) {
        parouEm = `teto de US$ ${opcoes.tetoUsd.toFixed(2)} alcançado antes de ${caso.id} (rodada ${rodada})`;
        break rodadas;
      }
      const entrada = entradaDoCaso(caso);
      const contato = { leadId: entrada.leadId, nome: caso.nome, empresa: null };
      let custo = 0;
      // O que a IA procurou no mapa nesta resposta (a própria ferramenta anota).
      const uso: UsoDaBusca = { buscas: 0, consultas: [] };
      try {
        const executada =
          busca !== undefined
            ? await executarComFerramentas(
                contexto,
                prompt,
                entrada,
                contato,
                {},
                {
                  buscar_no_mapa: ferramentaBuscarNoMapa({
                    cliente: contexto.cliente,
                    busca,
                    logger: contexto.logger,
                    maxBuscas: MAX_BUSCAS_NO_MAPA,
                  }),
                },
                { maxVoltas: MAX_VOLTAS_DO_ATENDENTE },
              )
            : await executar(contexto, prompt, entrada, contato, {});
        custo += executada.custoUsd;
        const saida = executada.saida;
        const mensagem = semOCalendlyNoTexto(
          soOPrimeiroNome(limparTexto(reidratar(saida.mensagem, executada.mapa)), caso.nome),
        );
        const buscas = [...uso.consultas];
        const falhas = conferirCasoDaBateria(
          caso,
          {
            acao: saida.acao,
            mensagem,
            agenda: saida.agenda,
            ferramentas: buscas.map(() => 'buscar_no_mapa'),
          },
          { temMapa: comMapa },
        );

        let nota: NotaDaJuiza | null = null;
        if (opcoes.juiza && saida.acao !== 'nao_responder') {
          try {
            const avaliada = await executar<EntradaDaAvaliacao, SaidaDaAvaliacaoV2>(
              contexto,
              avaliacaoDoAtendimentoV2,
              entradaDaJuiza(caso, saida.acao, oQueSaiu(saida.acao, mensagem)),
              contato,
              {},
            );
            custo += avaliada.custoUsd;
            const s = avaliada.saida;
            nota = {
              duvida: s.duvida,
              informacao: s.informacao,
              satisfacao: s.satisfacao,
              interesse: s.interesse,
              lacuna: s.lacuna,
              melhorar:
                s.melhorar === null ? null : limparTexto(reidratar(s.melhorar, avaliada.mapa)),
            };
          } catch (erro) {
            if (erro instanceof OrcamentoEsgotadoError) throw erro;
            contexto.logger.warn('a avaliadora não deu nota a um caso da bateria', {
              caso: caso.id,
              erro: erro instanceof Error ? erro.message : String(erro),
            });
          }
        }

        respostas.push({
          caso: caso.id,
          rodada,
          acao: saida.acao,
          mensagem,
          agenda: saida.agenda,
          buscas,
          motivo: limparTexto(reidratar(saida.motivo, executada.mapa)),
          confianca: saida.confianca,
          falhas,
          nota,
          custoUsd: custo,
        });
      } catch (erro) {
        if (erro instanceof OrcamentoEsgotadoError) {
          parouEm = `o freio do orçamento do mês parou a rodada em ${caso.id} (rodada ${rodada})`;
          break rodadas;
        }
        const motivo = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro);
        respostas.push({
          caso: caso.id,
          rodada,
          acao: null,
          mensagem: '',
          agenda: null,
          buscas: [],
          motivo: '',
          confianca: null,
          falhas: [`a chamada falhou (${motivo.slice(0, 300)})`],
          nota: null,
          custoUsd: custo,
        });
      }
      gasto += custo;
      contexto.logger.info('bateria: caso feito', {
        caso: caso.id,
        rodada,
        certo: respostas.at(-1)?.falhas.length === 0,
        gasto_usd: Number(gasto.toFixed(4)),
      });
    }
  }

  return {
    promptVersion,
    modelo,
    baseVersao: base.versao ?? null,
    inicio,
    fim: new Date().toISOString(),
    repeticoes: opcoes.repeticoes,
    tetoUsd: opcoes.tetoUsd,
    parouEm,
    respostas,
    custoUsd: gasto,
  };
}

/** Média das notas que existem, com uma casa; sem nenhuma, "—". */
function media(valores: readonly (number | null | undefined)[]): string {
  const ok = valores.filter((v): v is number => typeof v === 'number');
  return ok.length === 0 ? '—' : (ok.reduce((a, b) => a + b, 0) / ok.length).toFixed(1);
}

/** O relatório que o comando imprime: o placar, os casos e o que errou. */
export function relatorioDaBateria(r: ResultadoDaBateria): string {
  const porCaso = new Map<string, RespostaDaBateria[]>();
  for (const resposta of r.respostas)
    porCaso.set(resposta.caso, [...(porCaso.get(resposta.caso) ?? []), resposta]);
  const certas = r.respostas.filter((x) => x.falhas.length === 0).length;
  const linhas = [
    `Bateria de ${r.promptVersion} no ${r.modelo}: ${certas} de ${r.respostas.length} respostas certas (${porCaso.size} casos × até ${r.repeticoes})`,
    `Notas da avaliadora (média): dúvida ${media(r.respostas.map((x) => x.nota?.duvida))} · informação ${media(r.respostas.map((x) => x.nota?.informacao))}`,
    `Custo: US$ ${r.custoUsd.toFixed(4)} (teto US$ ${r.tetoUsd.toFixed(2)})${r.parouEm ? ` · PAROU: ${r.parouEm}` : ''}`,
    '',
  ];
  for (const [caso, lista] of porCaso) {
    const ok = lista.filter((x) => x.falhas.length === 0).length;
    linhas.push(`${ok === lista.length ? '✓' : '✗'} ${caso} ${ok}/${lista.length}`);
    for (const x of lista) {
      const busca = x.buscas.length > 0 ? ` [mapa: ${x.buscas.join('; ')}]` : '';
      linhas.push(
        `    ${x.rodada}. ${x.acao ?? 'falhou'}${busca}: ${x.mensagem.replace(/\s+/g, ' ')}`,
      );
      for (const falha of x.falhas) linhas.push(`       → ${falha}`);
    }
  }
  return `${linhas.join('\n')}\n`;
}
