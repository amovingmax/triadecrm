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
  type EntradaDaFicha,
  type IntencaoDaFicha,
  INTENCOES_DA_FICHA,
  type SaidaDaFicha,
  SINAIS_NEGATIVOS,
  SINAIS_POSITIVOS,
  fichaDaConversaV1,
} from './prompts/ficha-da-conversa/v1';
export {
  CAMPOS_DO_PERFIL,
  INTENCOES_DO_CLIENTE,
  OBJECOES_DA_IMOVA,
  type CampoDoPerfil,
  type EntradaDaLeitura,
  type IntencaoDoCliente,
  type SaidaDaLeitura,
  leituraDoClienteV1,
} from './prompts/leitura-do-cliente/v1';

export {
  type SaidaDaLeituraV2,
  encurtarTexto,
  leituraDoClienteV2,
} from './prompts/leitura-do-cliente/v2';

export {
  ACOES_DO_ATENDENTE,
  CANAIS_DE_CHEGADA,
  type AcaoDoAtendente,
  type BaseDoAtendente,
  type EntradaDoAtendente,
  type ImovelDaBase,
  type SaidaDoAtendente,
  atendenteImovaV1,
  linhaDoImovel,
  montarBase,
  semTelefone,
  sistemaComBase,
} from './prompts/atendente-imova/v1';

export {
  type BaseDoAtendenteV2,
  type ImovelDaBaseV2,
  type SaidaDoAtendenteV2,
  atendenteImovaV2,
  jaRespondeuHoje,
  linhaDoImovelV2,
  montarBaseV2,
  sistemaComBaseV2,
} from './prompts/atendente-imova/v2';

export {
  ACOES_DO_ATENDENTE_V3,
  TIPOS_DA_AGENDA,
  type AcaoDoAtendenteV3,
  type ConviteDaAgenda,
  type EntradaDoAtendenteV3,
  type SaidaDoAtendenteV3,
  type TipoDaAgenda,
  atendenteImovaV3,
  haQuantoTempo,
  linhaDoConvite,
  sistemaComBaseV3,
} from './prompts/atendente-imova/v3';

export {
  BASE_DO_ENSAIO,
  CENARIOS_DO_ATENDENTE_V3,
  type CenarioDoAtendente,
  type EsperaDoCenario,
  TAMANHO_DA_MENSAGEM_DO_LINK,
  conferirCenario,
  mesmoCodigo,
} from './prompts/atendente-imova/cenarios-v3';

export { atendenteImovaV4, sistemaComBaseV4 } from './prompts/atendente-imova/v4';

export { BASE_DO_ENSAIO_V4, CENARIOS_DO_ATENDENTE_V4 } from './prompts/atendente-imova/cenarios-v4';

export { FRASE_DA_VISITA, atendenteImovaV5, sistemaComBaseV5 } from './prompts/atendente-imova/v5';

export {
  type EmailDoCliente,
  type EntradaDoAtendenteV6,
  FRASE_DO_CONVITE,
  RESPOSTAS_AS_OFERTAS,
  type RespostaAsOfertas,
  type SaidaDoAtendenteV6,
  atendenteImovaV6,
  linhaDoEmail,
  sistemaComBaseV6,
} from './prompts/atendente-imova/v6';

export {
  FERRAMENTA_BUSCAR_NO_MAPA,
  MAX_BUSCAS_NO_MAPA,
  MAX_VOLTAS_DO_ATENDENTE,
  atendenteImovaV7,
  sistemaComBaseV7,
} from './prompts/atendente-imova/v7';

export {
  BLOCO_DA_FOTO,
  LEGENDA_PADRAO_DA_FOTO,
  TETO_DA_LEGENDA,
  TROCAS_DO_CORRETOR,
  type SaidaDoAtendenteV8,
  atendenteImovaV8,
  sistemaComBaseV8,
} from './prompts/atendente-imova/v8';

export {
  BLOCO_DA_VISITA,
  PERIODOS_DA_VISITA,
  type SaidaDoAtendenteV9,
  atendenteImovaV9,
  sistemaComBaseV9,
} from './prompts/atendente-imova/v9';

export {
  BLOCO_DA_DECISAO,
  FRASE_DA_DECISAO,
  MAX_SUGESTOES,
  TIPOS_DE_DECISAO,
  type DecisaoDoAtendente,
  type SaidaDoAtendenteV10,
  type TipoDeDecisao,
  atendenteImovaV10,
  sistemaComBaseV10,
} from './prompts/atendente-imova/v10';

export {
  BLOCO_DAS_VANTAGENS,
  BLOCO_DO_QUE_O_CLIENTE_BUSCA,
  FERRAMENTA_BUSCAR_PERTO_DO_IMOVEL,
  MAX_BUSCAS_PERTO,
  MAX_VOLTAS_DO_ATENDENTE_V11,
  O_QUE_PROCURAR_PERTO,
  type OQueProcurarPerto,
  type SistemaDaV11,
  atendenteImovaV11,
  montarSistemaV11,
  sistemaComBaseV11,
  vantagemDoMotivo,
} from './prompts/atendente-imova/v11';

