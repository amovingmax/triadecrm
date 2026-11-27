/**
 * As regras do caderno por imóvel (FICHAS 1 a 8 e o núcleo §3): o que não está
 * em nenhum dado estruturado do CRM. Cópia LITERAL de `ARG_CADERNO` e
 * `ARG_LUGAR` de `js/55-argumentos.js` (protótipo, 19/11/2026) — o que o dono já
 * colou na IA de produção (notas MERCADO de 18/11). Mudar uma linha daqui muda o
 * que a IA pode dizer: pede o "pode" do dono, como no protótipo.
 *
 * unidade: a linha da carteira que o motor mede (lotes iguais: o 1º lote).
 * motor: travas que mudam a conta. fatos: os fatos da ficha (D1), nunca
 * comparados. gatilhos: os rótulos de cada vantagem de região neste imóvel.
 * bloqueadas: as que o caderno trava por regra. pedidos e fato_valor: só a tela
 * do protótipo usa (ficam aqui para a cópia continuar literal).
 */

export interface FatoDoCaderno {
  id: string;
  campo?: string;
  familia: string;
  texto: string;
  texto_curto?: string;
  numeros?: string[];
  gatilhos: string[];
  retomada?: boolean;
  prova: { fonte: string; data_dado: string; regra: string };
  prova_cliente: string;
  aviso_obrigatorio?: string;
  vence_com?: string;
}

export interface TravaDeObjecao {
  regra: string;
  o_que_fazer: string;
}

export interface EntradaDoCaderno {
  unidade: string | null;
  nome_nota: string;
  titulo_para_ia: string;
  segmento: string | null;
  ficha?: string | null;
  ponto_apresentacao: string | null;
  ponto_usa?: { id: string };
  comercial?: boolean;
  motor?: {
    censo_ok?: boolean;
    preco_bloqueado?: string;
    ficha5a?: boolean;
    contar_esquina?: boolean;
    p3_bloqueado?: string;
  };
  gatilhos?: Record<string, string[]>;
  aviso_vantagem?: Record<string, string>;
  fora?: Record<string, [string, string]>;
  fatos?: FatoDoCaderno[];
  avisos_imovel?: string[];
  nao_diga: string[];
  travas_objecao?: Record<string, TravaDeObjecao>;
  bloqueadas?: [string, string][];
  avisos_equipe?: string[];
  pedidos?: Array<Record<string, unknown>>;
  fato_valor?: string | null;
}

