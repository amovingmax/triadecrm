/**
 * As 25 intenções (R08 §1; PRD Apêndice C; RF-CON-19 e RF-CON-20).
 *
 * A contagem: as 24 linhas numeradas do R08 §1, cada uma um rótulo do classificador,
 * mais `AUTORIZA_PRE_CADASTRO`, que o PRD acrescentou para o caminho curto do RF-CON-21
 * ("autorizo", "manda o link" leva direto a Autorizou, sem reunião). Os nomes com barra
 * no R08 (`NAO_E_A_PESSOA / NUMERO_ERRADO`) são um rótulo só com apelidos — estão em
 * `apelidos` para o classificador não inventar um 26º.
 */

export const INTENCOES = [
  'INTERESSADO',
  'AUTORIZA_PRE_CADASTRO',
  'QUER_SABER_MAIS',
  'PEDIU_TAXA_PRECO',
  'JA_USO_OUTRO',
  'NAO_TRABALHO_COM_COMISSAO',
  'MANDA_MATERIAL',
  'ME_CHAMA_DEPOIS',
  'SEM_INTERESSE_SUAVE',
  'SEM_INTERESSE_FIRME',
  'NAO_E_A_PESSOA',
  'QUEM_E_VOCE',
  'E_ROBO',
  'OPT_OUT',
  'HOSTIL',
  'AGENDAMENTO_ACEITO',
  'AGENDAMENTO_CONTRAPROPOSTA',
  'REAGENDAR',
  'PEDIU_LIGACAO',
  'INDICACAO',
  'JA_CADASTRADO',
  'PERGUNTA_CONTRATUAL',
  'FORA_ESCOPO',
  'AMBIGUO',
  'SILENCIO',
] as const;

export type Intencao = (typeof INTENCOES)[number];

/** Quem responde, segundo o R08 §5.2. */
export type Responde = 'texto_fixo' | 'ia' | 'humano' | 'cadencia';

/** As temperaturas do PRD §5. `null` = a intenção não mexe na temperatura. */
export type Temperatura = 'frio' | 'morno' | 'quente' | 'cliente' | 'dormente' | 'bloqueado' | null;

export interface FichaDaIntencao {
  readonly intencao: Intencao;
  readonly apelidos: readonly string[];
  readonly exemplos: readonly string[];
  readonly responde: Responde;
  readonly temperatura: Temperatura;
  /** Prioridade absoluta sobre qualquer outra intenção da mesma mensagem (R08 §1). */
  readonly prioridadeAbsoluta: boolean;
  /**
   * Peso no funil, para o desempate do R08 §1: "quanto é a taxa? me chama sexta" →
   * responde a taxa e agenda; ganha quem move mais o negócio.
   */
  readonly impacto: number;
  readonly acao: string;
}