export {
  MOMENTOS_DE_MERCADO,
  NOMES_DOS_MOMENTOS,
  NOMES_DOS_PERFIS,
  NOMES_DOS_SINAIS,
  PERFIS_DO_CLIENTE,
  SINAIS_DE_MERCADO,
  TETO_DE_VANTAGENS_POR_IMOVEL,
  TETO_DO_NAO_USE,
  type BlocoDeVantagens,
  type DescartadaDoBloco,
  type MomentoDeMercado,
  type OpcoesDoBloco,
  type PerfilDoCliente,
  type SinalDeMercado,
  type VantagemDeMercado,
  type VantagemNoBloco,
  type VantagensDeMercado,
  type VantagensDoImovel,
  eValorizacao,
  lerVantagensDoBanco,
  mesPorExtenso,
  montarVantagens,
  perfisDaVantagem,
} from './prompts/atendente-imova/vantagens-de-mercado';

export {
  type EntradaDaRespostaDaDecisao,
  type SaidaDaRespostaDaDecisao,
  motivoParaNaoMandarDaDecisao,
  respostaDaDecisaoV1,
} from './prompts/resposta-da-decisao/v1';

export {
  BASE_DO_ENSAIO_V5,
  CENARIOS_DE_VISITA_V5,
  CENARIOS_DO_ATENDENTE_V5,
  conferirCenarioV5,
} from './prompts/atendente-imova/cenarios-v5';

export {
  CASOS_DA_BATERIA,
  type CasoDaBateria,
  GRUPOS_DA_BATERIA,
  type GrupoDaBateria,
  type RespostaParaConferir,
  TETO_DE_CARACTERES,
  casosDaBateria,
  conferirCasoDaBateria,
  contarPerguntas,
  entradaDoCaso,
  quandoDaFala,
} from './prompts/atendente-imova/bateria';

export {
  type EntradaDaRetomada,
  type SaidaDaRetomada,
  motivoParaNaoMandar,
  retomarConversaV1,
} from './prompts/retomar-conversa/v1';

export {
  type EntradaDaRetomadaV2,
  type SaidaDaRetomadaV2,
  motivoParaNaoMandarV2,
  retomarConversaV2,
} from './prompts/retomar-conversa/v2';

export {
  CERTEZAS_DA_FOTO,
  type EntradaDaFoto,
  type SaidaDaFoto,
  fotoDoAnuncioV1,
} from './prompts/foto-do-anuncio/v1';

export {
  CANAIS_NO_PROMPT,
  MARCAS_DA_FOTO,
  PECAS_DA_FOTO,
  SUBCANAIS_NO_PROMPT,
  TIPOS_DE_MENSAGEM_DO_CANAL,
  type CanalNoPrompt,
  type EntradaDoCanal,
  type SaidaDoCanal,
  canalDeChegadaV1,
  subcanalCabeNoCanal,
} from './prompts/canal-de-chegada/v1';

export {
  type ImagemAceita,
  type ImagemDescartada,
  type ImagemParaOModelo,
  ImagemNaoDeclaradaError,
  type ImagensConferidas,
  type MotivoDoDescarte,
  TIPOS_DE_IMAGEM_DA_API,
  type TipoDeImagem,
  conferirImagens,
  tipoPelosBytes,
} from './nucleo/imagens';

export {
  ACOES_DA_IA_NO_DIA,
  ATITUDES_DO_CLIENTE,
  INTERESSE_DO_CLIENTE,
  type EntradaDaAvaliacao,
  type SaidaDaAvaliacao,
  avaliacaoDoAtendimentoV1,
  saidaDaAvaliacaoV1,
} from './prompts/avaliacao-do-atendimento/v1';

export {
  LACUNAS_DO_ATENDIMENTO,
  type LacunaDoAtendimento,
  type SaidaDaAvaliacaoV2,
  avaliacaoDoAtendimentoV2,
} from './prompts/avaliacao-do-atendimento/v2';

export {
  FINALIDADES_DO_PERFIL,
  NEGOCIOS_DO_IMOVEL,
  NIVEIS_DE_INTERESSE,
  ORIGENS_DO_SINAL,
  PAGAMENTOS_DO_PERFIL,
  REGRA_DE_NAO_PROMETER,
  TIPOS_DO_PERFIL,
  type EntradaDoConselhoDoLead,
  type ImovelDaCarteira,
  type NivelDeInteresse,
  type SaidaDoConselhoDoLead,
  conselheiroDoLeadV1,
  prazoVencido,
} from './prompts/conselheiro-do-lead/v1';

export {
  TIPOS_DE_SUGESTAO,
  type EntradaDoConselhoDoImovel,
  type SaidaDoConselhoDoImovel,
  conselheiroDoImovelV1,
} from './prompts/conselheiro-do-imovel/v1';

export { type EntradaDoPulso, type SaidaDoPulso, pulsoDoDiaV1 } from './prompts/pulso-do-dia/v1';

export {
  REGRA_DO_QUE_FOI_DITO,
  TEMPERATURAS_DA_PASSAGEM,
  type EntradaDoResumoDaPassagem,
  type ResumoConferido,
  type SaidaDoResumoDaPassagem,
  type TemperaturaDaPassagem,
  conferirResumoDaPassagem,
  resumoDaPassagemV1,
} from './prompts/resumo-da-passagem/v1';

export {
  type EntradaDaTriagem,
  type SaidaDaTriagem,
  triagemDoRadarV1,
} from './prompts/triagem-do-radar/v1';

export {
  type EntradaDaTriagemV2,
  type SaidaDaTriagemV2,
  triagemDoRadarV2,
} from './prompts/triagem-do-radar/v2';

export {
  CATALOGO,
  INVENTARIO,
  type IdDePrompt,
  VIGENTES,
  obterPrompt,
  promptVigente,
  vigentes,
  type PromptDeQualquerVersao,
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
  verificarSemPiiNaConversa,
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
  type FerramentaDoPrompt,
  type ImagensDoPrompt,
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
