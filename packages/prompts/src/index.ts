/**
 * @komune/prompts — os prompts versionados dos fluxos de IA do Tríade (ADR-10).
 *
 * O que este pacote garante, e é por isso que ele existe:
 *
 * - **Versão é imutável.** Cada prompt é um objeto congelado com id, versão, modelo
 *   alvo, schema de entrada, schema de saída e texto. Publicar uma v2 não muda a v1.
 * - **Nada chega ao modelo sem pseudonimização.** `prepararChamada` é o único caminho, e
 *   ele confere a mensagem já montada antes de devolvê-la: telefone, e-mail ou @ que
 *   tenham sobrado derrubam a chamada (`PiiNaChamadaError`). A conferência é uma
 *   segunda implementação (`nucleo/auditoria-pii.ts`), independente da regra que
 *   pseudonimiza — de nada serviria auditar com a mesma regex.
 * - **Nada sai do modelo sem validação.** O JSON volta pelo schema da própria versão, e
 *   o rascunho que uma pessoa vai ler passa antes pelo validador de promessas.
 * - **Nada disso precisa de rede para ser testado.** Os evals rodam no Vitest, sem
 *   credencial: são fixtures de saída do modelo mais o código determinístico em volta.
 */

export {
  CATALOGO,
  INVENTARIO,
  type IdDePrompt,
  VIGENTES,
  obterPrompt,
  promptVigente,
} from './catalogo';

export {
  type ChamadaPreparada,
  TipoNaoAuditavelError,
  type TrechoDeFora,
  esquemaDeSaida,
  prepararChamada,
  raizDoCampo,
  trechosDeFora,
} from './nucleo/chamada';

export {
  PiiNaChamadaError,
  type ProblemaDePii,
  varrerMontagem,
  verificarSemPii,
} from './nucleo/auditoria-pii';

export {
  type ContextoDoContato,
  type MapaDePseudonimos,
  Pseudonimizador,
  type TipoDePii,
  chaveDeComparacao,
  pseudonimizar,
  reidratar,
} from './nucleo/pseudonimizacao';

export {
  COMPRIMENTOS_DE_TELEFONE,
  COMPRIMENTOS_LOCAIS,
  dddValido,
  eTelefoneBrasileiro,
  eTelefoneLocalBrasileiro,
  variantesDoTelefoneConhecido,
} from './nucleo/telefone-br';

export {
  FATOS,
  FRASE_DE_ESCAPE_FINANCEIRO,
  type FatoDaBase,
  NUNCA_AFIRMAR,
  TEMAS_FINANCEIROS_SEM_RESPOSTA,
  URLS_PERMITIDAS,
  VALORES_AUTORIZADOS,
  VERSAO_DA_BASE,
  baseComoTexto,
  fatoPorId,
} from './nucleo/base-conhecimento';

export {
  type CodigoDeBloqueio,
  type EntradaDaValidacao,
  LIMITES_PADRAO,
  type LimitesDoTexto,
  type MotivoDeBloqueio,
  type ResultadoDaValidacao,
  eDuvidaFinanceiraSemResposta,
  validarPromessas,
} from './nucleo/validador-promessas';

export {
  CHAMADAS_POR_MES,
  type EstadoDoOrcamento,
  FATOR_BATCH,
  FRACAO_DO_ALERTA,
  LIGACOES_ATENDIDAS_POR_DIA,
  LIMITE_DE_ALERTA_USD,
  ORCAMENTO_MENSAL_USD,
  type OpcoesDeCusto,
  PRECOS,
  type PrecoDoModelo,
  type ProjecaoDoPrompt,
  type SituacaoDoOrcamento,
  type UsoDeTokens,
  VOLUME_MENSAL,
  avaliarOrcamento,
  custoDaChamada,
  passouDoAlerta,
  projetar,
} from './nucleo/custos';

export { CARACTERES_POR_TOKEN_PT_BR, estimarTokens } from './nucleo/tokens';

export {
  type ExemploDePrompt,
  MODELOS,
  type MetadadosDePrompt,
  type ModeloAlvo,
  type PromptVersionado,
  type PropositoDeAiRun,
  definirPrompt,
  metadadosDoPrompt,
  selecionar,
  versaoDoPrompt,
} from './nucleo/versionamento';

export {
  type ContextoDaDecisao,
  type Decisao,
  LIMIAR_DE_CONFIANCA,
  LIMITE_DE_CARACTERES,
  type MotivoDeEscalada,
  REGRAS_DE_OPT_OUT,
  type RegraDeOptOut,
  type SaidaDoClassificador,
  TERMOS_DE_ALTO_VALOR,
  decidirIntencao,
  detectarOptOut,
} from './prompts/classificar-intencao/decisao';

export {
  FICHAS,
  INTENCOES,
  type FichaDaIntencao,
  type Intencao,
  type Responde,
  type Temperatura,
  fichaDa,
  taxonomiaComoTexto,
} from './prompts/classificar-intencao/intencoes';

export {
  type EntradaDaClassificacao,
  classificarIntencaoV1,
} from './prompts/classificar-intencao/v1';
export {
  type EntradaDoFollowUp,
  type SaidaDoFollowUp,
  followupLigacaoV1,
} from './prompts/followup-ligacao/v1';
export {
  type EntradaDoResumo,
  type SaidaDoResumo,
  resumoLigacaoV1,
} from './prompts/resumo-ligacao/v1';
export { viradaProvavel } from './prompts/resumo-ligacao/virada';
export {
  type EntradaDaTranscricao,
  type SaidaDaTranscricao,
  transcricaoAudioV1,
} from './prompts/transcricao-audio/v1';
export {
  type DecisaoDaTranscricao,
  type DestinoDaTranscricao,
  MAXIMO_DE_INAUDIVEIS,
  decidirRoteamento,
} from './prompts/transcricao-audio/roteamento';