export const FICHAS: readonly FichaDaIntencao[] = [
  {
    intencao: 'OPT_OUT',
    apelidos: ['SAIR', 'BLOQUEAR'],
    exemplos: [
      'para',
      'pare de me mandar mensagem',
      'sair',
      'remove meu número',
      'não me ligue mais',
    ],
    responde: 'texto_fixo',
    temperatura: 'bloqueado',
    prioridadeAbsoluta: true,
    impacto: 100,
    acao: 'supressão imediata em todos os canais, confirmação de uma linha, sai de toda cadência',
  },
  {
    intencao: 'HOSTIL',
    apelidos: ['RECLAMACAO'],
    exemplos: ['vocês são chatos', 'me ligaram três vezes', 'que saco esse pessoal'],
    responde: 'humano',
    temperatura: null,
    prioridadeAbsoluta: true,
    impacto: 95,
    acao: 'pede desculpa, pausa a cadência, abre tarefa humana; nada automático além do pedido de desculpa',
  },
  {
    intencao: 'NAO_E_A_PESSOA',
    apelidos: ['NUMERO_ERRADO'],
    exemplos: ['não sou o dono', 'número errado', 'aqui é pessoal', 'aqui não é o buffet'],
    responde: 'texto_fixo',
    temperatura: 'frio',
    prioridadeAbsoluta: true,
    impacto: 90,
    acao: 'pede desculpa, pergunta o contato certo uma vez, marca telefone inválido',
  },
  {
    intencao: 'AUTORIZA_PRE_CADASTRO',
    apelidos: [],
    exemplos: ['autorizo', 'pode criar', 'manda o link', 'pode usar as fotos'],
    responde: 'texto_fixo',
    temperatura: 'quente',
    prioridadeAbsoluta: false,
    impacto: 80,
    acao: 'grava a evidência literal em consent_events, cria o rascunho e manda o link de reivindicação',
  },
  {
    intencao: 'AGENDAMENTO_ACEITO',
    apelidos: [],
    exemplos: ['quinta 9h30 tá bom', 'pode ser de tarde', 'a primeira opção'],
    responde: 'texto_fixo',
    temperatura: 'quente',
    prioridadeAbsoluta: false,
    impacto: 75,
    acao: 'confirma dia, hora e formato, cria o evento e dispara a sequência anti no-show',
  },
  {
    intencao: 'AGENDAMENTO_CONTRAPROPOSTA',
    apelidos: [],
    exemplos: ['só posso sexta às 16h', 'de manhã não dá'],
    responde: 'ia',
    temperatura: 'quente',
    prioridadeAbsoluta: false,
    impacto: 70,
    acao: 'aceita se cabe na regra (vídeo de manhã, visita à tarde); senão oferece duas alternativas',
  },
  {
    intencao: 'REAGENDAR',
    apelidos: ['NAO_VAI_PODER'],
    exemplos: ['não vou conseguir hoje', 'podemos remarcar?'],
    responde: 'texto_fixo',
    temperatura: 'quente',
    prioridadeAbsoluta: false,
    impacto: 68,
    acao: 'dois horários nas próximas 48 h, sem drama; no segundo reagendamento, humano liga',
  },
  {
    intencao: 'PEDIU_LIGACAO',
    apelidos: [],
    exemplos: ['me liga', 'melhor por telefone', 'prefiro falar'],
    responde: 'humano',
    temperatura: 'quente',
    prioridadeAbsoluta: false,
    impacto: 66,
    acao: 'tarefa urgente de ligação em até 30 min no horário comercial',
  },
  {
    intencao: 'INTERESSADO',
    apelidos: [],
    exemplos: ['pode mandar', 'quero saber mais', 'como funciona?', 'tenho interesse'],
    responde: 'texto_fixo',
    temperatura: 'quente',
    prioridadeAbsoluta: false,
    impacto: 60,
    acao: 'aviso de áudio + áudio do segmento; se já houve áudio, CTA com dois horários',
  },
  {
    intencao: 'PEDIU_TAXA_PRECO',
    apelidos: [],
    exemplos: ['quanto custa?', 'qual a taxa?', 'tem mensalidade?'],
    responde: 'texto_fixo',
    temperatura: 'quente',
    prioridadeAbsoluta: false,
    impacto: 58,
    acao: 'responde a taxa exata sem enrolar e propõe a reunião; nunca esconde até a reunião',
  },
  {
    intencao: 'PERGUNTA_CONTRATUAL',
    apelidos: [],
    exemplos: [
      'tem contrato?',
      'quando cai o dinheiro?',
      'emite nota?',
      'e se o cliente cancelar?',
    ],
    responde: 'humano',
    temperatura: 'quente',
    prioridadeAbsoluta: false,
    impacto: 56,
    acao: 'só o que está na FAQ aprovada; fora dela, a frase de escape do financeiro e tarefa humana',
  },
  {
    intencao: 'INDICACAO',
    apelidos: [],
    exemplos: ['fala com a Ana, ela cuida disso', 'o dono é o Marcos'],
    responde: 'texto_fixo',
    temperatura: 'frio',
    prioridadeAbsoluta: false,
    impacto: 54,
    acao: 'agradece e cria alvo novo com origem "indicação de [nome]", prioridade alta',
  },
  {
    intencao: 'JA_CADASTRADO',
    apelidos: ['JA_E_CLIENTE'],
    exemplos: ['já fiz meu cadastro', 'já tô no app'],
    responde: 'texto_fixo',
    temperatura: 'cliente',
    prioridadeAbsoluta: false,
    impacto: 52,
    acao: 'verifica na plataforma; incompleto vai para onboarding, publicado vira pedido de feedback',
  },
  {
    intencao: 'QUER_SABER_MAIS',
    apelidos: [],
    exemplos: ['como o cliente me acha?', 'e o pagamento, como chega?', 'tem app pra mim?'],
    responde: 'ia',
    temperatura: 'morno',
    prioridadeAbsoluta: false,
    impacto: 50,
    acao: 'até 4 linhas usando só a base aprovada, terminando com uma pergunta de avanço',
  },
  {
    intencao: 'NAO_TRABALHO_COM_COMISSAO',
    apelidos: [],
    exemplos: ['não pago comissão', '8% é muito', 'não trabalho com porcentagem'],
    responde: 'ia',
    temperatura: 'morno',
    prioridadeAbsoluta: false,
    impacto: 48,
    acao: 'reenquadra (paga quando fecha, o preço é seu); na segunda vez, humano',
  },
  {
    intencao: 'JA_USO_OUTRO',
    apelidos: [],
    exemplos: ['já tô no Casamentos.com', 'meu Instagram já dá conta'],
    responde: 'ia',
    temperatura: 'morno',
    prioridadeAbsoluta: false,
    impacto: 46,
    acao: 'não ataca o concorrente, complementa, e faz uma pergunta de descoberta',
  },
  {
    intencao: 'MANDA_MATERIAL',
    apelidos: [],
    exemplos: ['manda por escrito', 'tem um PDF?', 'manda o site'],
    responde: 'texto_fixo',
    temperatura: 'morno',
    prioridadeAbsoluta: false,
    impacto: 44,
    acao: 'imagem-resumo e link, com pergunta de compromisso e follow-up em D+2',
  },
  {
    intencao: 'ME_CHAMA_DEPOIS',
    apelidos: [],
    exemplos: ['me chama semana que vem', 'agora não dá', 'depois do evento de sábado'],
    responde: 'ia',
    temperatura: 'morno',
    prioridadeAbsoluta: false,
    impacto: 42,
    acao: 'extrai a data e agenda o retorno; sem data, propõe uma',
  },
  {
    intencao: 'QUEM_E_VOCE',
    apelidos: ['DESCONFIANCA'],
    exemplos: ['quem é você?', 'como conseguiu meu número?', 'isso é golpe?'],
    responde: 'texto_fixo',
    temperatura: 'morno',
    prioridadeAbsoluta: false,
    impacto: 40,
    acao: 'quem somos, a origem específica do contato e os canais oficiais; se persistir, humano',
  },
  {
    intencao: 'E_ROBO',
    apelidos: [],
    exemplos: ['é robô?', 'tô falando com um bot?'],
    responde: 'texto_fixo',
    temperatura: null,
    prioridadeAbsoluta: false,
    impacto: 38,
    acao: 'resposta honesta; áudio e reunião são sempre humanos',
  },
  {
    intencao: 'SEM_INTERESSE_FIRME',
    apelidos: [],
    exemplos: ['não tenho interesse', 'não quero', 'não insiste'],
    responde: 'texto_fixo',
    temperatura: 'frio',
    prioridadeAbsoluta: false,
    impacto: 36,
    acao: 'uma mensagem de encerramento, sem pergunta; sai de toda cadência e não reativa sozinho',
  },
  {
    intencao: 'SEM_INTERESSE_SUAVE',
    apelidos: [],
    exemplos: ['obrigado, mas não', 'não é pra mim agora', 'não tô buscando'],
    responde: 'texto_fixo',
    temperatura: 'frio',
    prioridadeAbsoluta: false,
    impacto: 34,
    acao: 'agradece, deixa a porta aberta e pergunta o motivo em uma linha; reativável com gancho',
  },
  {
    intencao: 'FORA_ESCOPO',
    apelidos: [],
    exemplos: [
      'quero contratar um DJ pro meu aniversário',
      'vocês vendem ingresso?',
      'atende em João Pessoa?',
    ],
    responde: 'ia',
    temperatura: null,
    prioridadeAbsoluta: false,
    impacto: 20,
    acao: 'uma linha e roteia: quem quer contratar vira lead do app, outra cidade vira registro',
  },
  {
    intencao: 'AMBIGUO',
    apelidos: ['SO_EMOJI', 'OK'],
    exemplos: ['ok', 'hum', 'kkk'],
    responde: 'ia',
    temperatura: null,
    prioridadeAbsoluta: false,
    impacto: 10,
    acao: 'uma pergunta curta de esclarecimento, nunca duas',
  },
  {
    intencao: 'SILENCIO',
    apelidos: [],
    exemplos: [],
    responde: 'cadencia',
    temperatura: null,
    prioridadeAbsoluta: false,
    impacto: 0,
    acao: 'o toque seguinte da régua; depois do quinto sem resposta, dormente',
  },
] as const;

const POR_INTENCAO = new Map(FICHAS.map((ficha) => [ficha.intencao, ficha]));

export function fichaDa(intencao: Intencao): FichaDaIntencao {
  const ficha = POR_INTENCAO.get(intencao);
  if (ficha === undefined) throw new Error(`Intenção sem ficha: ${intencao}.`);
  return ficha;
}

/** O bloco da taxonomia que vai no `system` do classificador. Estável = cacheável. */
export function taxonomiaComoTexto(): string {
  return FICHAS.map((ficha) => {
    const apelidos = ficha.apelidos.length > 0 ? ` (também: ${ficha.apelidos.join(', ')})` : '';
    const exemplos =
      ficha.exemplos.length > 0 ? ` — ex.: ${ficha.exemplos.map((e) => `"${e}"`).join('; ')}` : '';
    return `- ${ficha.intencao}${apelidos}${exemplos}`;
  }).join('\n');
}