export const ARG_CADERNO: Record<string, EntradaDoCaderno> = {
  TE0006: {
    unidade: 'TE0006',
    nome_nota: 'TERRENO DE 900 M² EM NATAL',
    titulo_para_ia: 'Terreno de 900 m² em Natal',
    segmento: 'terreno_residencial_urbano',
    ficha: 'FICHA 1',
    ponto_apresentacao: 'o terreno de 900 m² já com escritura pública',
    ponto_usa: { id: 'D1.escritura' },
    motor: { censo_ok: false },
    nao_diga: [
      'comparação de preço ou de m²',
      'bairro, rua, esquina ou o que fica perto (FICHA 1)',
      'dados do bairro',
      'procura pelo terreno',
      'confirmar ou contestar o m² que o cliente citar',
    ],
    travas_objecao: {
      mais_barato: {
        regra: 'possível o mesmo imóvel',
        o_que_fazer:
          'Pode ser o mesmo terreno anunciado por terceiros: diga que vai verificar e passe, sem argumento.',
      },
    },
    fatos: [
      {
        id: 'D1.escritura',
        campo: 'escritura_publica',
        familia: 'documentacao',
        texto: 'Ele já tem escritura pública.',
        gatilhos: ['documentacao', 'interesse'],
        retomada: true,
        prova: {
          fonte: 'Ficha do anúncio (equipe, 09/11 e 11/11/2026); FICHA 1 (a)',
          data_dado: '2026-11-11',
          regra: 'fato confirmado pela equipe; nunca comparado',
        },
        prova_cliente: 'Está na ficha do imóvel, confirmado pela equipe.',
        aviso_obrigatorio:
          'Se ele perguntar da matrícula ou de vender parte, passe (há uma dúvida aberta sobre a matrícula na ficha).',
        vence_com: 'ficha',
      },
    ],
    bloqueadas: [
      [
        'R1 esquina',
        'FICHA 1: rua e esquina vieram dos clientes; a contagem de esquina só vale com a esquina confirmada pela equipe (e, pelo título, não passa na taxa de base).',
      ],
      [
        'D1 escritura em "caro" e "por que este"',
        'Escritura não é medida contra os parecidos (muitos anúncios dizem "escriturado"); depois de um preço acima dos parecidos, soa como desvio.',
      ],
    ],
    avisos_equipe: [
      'Confirmar bairro, rua e esquina (destrava a renda do bairro).',
      'Conferir se o anúncio de R$ 790 mil de outra imobiliária é este terreno.',
      'Matrícula: um cliente diz que são 2 matrículas.',
    ],
    pedidos: [
      {
        campo: 'bairro',
        libera_censo: true,
        libera_hip: ['R1.esquina'],
        protege: 'o bairro, a rua ou a esquina',
      },
      { campo: 'possivel_mesmo', protege: 'que o terreno de R$ 790 mil é outro' },
      {
        campo: 'matricula',
        quem: 'proprietário',
        protege: 'que dá para comprar só uma parte do terreno',
      },
    ],
    fato_valor: null,
  } /* "caro": o caderno trava a escritura (soa como desvio depois de um preço acima) e o resto da ficha não está confirmado */,
  CA0001: {
    unidade: 'CA0001',
    nome_nota: 'CASA E PONTO COMERCIAL NA AV. ESTRELA DO MAR, PONTA NEGRA',
    titulo_para_ia: 'Casa e ponto comercial na Av. Estrela do Mar, Ponta Negra',
    segmento: 'comercial_aluguel_repasse',
    ficha: 'FICHA 3',
    ponto_apresentacao: 'o ponto comercial na Av. Estrela do Mar, em Ponta Negra',
    comercial: true,
    gatilhos: {
      'C2.populacao': ['regiao', 'uso_comercial', 'investimento', 'comparacao_bairro'],
      'C2.construcao': ['regiao', 'uso_comercial', 'comparacao_bairro'],
      'C2.renda': ['uso_comercial', 'comparacao_bairro'],
    },
    nao_diga: [
      'preço ou m² comparado',
      'procura',
      'quartos, área construída e documentação (FICHA 3: passe)',
      'dado do bairro como motivo para esta e não outra casa de Ponta Negra',
    ],
    avisos_equipe: [
      'Escrever na ficha: área construída e do terreno, quartos, vagas, documentação.',
      'Responder os clientes D, G e C (sem resposta desde 03/11).',
    ],
    pedidos: [
      { campo: 'area_ambigua', protege: 'a área, os quartos, as vagas ou a documentação' },
      { campo: 'responder' },
    ],
  },
  PT0001: {
    unidade: 'PT0001',
    nome_nota: 'REPASSE DA LOJA DE PLANTAS NA AV. PRAIA DE PIRANGI, PONTA NEGRA',
    titulo_para_ia: 'Repasse da loja de plantas na Av. Praia de Pirangi, Ponta Negra',
    segmento: 'comercial_aluguel_repasse',
    ficha: 'FICHA 2',
    ponto_apresentacao:
      'o repasse da loja de plantas em funcionamento, com a casa anexa, deixando claro que não é venda do imóvel (FICHA 2)',
    comercial: true,
    gatilhos: {
      'C2.populacao': ['regiao', 'uso_comercial', 'comparacao_bairro'],
      'C2.construcao': ['regiao', 'uso_comercial', 'comparacao_bairro'],
      'C2.renda': ['uso_comercial', 'comparacao_bairro'],
    },
    nao_diga: [
      'aluguel ou repasse comparados',
      'faturamento, retorno ou rentabilidade da loja (passe)',
      'procura por lojas ou pontos',
      'dado do bairro como motivo para este e não outro ponto de Ponta Negra',
    ],
    travas_objecao: {
      investimento: {
        regra: 'FICHA 2',
        o_que_fazer:
          'É repasse de negócio: não fale de retorno, rentabilidade nem valorização; diga que vai verificar e passe.',
      },
    },
    bloqueadas: [
      [
        'Investimento',
        'É repasse de negócio: retorno e rentabilidade são proibidos; a pergunta passa para a equipe.',
      ],
      [
        'G2 procura maior que a oferta',
        'Dos pedidos de loja ou ponto em Ponta Negra, parte é de quem recusou este repasse e o resto queria alugar loja: enganoso no contexto (T10).',
      ],
    ],
    avisos_equipe: [
      'Corrigir o anúncio: aparece como casa à venda por R$ 120 mil.',
      'Escrever prazo e garantia do aluguel.',
    ],
    pedidos: [
      { campo: 'finalidade', protege: 'que é uma casa à venda por R$ 120 mil' },
      { campo: 'aluguel', quem: 'proprietário', protege: 'o prazo ou a garantia do aluguel' },
    ],
    fato_valor: 'a loja de plantas já em funcionamento, com a casa anexa',
  },
  TE0001: {
    unidade: 'TE0001',
    nome_nota: 'TERRENO DE 3.000 M² EM CAPIM MACIO',
    titulo_para_ia: 'Terreno de 3.000 m² em Capim Macio',
    segmento: 'terreno_incorporacao',
    ficha: null,
    ponto_apresentacao: 'os 3.000 m² em Capim Macio, em 3 lotes de 1.000 m² vendidos juntos',
    gatilhos: {
      'C2.construcao': ['regiao', 'quer_construir', 'investimento'],
      'C2.renda': ['comparacao_bairro'],
    },
    aviso_vantagem: {
      'T1.area': 'Se ele quiser só um dos lotes de 1.000 m², este item não vale: passe.',
    },
    nao_diga: [
      'comparação de preço ou de m²',
      'preço de cada parte ou a opção de 5.000 m² (passe)',
      'quantos andares ou o que a prefeitura permite construir (passe)',
      'valorização garantida',
      'comparação de tamanho com outros terrenos',
      'a variação do índice do bairro',
      'a posição exata do bairro em alvarás',
      'que é uma matrícula só (passe)',
    ],
    avisos_equipe: [
      'Escrever o preço de cada parte de 1.000 m².',
      "Tirar 'valorização garantida' da descrição publicada.",
      'Conferir zoneamento antes de falar em prédio; matrícula de cada parte antes de chamar de lotes.',
    ],
    pedidos: [
      { campo: 'preco_lote', quem: 'proprietário', protege: 'o preço de cada parte de 1.000 m²' },
      { campo: 'descricao', protege: 'que a valorização é garantida' },
      {
        campo: 'zoneamento',
        protege: 'quantos andares dá para construir ou que cada parte tem matrícula própria',
      },
    ],
  },
  TE0005: {
    unidade: 'TE0005-L1',
    nome_nota: 'TERRENOS EM PIPA, VIZINHOS AO PARQUE MATA DA PIPA',
    titulo_para_ia: 'Terrenos em Pipa, vizinhos ao Parque Mata da Pipa',
    segmento: 'lote_praia_segunda_casa',
    ficha: 'FICHA 4',
    ponto_apresentacao:
      'os terrenos vizinhos ao Parque Mata da Pipa' /* revisão r1 (18/11): sem "cerca de 2.550 m²", que puxava o limite de 10% já na abertura */,
    ponto_usa: {
      id: 'D1.parque',
    } /* o parque já foi dito; a área (290 ha) e o decreto só voltam a quem pergunta do entorno ou da região */,
    motor: {
      preco_bloqueado:
        'FICHA 4: lote só ocupa 10%; sem conta de m² (os parecidos com ocupação acima de 19% anulam a vantagem)',
    },
    fatos: [
      {
        id: 'D1.parque',
        familia: 'entorno',
        texto:
          'O vizinho é o Parque Estadual Mata da Pipa, área protegida de cerca de 290 hectares criada por decreto estadual em 2006.',
        numeros: ['290', '2006'],
        texto_curto:
          'E o vizinho é o Parque Estadual Mata da Pipa, área protegida de cerca de 290 hectares, criada em 2006.',
        gatilhos: [
          'o_que_tem_em_volta',
          'regiao',
          'interesse',
          'antes_convite',
          'quer_casa_de_praia',
          'retomada',
        ],
        retomada: true,
        prova: {
          fonte:
            'Anúncio (vizinho ao Parque Mata da Pipa) e Decreto estadual 19.341/2006 (290,88 ha)',
          data_dado: '2006-01-01',
          regra: 'fato oficial; nunca comparado',
        },
        prova_cliente: 'O parque foi criado pelo Decreto estadual 19.341, de 2006.',
        vence_com: 'fonte_oficial',
      },
    ],
    avisos_imovel: [
      'Se falar em construir ou no tamanho do terreno: a construção pode ocupar até 10% do lote (FICHA 4 a); diga isso na mesma mensagem.',
    ],
    nao_diga: [
      'm², soma dos terrenos ou comparação de preço (FICHA 4)',
      'comparação de tamanho com outros terrenos',
      'aluguel por temporada, diária, renda ou pousada (conte o limite e passe)',
      'renda de quem mora lá',
      "'lotes' (diga 'terrenos' até a matrícula de cada um)",
    ],
    avisos_equipe: [
      'Escrever escritura, água, luz e acesso.',
      'Conferir a regra de 10% no Plano Diretor de Tibau do Sul (fonte primária não achada).',
      "Matrícula de cada lote antes de chamar de 'lotes' em material novo.",
    ],
    pedidos: [
      {
        campo: 'documentacao',
        libera_fato: [{ id: 'D1.escritura', forca: 'B' }],
        protege: 'escritura, água, luz ou acesso',
      },
      { campo: 'ocupacao', protege: 'o limite de 10% de ocupação' },
      {
        campo: 'matricula',
        quem: 'proprietário',
        protege: 'que cada terreno tem matrícula própria',
      },
    ],
  },
  TE0004: {
    unidade: 'TE0004',
    nome_nota: 'TERRENO FRENTE-MAR NA PRAIA DE TABATINGA, NÍSIA FLORESTA',
    titulo_para_ia: 'Terreno frente-mar na Praia de Tabatinga, Nísia Floresta',
    segmento: 'lote_praia_segunda_casa',
    ficha: 'FICHA 5A',
    ponto_apresentacao: 'os 810 m² de frente para o mar',
    motor: { ficha5a: true },
    gatilhos: { 'C1.veraneio': ['quer_casa_de_praia', 'regiao'] },
    travas_objecao: {
      caro: {
        regra: 'FICHA 5A',
        o_que_fazer:
          'Preço em correção: não diga nem explique valor; diga que vai confirmar o valor atualizado e passe.',
      },
      mais_barato: {
        regra: 'FICHA 5A',
        o_que_fazer:
          'Preço em correção: não compare nem explique valor; diga que vai confirmar o valor atualizado e passe.',
      },
    },
    fatos: [
      {
        id: 'D1.escritura',
        campo: 'escritura_publica',
        familia: 'documentacao',
        texto: 'Segundo o anúncio, ele é escriturado.',
        gatilhos: ['documentacao'],
        prova: {
          fonte: 'Anúncio e FICHA 5 b (texto do anúncio)',
          data_dado: '2026-11-16',
          regra:
            'fato do anúncio; enquanto a equipe não conferir a SPU (terreno de marinha), só sob pergunta e com a passagem da conversa',
        },
        prova_cliente: 'Está no anúncio; a equipe confirma os detalhes da documentação.',
        aviso_obrigatorio:
          'Na mesma mensagem, diga que a equipe confirma os detalhes da documentação, e passe.',
        vence_com: 'ficha',
      },
    ],
    nao_diga: [
      'qualquer valor em reais ou explicação do preço enquanto valer a FICHA 5A (passe)',
      'que poucos terrenos são de frente para o mar',
      'm² comparado',
      'temporada ou retorno',
      'que não é terreno de marinha ou que a documentação está toda em dia',
      'erosão (passe)',
      "'vista permanente' ou 'pronto para venda'",
      'escritura ou documentação sem ele perguntar',
    ],
    bloqueadas: [
      [
        'D1 "escriturado, pronto para venda" na primeira resposta e na retomada',
        'Lote de frente para o mar com 68 m de fundo sem a equipe ter conferido a SPU (marinha: foro e laudêmio, trava T7); "pronto para venda" vem do mesmo texto do anúncio que prometia "vista permanente".',
      ],
    ],
    avisos_equipe: [
      'Confirmar a situação na SPU (terreno de marinha) e erosão antes de usar o frente-mar como argumento comparativo.',
      'Corrigir os 3 preços do anúncio e trocar para a FICHA 5B.',
    ],
    pedidos: [
      { campo: 'spu', protege: 'que não é terreno de marinha ou que a documentação está em dia' },
      { campo: 'preco_anuncio', protege: 'um valor que pode estar errado' },
    ],
  },
  CA0003: {
    unidade: 'CA0003',
    nome_nota: 'CASA DE 2 QUARTOS EM EXTREMOZ',
    titulo_para_ia: 'Casa de 2 quartos em Extremoz',
    segmento: 'casa_popular',
    ponto_apresentacao: 'as 3 vagas, numa casa de 2 quartos',
    gatilhos: { 'C2.populacao': ['regiao', 'investimento', 'antes_convite'] },
    nao_diga: [
      'preço do m² ou comparação de preço com outras casas',
      'financiamento, FGTS ou parcela (passe)',
      "'garagem' ou 'coberta' (a ficha diz 3 vagas; falta foto)",
      'comparação do tamanho do terreno',
      "'no centro de Extremoz'",
    ],
    bloqueadas: [
      [
        'R1 vagas em "interesse" e "por que este"',
        'Quem não falou de carros não procura por vagas; há casas maiores com 3 vagas pelo mesmo preço.',
      ],
    ],
    avisos_equipe: [
      'Condomínio e IPTU como 0: confirmar.',
      'Fotos: o anúncio não tem.',
      'Documentação para financiamento conferida até agosto (época forte do FGTS).',
    ],
    pedidos: [
      { campo: 'condominio', protege: 'que não há condomínio nem IPTU' },
      { campo: 'fotos', protege: 'que as vagas são cobertas' },
      { campo: 'financiamento', protege: 'que a casa aceita financiamento ou FGTS' },
    ],
  },
  CA0002: {
    unidade: 'CA0002',
    nome_nota: 'CASA DE 3 QUARTOS NO POTENGI',
    titulo_para_ia: 'Casa de 3 quartos no Potengi',
    segmento: 'casa_popular',
    ficha: 'FICHA 8',
    ponto_apresentacao: 'os 3 quartos, sendo 1 suíte, e os 323 m² de área total',
    motor: { p3_bloqueado: 'sem área construída na ficha: igual com igual impossível' },
    nao_diga: [
      'preço do m² ou comparação de preço com outras casas',
      'renda, população ou construção do bairro',
      "'casa de 323 m²' (FICHA 8)",
      'financiamento, FGTS ou parcela (passe)',
    ],
    avisos_equipe: [
      'Medir a área construída: destrava (ou fecha) a vantagem de preço.',
      'Fotos: o anúncio não tem.',
      'Abrir o link do anúncio de 322 m² por R$ 180 mil: pode ser esta casa anunciada por outra imobiliária.',
    ],
    pedidos: [
      { campo: 'area_construida', libera_bloq: ['P3.valor_total'], protege: 'o tamanho da casa' },
      { campo: 'fotos' },
      { campo: 'possivel_mesmo', protege: 'que o anúncio de R$ 180 mil é de outra casa' },
    ],
  },
  TE0002: {
    unidade: 'TE0002',
    nome_nota: 'TERRENO COMERCIAL DE ESQUINA NA BONOR, PARNAMIRIM',
    titulo_para_ia: 'Terreno comercial de esquina na BONOR, Parnamirim',
    segmento: 'terreno_comercial',
    ficha: 'Parte E, item 7',
    ponto_apresentacao:
      'os 3.500 m² na esquina da Av. Heronides Xavier da Silva com a Av. Serafim Nunes Neto, com frente para as duas',
    ponto_usa: { id: 'D1.esquina' },
    motor: { censo_ok: false, contar_esquina: true },
    fatos: [
      {
        id: 'D1.esquina',
        campo: 'esquina',
        familia: 'fato',
        texto: 'Ele fica na esquina de duas avenidas, com frente para as duas.',
        gatilhos: ['esquina', 'por_que_esse', 'comparacao'],
        retomada: true,
        prova: {
          fonte:
            'Ficha do imóvel (anúncio) e OpenStreetMap: cruzamento da Av. Heronides Xavier da Silva com a Av. Serafim Nunes Neto, conferido em 17/11/2026',
          data_dado: '2026-11-17',
          regra: 'fato da ficha; nunca comparado',
        },
        prova_cliente:
          'Está no anúncio, e o ponto confere no mapa: o cruzamento das duas avenidas.',
        vence_com: 'ficha',
      },
    ],
    nao_diga: [
      'm² comparado',
      'que poucos terrenos são de esquina',
      'comparação de tamanho com outros terrenos',
      'que a esquina ou a avenida aumentam o valor',
      'renda ou população da área',
      'o bairro (a confirmar)',
      'a fábrica vizinha ou quem é o proprietário (passe)',
    ],
    avisos_equipe: [
      'Escrever a largura da frente nas duas avenidas, o uso permitido e o bairro.',
      'Confirmar quem é o proprietário.',
    ],
    pedidos: [
      {
        campo: 'bairro',
        libera_censo: true,
        protege: 'a largura da frente, o uso permitido ou o bairro',
      },
      { campo: 'proprietario', protege: 'quem é o proprietário' },
    ],
  },
  TE0003: {
    unidade: 'TE0003',
    nome_nota: 'TERRENO DE 10.000 M² NA BONOR, PARNAMIRIM',
    titulo_para_ia: 'Terreno de 10.000 m² na BONOR, Parnamirim',
    segmento: 'terreno_comercial',
    ponto_apresentacao:
      'os 10.000 m² na Av. Heronides Xavier da Silva, para uso comercial, industrial ou logístico',
    motor: { censo_ok: false },
    nao_diga: [
      'm² comparado',
      'esquina (não confirmada)',
      'que a avenida aumenta o valor',
      'renda ou população da área',
      "'área da BONOR' para a contagem",
      "'mais área do que se costuma achar'",
    ],
    avisos_equipe: ['Confirmar esquina e frente de avenida.'],
    pedidos: [
      {
        campo: 'esquina',
        quem: 'proprietário',
        libera_hip: ['R1.esquina'],
        protege: 'que o terreno é de esquina ou tem frente para a avenida',
      },
    ],
  },
  AP0001: {
    unidade: 'AP0001',
    nome_nota: 'APARTAMENTO DE 2 QUARTOS EM LAGOA NOVA',
    titulo_para_ia: 'Apartamento de 2 quartos em Lagoa Nova',
    segmento: 'apartamento_entrada',
    ponto_apresentacao: 'os 2 quartos e os 57 m² úteis, com 1 vaga',
    gatilhos: { 'C2.renda': ['comparacao_bairro'] },
    fora: {
      'C2.construcao': [
        'proposta',
        'Passa na regra ("entre os 10", força B), mas ainda não passou pela bancada: fica como proposta para a próxima rodada (núcleo §13.3).',
      ],
    },
    aviso_vantagem: {
      'P3.valor_total': 'Use só depois de dizer o motivo do valor que a equipe escreveu na ficha.',
    },
    travas_objecao: {
      mais_barato: {
        regra: 'possível o mesmo imóvel',
        o_que_fazer:
          'Pode ser o mesmo apartamento anunciado por outro preço: diga que vai verificar e passe.',
      },
    },
    nao_diga: [
      'comparação de preço ou de m² até a equipe conferir este anúncio',
      'condomínio, quartos ou vagas comparados',
      'a variação do índice do bairro',
      "'por que tão barato?': passe",
    ],
    avisos_equipe: [
      'Conferir área, preço, padrão, idade e estado; confirmar se o anúncio de R$ 200 mil de outra imobiliária é este apartamento; escrever na ficha o motivo do valor.',
      'Fotos e descrição: o anúncio não tem fotos.',
    ],
    pedidos: [
      { campo: 'preco_area', libera_conferir: true, protege: 'o motivo do valor' },
      { campo: 'fotos' },
    ],
  },
  SA0012: {
    unidade: 'SA0012',
    nome_nota: 'SALA DE 19 M² NO BRISA MALL, PONTA NEGRA',
    titulo_para_ia: 'Sala de 19 m² no Brisa Mall, Ponta Negra',
    segmento: 'comercial_aluguel_repasse',
    ponto_apresentacao: 'a sala de 19 m² com banheiro no Brisa Mall',
    comercial: true,
    fora: {
      'C2.construcao': [
        'regra',
        'Sala para alugar: o caderno da sala usa só a população e a renda do bairro (núcleo §3.2); construção no bairro não diz nada a quem aluga uma sala.',
      ],
    },
    gatilhos: {
      'C2.populacao': ['regiao', 'uso_comercial', 'comparacao_bairro'],
      'C2.renda': ['uso_comercial', 'comparacao_bairro'],
    },
    nao_diga: [
      'aluguel comparado',
      'custo total com condomínio (o condomínio é à parte: diga quando falar de custo)',
      'dado do bairro como motivo para esta e não outra sala de Ponta Negra',
    ],
    avisos_equipe: ['Escrever o valor do condomínio.'],
    pedidos: [{ campo: 'condominio', protege: 'o custo total da sala' }],
  },
  LO0001: {
    unidade: null,
    nome_nota: 'LOJA DE 38 M² NO BRISA MALL, PONTA NEGRA',
    titulo_para_ia: 'Loja de 38 m² no Brisa Mall',
    segmento: null,
    ficha: 'FICHA 7',
    ponto_apresentacao: null,
    nao_diga: [],
    avisos_equipe: ['Pausar ou excluir o anúncio.'],
    pedidos: [{ campo: 'anuncio' }],
  },
};

/** Nomes de lugar que os dados não trazem prontos (como o caderno diz). */
export const ARG_LUGAR: Record<
  string,
  { municipio?: string; setores?: string; ocasional?: string }
> = {
  'tibau-do-sul-pipa': {
    municipio: 'Tibau do Sul, município de Pipa',
    setores: 'de Pipa',
    ocasional: 'casa de veraneio',
  },
  'nisia-floresta-tabatinga': { setores: 'da praia de Tabatinga', ocasional: 'casa de praia' },
};
