/**
 * DUBLÊ DO MODELO — não vai para produção, não é deploy, não é a Anthropic.
 *
 * É o outro lado da linha enquanto não há credencial (e enquanto ela não
 * existir, este é o único outro lado). Serve para o mesmo binário, com o mesmo
 * `ClienteDoModelo`, exercitar o caminho inteiro: pseudonimização, chamada,
 * validação da saída pelo schema da versão, validador de promessas, `ai_runs`
 * com os quatro contadores de token e o custo saindo da tabela de preços.
 *
 * Três coisas ele faz de verdade, e são as três que os testes medem:
 *
 * 1. **Descobre qual prompt está falando pelo ESQUEMA pedido**, não pelo texto
 *    do sistema. O esquema é o contrato da versão; o texto muda a cada revisão
 *    de redação. Prompt novo com campos novos falha barulhento aqui.
 * 2. **Devolve saída derivada da entrada**, e não uma constante. É isso que faz
 *    o teste provar que os marcadores `[[NOME_1]]` atravessam o modelo intactos
 *    e voltam reidratados só na hora em que uma pessoa lê.
 * 3. **Conta tokens e simula o cache**: o bloco de sistema é escrito no cache na
 *    primeira chamada e lido nas seguintes. Sem isso os quatro contadores de
 *    `ai_runs` nunca seriam exercitados, e a coluna que ninguém escreve é a
 *    coluna cuja conta ninguém confere.
 *
 * O que ele NÃO é: um modelo. A qualidade do texto não se mede aqui — mede-se
 * nos evals de `packages/prompts`, com fixture, que é onde ela cabe.
 */
import { estimarTokens } from '@komune/prompts';

import type { PedidoAoModelo, RespostaDoModelo, UsoDoModelo } from './cliente';

/** Qual dos fluxos o esquema pedido descreve. */
export type FluxoDoDuble =
  | 'canal'
  | 'transcricao'
  | 'resumo'
  | 'followup'
  | 'classificacao'
  | 'ficha'
  | 'leitura'
  | 'pulso'
  | 'atendente'
  | 'juiza'
  | 'conselheiro_lead'
  | 'conselheiro_imovel';

export class EsquemaDesconhecidoError extends Error {
  constructor(campos: readonly string[]) {
    super(
      `O dublê não reconhece o esquema pedido (campos: ${campos.join(', ') || 'nenhum'}). ` +
        'Prompt novo precisa de resposta nova aqui — silenciar isto seria testar o dublê, não o worker.',
    );
    this.name = 'EsquemaDesconhecidoError';
  }
}

function camposDoEsquema(esquema: Record<string, unknown>): string[] {
  const propriedades = esquema.properties;
  if (typeof propriedades !== 'object' || propriedades === null) return [];
  return Object.keys(propriedades as Record<string, unknown>);
}

export function fluxoDoEsquema(esquema: Record<string, unknown>): FluxoDoDuble {
  const campos = new Set(camposDoEsquema(esquema));
  // O canal de chegada (Imova, 06/11/2026) vem primeiro: `subcanal` só existe nele, e
  // ele tem `confianca` e `motivo`, que outros também têm.
  if (campos.has('subcanal')) return 'canal';
  if (campos.has('textoLimpo')) return 'transcricao';
  // A IA que atende o cliente da Imova (06/11/2026): é a única que devolve uma ação
  // e as anotações do treino.
  if (campos.has('acao') && campos.has('anotacoes')) return 'atendente';
  // A IA juíza da Imova (06/11/2026): é a única que devolve a satisfação do cliente.
  if (campos.has('satisfacao')) return 'juiza';
  // O conselheiro de vendas da Imova (09/11/2026): por cliente, o único que diz o que
  // falar; por imóvel, o único que devolve sugestões.
  if (campos.has('imoveis') && campos.has('falar')) return 'conselheiro_lead';
  if (campos.has('sugestoes')) return 'conselheiro_imovel';
  // A ficha vem antes da classificação: ela também tem `intencao`, mas o que a
  // distingue é o score e os sinais que o sustentam (CRM Inteligente, Fase 1).
  if (campos.has('scoreIntencao')) return ehLeituraDoCliente(esquema) ? 'leitura' : 'ficha';
  // O Pulso é o único que tem prioridades e um título: ele fala do dia, não de
  // uma conversa (CRM Inteligente, Fase 2).
  if (campos.has('prioridades')) return 'pulso';
  if (campos.has('noDeVirada')) return 'resumo';
  if (campos.has('claims')) return 'followup';
  if (campos.has('intencao')) return 'classificacao';
  throw new EsquemaDesconhecidoError([...campos]);
}

/** O trecho da mensagem depois de um cabeçalho em caixa alta ("CAMINHO NO ROTEIRO:"). */
function secao(mensagem: string, cabecalho: string): string {
  const inicio = mensagem.indexOf(cabecalho);
  if (inicio === -1) return '';
  return mensagem.slice(inicio + cabecalho.length).trim();
}

function campo(mensagem: string, rotulo: string): string | null {
  for (const linha of mensagem.split('\n')) {
    if (linha.startsWith(`${rotulo}: `)) {
      const valor = linha.slice(rotulo.length + 2).trim();
      return valor === '—' ? null : valor;
    }
  }
  return null;
}

function limitar(texto: string, maximo: number): string {
  return texto.length <= maximo ? texto : `${texto.slice(0, maximo - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// As quatro respostas
// ---------------------------------------------------------------------------

function transcrever(mensagem: string): Record<string, unknown> {
  const bruta = secao(mensagem, 'TRANSCRIÇÃO BRUTA:');
  // "Limpar" aqui é uma regra de brinquedo, e de propósito: tirar hesitação e
  // marcar ruído como [inaudível] é o suficiente para o worker ter texto
  // diferente do que entrou, que é o que ele precisa gravar.
  const limpo = bruta
    .replace(/\[ru[íi]do\]/gi, '[inaudível]')
    // Sem \b: em JavaScript a fronteira de palavra não enxerga "é" como letra,
    // e a hesitação mais comum do corpus começa justamente com ela.
    .replace(/(?:é\.\.\.|ãhn|tipo assim)\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const inaudiveis = (limpo.match(/\[inaudível\]/g) ?? []).length;
  const confiancaAsr = Number(campo(mensagem, 'confiança do reconhecimento') ?? '1');
  const confianca = inaudiveis > 2 || confiancaAsr < 0.6 ? 'baixa' : 'alta';
  return {
    textoLimpo: limpo.length === 0 ? '[inaudível]' : limpo,
    trechosInaudiveis: inaudiveis,
    confianca,
    precisaDeHumano: confianca === 'baixa' || /contrato|dinheiro|reclama/i.test(limpo),
    resumo: limitar(limpo.replace(/\s+/g, ' '), 140),
    entidades: { datas: [], valores: [], nomesCitados: [], plataformas: [] },
  };
}

function resumir(mensagem: string): Record<string, unknown> {
  const caminho = secao(mensagem, 'CAMINHO NO ROTEIRO:').split('\n\n')[0] ?? '';
  const anotacao = secao(mensagem, 'ANOTAÇÃO DE QUEM LIGOU:');
  // A âncora `^\d+\. ` é a forma que `resumo-ligacao@v1` imprime cada nó. Sem
  // ela, os marcadores da própria fala do roteiro ([dia], [hora], [empresa])
  // entrariam na contagem — e um dublê que lê errado prova a coisa errada.
  const nos = [...caminho.matchAll(/^\d+\. \[([a-z0-9_]+)\]/gm)].map((achado) => achado[1] ?? '');
  const virada = nos.find((no) => no.startsWith('obj_')) ?? null;
  const desfecho = campo(mensagem, 'desfecho tabulado') ?? 'lig_atendeu_retorna';
  const partes = [
    `Ligação tabulada como ${desfecho}, com ${nos.length} passos no roteiro.`,
    virada === null ? null : `A conversa virou em ${virada}.`,
    anotacao === '—' || anotacao === '' ? null : limitar(anotacao, 160),
  ].filter((parte): parte is string => parte !== null);
  return {
    resumo: limitar(partes.join(' '), 320),
    combinado: anotacao === '—' || anotacao === '' ? null : limitar(anotacao, 240),
    objecoes: virada === null ? [] : [`Apareceu ${virada}`],
    fatos: [],
    noDeVirada: virada,
    precisaDeRevisao: false,
  };
}

function redigir(mensagem: string): Record<string, unknown> {
  const combinado = campo(mensagem, 'combinado');
  const resumo = secao(mensagem, 'RESUMO DA LIGAÇÃO:');
  const retomada = limitar(resumo.replace(/\s+/g, ' '), 90);
  const linhas = [
    'Oi, [[NOME_1]], foi bom falar com você agora há pouco.',
    `Só pra registrar o que ficou: ${retomada}`,
    combinado === null ? 'Posso te ligar amanhã às 10h?' : `${limitar(combinado, 90)} Confirma pra mim?`,
  ];
  return {
    mensagem: limitar(linhas.join('\n'), 300),
    claims: [],
    audioSugerido: null,
    porQue: 'Retoma a ligação pelo que ficou combinado e faz uma pergunta só.',
  };
}

const PISTAS_DE_INTENCAO: readonly (readonly [RegExp, string, number])[] = [
  [/\bquanto\b|\btaxa\b|\bpre[çc]o\b|\bcomiss/i, 'PEDIU_TAXA_PRECO', 0.88],
  [/n[ãa]o sou eu|falar? com [ao] /i, 'NAO_E_A_PESSOA', 0.9],
  [/\bcontrato\b|nota fiscal|repasse/i, 'PERGUNTA_CONTRATUAL', 0.86],
  [/me chama|depois|semana que vem|sexta/i, 'ME_CHAMA_DEPOIS', 0.82],
  [/quero|tenho interesse|bora|vamos/i, 'INTERESSADO', 0.85],
  [/manda|me envia|material/i, 'MANDA_MATERIAL', 0.8],
];

function classificar(mensagem: string): Record<string, unknown> {
  const texto = secao(mensagem, 'MENSAGEM RECEBIDA:');
  const achadas = PISTAS_DE_INTENCAO.filter(([padrao]) => padrao.test(texto));
  const principal = achadas[0];
  const segunda = achadas[1];
  return {
    intencao: principal?.[1] ?? 'AMBIGUO',
    confianca: principal?.[2] ?? 0.5,
    segundaIntencao: segunda?.[1] ?? null,
    sentimento: /obrigad|[óo]timo|legal|show/i.test(texto) ? 'positivo' : 'neutro',
    entidades: {
      dataHora: /sexta|segunda|amanh[ãa]|\d{1,2}h/i.exec(texto)?.[0] ?? null,
      nomeCitado: null,
      plataformaCitada: /casamentos\.com|instagram|getninjas/i.exec(texto)?.[0] ?? null,
      motivo: null,
    },
  };
}

/**
 * A ficha do dublê: lê o que dá para ler da própria mensagem montada (a última
 * mensagem do parceiro) e devolve um dossiê coerente com ela. Não é inteligência —
 * é fixture que responde ao que entrou, para o teste do worker exercitar validação,
 * corte de evidência e gravação com dado que muda.
 */
function ficharConversa(mensagem: string): Record<string, unknown> {
  const linhas = mensagem.split('\n').filter((l) => l.startsWith('['));
  const ultima = linhas[linhas.length - 1] ?? '';
  const messageId = /^\[([^\]]+)\]/.exec(ultima)?.[1] ?? 'm1';
  const texto = ultima.slice(ultima.indexOf(':') + 1).trim();
  const pediuProposta = /proposta|or[çc]amento/i.test(texto);

  return {
    resumo: limitar(texto === '' ? 'Conversa sem conteúdo novo.' : texto, 400),
    intencao: pediuProposta ? 'PEDIU_PROPOSTA' : 'AMBIGUO',
    scoreIntencao: pediuProposta ? 82 : 20,
    motivo: pediuProposta ? 'Pediu proposta na última mensagem.' : 'Nada concreto na conversa.',
    sentimento: 'neutro',
    sinais: pediuProposta
      ? [
          {
            tipo: 'pediu_proposta',
            polaridade: 'positivo',
            forca: 'forte',
            messageId,
            trecho: limitar(texto, 120),
          },
        ]
      : [],
    objecoes: [],
    etapaSugerida: null,
    compromissosNovos: [],
    compromissosCumpridos: [],
    proximaAcao: {
      descricao: pediuProposta ? 'Mandar a proposta pedida' : 'Perguntar o que o parceiro precisa',
      prazo: null,
    },
    dadosExtraidos: [],
    alertas: pediuProposta ? ['pediu_proposta'] : [],
    confianca: 0.8,
    dadosInsuficientes: !pediuProposta,
  };
}

/**
 * A leitura do cliente da Imova tem a forma da ficha; o que a distingue é o
 * vocabulário de imobiliária, que aparece na lista fechada das intenções.
 */
function ehLeituraDoCliente(esquema: Record<string, unknown>): boolean {
  const propriedades = (esquema.properties ?? {}) as Record<string, { enum?: unknown }>;
  const intencoes = propriedades.intencao?.enum;
  return Array.isArray(intencoes) && intencoes.includes('PEDIU_VISITA');
}

const BAIRROS_DE_NATAL = [
  'Ponta Negra',
  'Tirol',
  'Petrópolis',
  'Lagoa Nova',
  'Capim Macio',
  'Candelária',
  'Neópolis',
  'Nova Parnamirim',
  'Pitimbu',
  'Barro Vermelho',
  'Lagoa Seca',
  'Areia Preta',
  'Cidade Alta',
  'Ribeira',
  'Alecrim',
];

/**
 * A leitura do cliente no dublê (Imova, 03/11/2026): lê a última mensagem do
 * cliente e devolve uma leitura coerente com ela — visita, financiamento, preço,
 * "achei caro" — e o perfil que dá para tirar por padrão de texto (tipo, bairro,
 * quartos, valor). Não é inteligência: é o outro lado da linha para o teste local
 * mostrar a ficha preenchida sem chave e sem custo. O resumo começa com
 * "Simulação:" para ninguém confundir com a leitura de verdade.
 */
function lerClienteNoDuble(mensagem: string): Record<string, unknown> {
  const doCliente = mensagem.split('\n').filter((l) => /^\[[^\]]+\] .* cliente: /.test(l));
  const ultima = doCliente[doCliente.length - 1] ?? '';
  const messageId = /^\[([^\]]+)\]/.exec(ultima)?.[1] ?? 'm1';
  const texto = ultima.slice(ultima.indexOf(' cliente: ') + ' cliente: '.length).trim();
  const tudo = doCliente.map((l) => l.slice(l.indexOf(' cliente: ') + 10)).join(' ');

  const proprietario = mensagem.includes('caminho: proprietário');
  const disponivel = /dispon[íi]vel|ainda tem|ainda est[áa]/i.test(texto);
  const visita =
    /visit|conhecer|ir ver|dá para ver|da pra ver|agendar/i.test(texto) ||
    /(s[áa]bado|domingo|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta).*(\d{1,2}\s*h|pode ser)/i.test(
      texto,
    );
  const quemDecide = /\b(esposa|marido|mulher|s[óo]cio|fam[íi]lia)\b/i.exec(texto)?.[1];
  const decideJunto = quemDecide !== undefined && /decide|junto|ver com/i.test(texto);
  const caro = /caro|vou pensar|pensar melhor/i.test(texto);
  const financiamento = /financ|fgts|cons[óo]rcio/i.test(texto);
  const preco = /pre[çc]o|valor|quanto/i.test(texto);

  const dados: Record<string, unknown>[] = [];
  const tipo = /apartamento|casa|terreno|sala comercial|cobertura|flat/i.exec(tudo)?.[0];
  if (tipo)
    dados.push({ campo: 'tipo_imovel', valor: tipo.toLowerCase(), confianca: 0.8, messageId });
  const bairro = BAIRROS_DE_NATAL.find((b) => tudo.toLowerCase().includes(b.toLowerCase()));
  if (bairro) dados.push({ campo: 'bairros', valor: bairro, confianca: 0.8, messageId });
  const quartos = /(\d)\s*quartos?/i.exec(tudo)?.[1];
  if (quartos) dados.push({ campo: 'quartos', valor: quartos, confianca: 0.8, messageId });
  const valor = /(\d{2,4})\s*mil/i.exec(tudo)?.[1];
  if (valor)
    dados.push({
      campo: 'valor_maximo',
      valor: `cerca de R$ ${valor} mil`,
      confianca: 0.7,
      messageId,
    });
  if (/alug/i.test(tudo))
    dados.push({ campo: 'finalidade', valor: 'aluguel', confianca: 0.7, messageId });
  else if (/compr/i.test(tudo))
    dados.push({ campo: 'finalidade', valor: 'compra', confianca: 0.7, messageId });
  if (financiamento)
    dados.push({ campo: 'forma_pagamento', valor: 'financiamento', confianca: 0.7, messageId });
  if (decideJunto)
    dados.push({ campo: 'decide_com', valor: quemDecide.toLowerCase(), confianca: 0.8, messageId });

  const doImovel = [tipo, bairro ? `em ${bairro}` : null].filter(Boolean).join(' ');
  const caso = proprietario
    ? {
        intencao: 'QUER_VENDER_OU_ALUGAR_O_DELE',
        score: 60,
        sinal: 'informou_tipo_e_tamanho',
        polaridade: 'positivo',
        acao: `Marcar a avaliação${doImovel ? ` (${doImovel})` : ' do imóvel'} e pedir fotos e a documentação básica`,
        alertas: [],
        objecoes: [],
      }
    : disponivel && !visita
      ? {
          intencao: 'PEDIU_INFORMACAO',
          score: 58,
          sinal: 'informou_tipo_e_tamanho',
          polaridade: 'positivo',
          acao: `Confirmar que ${doImovel ? `o ${doImovel}` : 'o imóvel'} está disponível e oferecer uma visita`,
          alertas: [],
          objecoes: [],
        }
      : visita
        ? {
            intencao: 'PEDIU_VISITA',
            score: 72,
            sinal: 'pediu_visita',
            polaridade: 'positivo',
            acao: `Combinar dia e hora da visita${doImovel ? ` (${doImovel})` : ''}${decideJunto ? `, com ${quemDecide.toLowerCase()} junto,` : ''} e marcar na agenda`,
            alertas: ['pediu_visita'],
            objecoes: decideJunto ? ['decide_com_outra_pessoa'] : [],
          }
        : caro
          ? {
              intencao: 'VOU_PENSAR',
              score: 28,
              sinal: 'objecao_preco',
              polaridade: 'negativo',
              acao: 'Perguntar a faixa de valor que cabe e oferecer duas opções parecidas',
              alertas: ['risco_perda'],
              objecoes: ['preco'],
            }
          : financiamento
            ? {
                intencao: 'PERGUNTOU_FINANCIAMENTO',
                score: 62,
                sinal: 'perguntou_financiamento',
                polaridade: 'positivo',
                acao: 'Explicar como funciona o financiamento e perguntar a entrada que ele tem',
                alertas: [],
                objecoes: [],
              }
            : preco
              ? {
                  intencao: 'PERGUNTOU_PRECO',
                  score: 55,
                  sinal: 'perguntou_preco',
                  polaridade: 'positivo',
                  acao: `Mandar o valor e as condições${doImovel ? ` (${doImovel})` : ' do imóvel que ele perguntou'}`,
                  alertas: [],
                  objecoes: [],
                }
              : {
                  intencao: texto.includes('?') ? 'PEDIU_INFORMACAO' : 'AMBIGUO',
                  score: texto.includes('?') ? 45 : 20,
                  sinal: null,
                  polaridade: 'positivo',
                  acao: 'Perguntar o que ele procura: tipo de imóvel, bairro e faixa de valor',
                  alertas: [],
                  objecoes: [],
                };

  return {
    resumo: limitar(
      `Simulação: ${texto === '' ? 'conversa sem mensagem do cliente.' : texto}`,
      400,
    ),
    intencao: caso.intencao,
    scoreIntencao: caso.score,
    motivo: limitar(`Leitura simulada pela última mensagem do cliente.`, 200),
    sentimento: caro ? 'negativo' : 'neutro',
    sinais:
      caso.sinal === null
        ? []
        : [
            {
              tipo: caso.sinal,
              polaridade: caso.polaridade,
              forca: 'forte',
              messageId,
              trecho: limitar(texto, 120),
            },
          ],
    objecoes: caso.objecoes,
    etapaSugerida: null,
    compromissosNovos: [],
    compromissosCumpridos: [],
    proximaAcao: { descricao: limitar(caso.acao, 200), prazo: null },
    dadosExtraidos: dados,
    alertas: caso.alertas,
    confianca: 0.75,
    dadosInsuficientes: dados.length === 0 && caso.sinal === null,
  };
}

/**
 * O Pulso do dublê: lê os leads da própria mensagem montada e escreve um texto
 * coerente com os números que recebeu. Não é inteligência — é fixture que responde
 * ao que entrou, para o teste exercitar o corte de prioridade que cita lead
 * inexistente e a gravação com dado que muda.
 */
function pulsar(mensagem: string): Record<string, unknown> {
  const leads = [...mensagem.matchAll(/^- (lead-[a-z0-9]+)/gm)].map((m) => m[1] as string);
  const recebidas = campo(mensagem, '- mensagens recebidas') ?? '0';
  const vencidos = Number(campo(mensagem, '- compromissos vencidos') ?? '0');
  const primeiro = leads[0];

  return {
    titulo: vencidos > 0 ? 'Há promessa vencida esperando' : 'Dia sem nada vencido',
    texto: `O dia teve ${recebidas} mensagens recebidas e ${leads.length} conversas na mesa.`,
    prioridades: primeiro
      ? [
          {
            leadId: primeiro,
            porque: 'É a primeira da ordem que o banco entregou.',
            acao: 'Responder hoje.',
            urgencia: 'hoje',
          },
        ]
      : [],
    riscos: vencidos > 0 ? ['Promessa vencida sem resposta.'] : [],
    diaSemMovimento: leads.length === 0,
  };
}

/**
 * A IA que atende no dublê (Imova, 06/11/2026; v3 em 11/11/2026): lê a última mensagem
 * do cliente e decide como o prompt manda — pediu corretor ou ligação, passa; no treino,
 * "anota" vira anotação; quer visitar um imóvel com código, manda o link da visita, e sem
 * código pergunta qual; o proprietário que quer anunciar ganha o link da reunião; o resto,
 * responde. O texto começa com "Simulação:" para ninguém confundir com a IA de verdade.
 */
function atenderNoDuble(mensagem: string): Record<string, unknown> {
  const treino = /conversa do treino: SIM/.test(mensagem);
  const linhas = mensagem.split('\n').filter((l) => / — cliente: /.test(l));
  const ultima = (linhas[linhas.length - 1] ?? '').replace(/^.* — cliente: /, '');
  const minuscula = ultima.toLowerCase();
  const conversa = mensagem.slice(mensagem.indexOf('CONVERSA'));
  const codigo = /\b([A-Z]{2,5}-?\d{2,6}(?:_[A-Z]+)?)\b/.exec(ultima)?.[1] ?? /\b([A-Z]{2,5}-?\d{2,6}(?:_[A-Z]+)?)\b/.exec(conversa)?.[1] ?? null;
  const base = { agenda: null, anotacoes: [] as string[], fotosEnsinadas: [] as unknown[], confianca: 0.8 };

  if (/corretor|ligar|liga[çc][ãa]o|atendente/.test(minuscula)) {
    return {
      ...base,
      acao: 'passar_para_corretor',
      mensagem: 'Simulação: já vou te passar para um dos nossos corretores, que continua com você por aqui.',
      motivo: 'Simulação: pediu corretor ou ligação.',
    };
  }
  if (treino && /anota|instru[çc][ãa]o|a partir de agora|quando perguntarem/.test(minuscula)) {
    const regra = limitar(ultima.replace(/^(ia,?\s*)?(anota(\s+a[ií])?:?\s*)/i, ''), 400);
    return {
      ...base,
      acao: 'responder',
      mensagem: limitar(`Simulação: anotado — ${regra}`, 600),
      motivo: 'Simulação: instrução do treino.',
      anotacoes: regra.length >= 3 ? [regra] : [],
    };
  }
  if (/(anunciar|vender|alugar|avaliar).*\b(meu|minha|nosso|nossa)\b|\b(tenho|meu|minha)\b.*(anunciar|vender|avaliar)/.test(minuscula)) {
    return {
      ...base,
      acao: 'enviar_link_da_agenda',
      mensagem: 'Simulação: vou te mandar o link da agenda para você escolher um horário para conversar com um corretor.',
      agenda: { tipo: 'reuniao', imovelCodigo: null },
      motivo: 'Simulação: proprietário quer anunciar; link da reunião.',
    };
  }
  if (/visit|marcar|agendar|quero ver/.test(minuscula)) {
    if (codigo === null) {
      return {
        ...base,
        acao: 'responder',
        mensagem: 'Simulação: qual imóvel você quer visitar? Pode me dizer o bairro ou onde viu o anúncio.',
        motivo: 'Simulação: quer visitar sem dizer o imóvel.',
      };
    }
    return {
      ...base,
      acao: 'enviar_link_da_agenda',
      mensagem: 'Simulação: vou te mandar o link da agenda para você escolher o dia e o horário da visita.',
      agenda: { tipo: 'visita', imovelCodigo: codigo },
      motivo: `Simulação: quer visitar o ${codigo}; link da visita.`,
    };
  }
  if (/^(ok|obrigad[oa]|valeu|👍)[.!]*$/.test(minuscula.trim())) {
    return { ...base, acao: 'nao_responder', mensagem: '', motivo: 'Simulação: só agradeceu.' };
  }
  return {
    ...base,
    acao: 'responder',
    mensagem: limitar(`Simulação: recebi "${ultima}". Posso te mostrar os imóveis que combinam com isso?`, 600),
    motivo: 'Simulação: respondeu a pergunta do cliente.',
  };
}

/**
 * A IA juíza no dublê (Imova, 06/11/2026): lê quem falou o quê na conversa montada e
 * devolve notas coerentes com isso — pergunta do cliente dá nota de dúvida, a reação
 * depois da última resposta da IA dá a de satisfação, "visita" sobe o interesse. O
 * porquê começa com "Simulação:" e repete a última fala do cliente, para o teste ver
 * o marcador ([[NOME_1]]) atravessar o modelo e voltar com o nome.
 */
function julgarNoDuble(mensagem: string): Record<string, unknown> {
  const falas = mensagem
    .split('\n')
    .map((linha) => /^\[[^\]]+\] .* — (cliente|IA|equipe|automática): (.*)$/.exec(linha))
    .filter((achado): achado is RegExpExecArray => achado !== null)
    .map((achado) => ({ quem: achado[1] ?? '', texto: achado[2] ?? '' }));
  const ultimaDaIa = falas.map((f) => f.quem).lastIndexOf('IA');
  const doCliente = falas.filter((f) => f.quem === 'cliente');
  if (ultimaDaIa === -1 || doCliente.length === 0) {
    return {
      duvida: null,
      informacao: null,
      satisfacao: null,
      interesse: 'igual',
      porque: 'Simulação: não há conversa entre o cliente e a IA para julgar.',
      melhorar: null,
      dadosInsuficientes: true,
      lacuna: 'nenhuma',
    };
  }
  const reacao = falas
    .slice(ultimaDaIa + 1)
    .filter((f) => f.quem === 'cliente')
    .map((f) => f.texto)
    .join(' ');
  const satisfacao =
    reacao === ''
      ? null
      : /n[ãa]o entendi|j[áa] perguntei|^mas |reclam|absurdo/i.test(reacao)
        ? 2
        : /obrigad|[óo]timo|perfeito|combinado|pode ser/i.test(reacao)
          ? 5
          : 4;
  const perguntou = doCliente.some((f) => f.texto.includes('?'));
  return {
    duvida: perguntou ? (satisfacao === 2 ? 2 : 4) : null,
    informacao: 4,
    satisfacao,
    interesse: /visita|pode ser|combinado/i.test(reacao) ? 'subiu' : satisfacao === 2 ? 'caiu' : 'igual',
    porque: limitar(`Simulação: o cliente disse "${doCliente[doCliente.length - 1]?.texto ?? ''}".`, 400),
    melhorar: satisfacao !== null && satisfacao <= 2 ? 'Simulação: responder direto o que o cliente perguntou.' : null,
    dadosInsuficientes: false,
    // A v2 (09/11/2026): onde a IA falhou. A pergunta do condomínio é a lacuna que o
    // dublê sabe ver; o resto é "outra" quando o cliente reagiu mal.
    lacuna:
      satisfacao === null || satisfacao > 2
        ? 'nenhuma'
        : /condom[íi]nio|iptu/i.test(doCliente.map((f) => f.texto).join(' '))
          ? 'condominio_iptu'
          : 'outra',
  };
}

/** As linhas de uma seção da mensagem montada, até a próxima linha em branco. */
function linhasDaSecao(mensagem: string, cabecalho: string): string[] {
  const inicio = mensagem.indexOf(cabecalho);
  if (inicio === -1) return [];
  const resto = mensagem.slice(inicio + cabecalho.length).replace(/^\n/, '');
  const fim = resto.indexOf('\n\n');
  return (fim === -1 ? resto : resto.slice(0, fim)).split('\n').filter((l) => l.startsWith('- '));
}

const TEMAS_DO_DUBLE: readonly (readonly [RegExp, string])[] = [
  [/condom[íi]nio/i, 'condomínio'],
  [/iptu/i, 'IPTU'],
  [/vaga|garagem/i, 'vaga de garagem'],
  [/financ/i, 'financiamento'],
  [/fgts/i, 'aceita FGTS'],
  [/\bpet\b|cachorro|gato/i, 'aceita pet'],
  [/foto|v[íi]deo/i, 'fotos'],
];

/**
 * O conselheiro do cliente no dublê (Imova, 09/11/2026): lê os imóveis que o CRM ligou à
 * pessoa e os códigos que o cliente escreveu, e devolve um conselho coerente com isso —
 * "visita" ou "proposta" é muito interessado, o resto é interessado; o perfil sai por
 * padrão de texto. A situação e o que falar começam com "Simulação:" e levam o marcador
 * do nome quando há um, para o teste ver o worker tirar o nome da situação e deixar só o
 * primeiro no falar. Compromisso VENCIDO vira o começo do falar, como o prompt manda.
 */
function aconselharClienteNoDuble(mensagem: string): Record<string, unknown> {
  const carteira = linhasDaSecao(mensagem, 'CARTEIRA DA IMOVA (a única fonte de fatos sobre os imóveis):')
    .map((l) => /^- ([^:]+):/.exec(l)?.[1] ?? '')
    .filter((c) => c !== '');
  const ligados = linhasDaSecao(mensagem, 'IMÓVEIS QUE O CRM LIGOU A ESTA PESSOA:')
    .map((l) => /^- ([^:]+):/.exec(l)?.[1] ?? '')
    .filter((c) => carteira.includes(c));
  const doCliente = mensagem
    .split('\n')
    .map((l) => /^em .* — cliente: (.*)$/.exec(l)?.[1])
    .filter((t): t is string => t !== undefined);
  const tudo = doCliente.join(' ');
  const citados = carteira.filter((c) => tudo.includes(c));
  const codigos = [...new Set([...ligados, ...citados])].slice(0, 3);
  const quente = /visit|conhecer|proposta|faz por|fecho/i.test(tudo);
  const perguntas = TEMAS_DO_DUBLE.filter(([padrao]) => padrao.test(tudo)).map(([, tema]) => tema);
  const nome = /\[\[NOME_\d+\]\]/.exec(mensagem.slice(mensagem.indexOf('CONVERSA')))?.[0] ?? null;
  const valor = /(\d{2,4})\s*mil/i.exec(tudo)?.[1];
  const quartos = /(\d)\s*quartos?/i.exec(tudo)?.[1];
  const perfil = {
    finalidade: /alug/i.test(tudo) ? 'locacao' : /compr|financ/i.test(tudo) ? 'compra' : null,
    tipos: (['apartamento', 'casa', 'terreno'] as const).filter((t) => tudo.toLowerCase().includes(t)),
    bairros: BAIRROS_DE_NATAL.filter((b) => tudo.toLowerCase().includes(b.toLowerCase())).slice(0, 5),
    quartos_min: quartos === undefined ? null : Number(quartos),
    valor_max: valor === undefined ? null : Number(valor) * 1000,
    pagamento: /fgts/i.test(tudo) ? 'fgts' : /financ/i.test(tudo) ? 'financiamento' : /[àa] vista/i.test(tudo) ? 'a_vista' : null,
  };
  const vencido = /— VENCIDO$/m.test(mensagem);
  const vazio = codigos.length === 0 && perguntas.length === 0 && perfil.finalidade === null;
  return {
    imoveis: codigos.map((codigo) => ({
      codigo,
      nivel: quente ? 'muito' : 'interessado',
      perguntas: perguntas.slice(0, 5),
    })),
    perfil,
    situacao: limitar(
      `Simulação: ${nome ?? 'o cliente'} disse "${doCliente[doCliente.length - 1] ?? ''}".`,
      140,
    ),
    falar: limitar(
      `${vencido ? 'Simulação: cumprir o compromisso vencido e ' : 'Simulação: '}responder ${nome ?? 'o cliente'} sobre ${codigos[0] ?? 'o que procura'}.`,
      180,
    ),
    dadosInsuficientes: vazio,
  };
}

/**
 * O canal de chegada no dublê (Imova, 06/11/2026). Não vê a imagem — nenhum dublê vê —:
 * se veio foto, trata a primeira como placa da Imova; se o cliente falou de Instagram,
 * Redes sociais; senão, Não identificado. O motivo começa com "Simulação:" para ninguém
 * confundir com a leitura de verdade na tela local.
 */
function lerCanalNoDuble(mensagem: string, pedido: PedidoAoModelo): Record<string, unknown> {
  const imagens = pedido.imagens?.length ?? 0;
  const linhas = mensagem.split('\n');
  const daFoto = linhas
    .map((l) => /^\[(m\d+)\] .* — cliente mandou a foto (f\d)/.exec(l))
    .find((achado) => achado !== null);
  if (imagens > 0 && daFoto) {
    const [, messageId, fotoId] = daFoto;
    return {
      canal: 'placa',
      subcanal: 'foto_da_placa',
      confianca: 0.9,
      evidencias: [
        { messageId, tipo: 'foto', trecho: 'Simulação: o dublê trata a primeira foto como placa da Imova' },
      ],
      foto: {
        fotoId,
        peca: 'placa',
        marca: 'imova',
        descricao: 'Simulação: o dublê não vê a imagem',
        codigoDoImovel: null,
      },
      motivo: `Simulação: ${imagens} foto(s) recebida(s); a primeira foi tratada como placa.`,
    };
  }
  const doCliente = linhas
    .map((l) => /^\[(m\d+)\] .* — cliente: (.*)$/.exec(l))
    .filter((achado): achado is RegExpExecArray => achado !== null);
  const insta = doCliente.find(([, , texto]) => /\binsta(gram)?\b|\[\[INSTAGRAM_\d+\]\]/i.test(texto ?? ''));
  if (insta) {
    return {
      canal: 'redes_sociais',
      subcanal: 'instagram',
      confianca: 0.75,
      evidencias: [{ messageId: insta[1], tipo: 'texto', trecho: limitar(insta[2] ?? '', 160) }],
      foto: null,
      motivo: 'Simulação: o cliente falou do Instagram.',
    };
  }
  return {
    canal: 'nao_identificado',
    subcanal: 'desconhecido',
    confianca: 0.1,
    evidencias: [],
    foto: null,
    motivo: 'Simulação: nada no começo da conversa diz como a pessoa chegou.',
  };
}

/**
 * O conselheiro do imóvel no dublê (Imova, 09/11/2026): a pergunta e a objeção que mais
 * se repetem e os muito interessados viram as sugestões, cada uma com o número que veio.
 * Sem pergunta nem objeção, não há o que sustentar.
 */
function aconselharImovelNoDuble(mensagem: string): Record<string, unknown> {
  const contagens = (cabecalho: string) =>
    linhasDaSecao(mensagem, cabecalho).map((l) => {
      const achado = /^- (.+): (\d+) leads?$/.exec(l);
      return { tema: achado?.[1] ?? '', leads: Number(achado?.[2] ?? 0) };
    });
  const perguntas = contagens('PERGUNTAS QUE MAIS SE REPETEM:');
  const objecoes = contagens('OBJEÇÕES QUE MAIS SE REPETEM:');
  const muito = Number(campo(mensagem, '- muito interessados') ?? '0');
  if (perguntas.length === 0 && objecoes.length === 0) {
    return { sugestoes: [], dadosInsuficientes: true };
  }
  const sugestoes: Record<string, unknown>[] = [];
  const primeira = perguntas[0];
  if (primeira) {
    sugestoes.push({
      tipo: 'fazer',
      acao: limitar(`Simulação: ponha "${primeira.tema}" no anúncio`, 90),
      porque: `É a pergunta nº 1 (${primeira.leads} leads).`,
    });
  }
  const objecao = objecoes[0];
  if (objecao) {
    sugestoes.push({
      tipo: 'fazer',
      acao: objecao.tema === 'preco' ? 'Simulação: converse com o proprietário sobre o preço' : `Simulação: responda a objeção "${objecao.tema}"`,
      porque: `É a objeção nº 1 (${objecao.leads} leads).`,
    });
  }
  if (muito > 0) {
    sugestoes.push({
      tipo: 'falar',
      acao: `Simulação: chame os ${muito} muito interessados para visitar`,
      porque: `São ${muito} muito interessados.`,
    });
  }
  return { sugestoes: sugestoes.slice(0, 3), dadosInsuficientes: false };
}

/**
 * Tokens de uma imagem no dublê. A conta de verdade é por pixel (largura × altura / 750);
 * o dublê não decodifica a imagem e usa a de uma foto típica do WhatsApp, só para os
 * contadores de `ai_runs` mexerem quando vem foto.
 */
export const TOKENS_POR_IMAGEM_NO_DUBLE = 1600;

const RESPOSTAS: Readonly<
  Record<FluxoDoDuble, (mensagem: string, pedido: PedidoAoModelo) => Record<string, unknown>>
> = {
  canal: lerCanalNoDuble,
  transcricao: transcrever,
  resumo: resumir,
  followup: redigir,
  classificacao: classificar,
  ficha: ficharConversa,
  leitura: lerClienteNoDuble,
  pulso: pulsar,
  atendente: atenderNoDuble,
  juiza: julgarNoDuble,
  conselheiro_lead: aconselharClienteNoDuble,
  conselheiro_imovel: aconselharImovelNoDuble,
};

// ---------------------------------------------------------------------------
// O dublê
// ---------------------------------------------------------------------------

export interface OpcoesDoDuble {
  /**
   * Substitui a saída de um fluxo. É o que deixa um teste provar o caminho
   * ruim — rascunho que promete o que não pode, JSON fora do schema — sem
   * inventar um segundo dublê para cada caso.
   */
  readonly forcar?: Partial<Record<FluxoDoDuble, unknown>>;
  /** Levanta este erro em vez de responder. Para exercitar retry e dead-letter. */
  readonly falharCom?: () => Error;
}

/**
 * O dublê como `ClienteDoModelo`: é assim que ele entra pelo mesmo lugar que o
 * cliente real, sem o worker saber a diferença.
 */
export function clienteDuble(opcoes: OpcoesDoDuble = {}): {
  conversar(pedido: PedidoAoModelo): Promise<RespostaDoModelo>;
  /** Quantas chamadas passaram por aqui, por fluxo. */
  readonly chamadas: FluxoDoDuble[];
  /** Quantas imagens vieram em cada chamada, na mesma ordem de `chamadas`. */
  readonly imagens: number[];
} {
  const sistemasVistos = new Set<string>();
  const chamadas: FluxoDoDuble[] = [];
  const imagens: number[] = [];

  return {
    chamadas,
    imagens,
    async conversar(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
      if (opcoes.falharCom !== undefined) throw opcoes.falharCom();
      const fluxo = fluxoDoEsquema(pedido.esquema);
      chamadas.push(fluxo);
      const quantasImagens = pedido.imagens?.length ?? 0;
      imagens.push(quantasImagens);
      const forcada = opcoes.forcar?.[fluxo];
      const json = forcada === undefined ? RESPOSTAS[fluxo](pedido.mensagem, pedido) : forcada;

      const tokensDoSistema = estimarTokens(pedido.sistema);
      const jaVisto = sistemasVistos.has(pedido.sistema);
      sistemasVistos.add(pedido.sistema);
      const uso: UsoDoModelo = {
        entrada:
          estimarTokens(pedido.mensagem) +
          quantasImagens * TOKENS_POR_IMAGEM_NO_DUBLE +
          estimarTokens((pedido.imagens ?? []).map((i) => i.rotulo).join('\n')),
        saida: estimarTokens(JSON.stringify(json)),
        escritaDeCache: jaVisto ? 0 : tokensDoSistema,
        leituraDeCache: jaVisto ? tokensDoSistema : 0,
      };
      return await Promise.resolve({
        json,
        uso,
        modelo: pedido.modelo,
        paradaPor: 'end_turn',
      });
    },
  };
}
