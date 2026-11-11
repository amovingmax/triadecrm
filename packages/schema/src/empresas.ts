/**
 * As empresas que usam o Tríade, e o que muda de uma para a outra.
 *
 * O mesmo código serve a KOMUNE e a Imova Imobiliária, cada uma no SEU projeto
 * Supabase (banco, logins, arquivos e WhatsApp próprios) e no seu endereço. O que é
 * DADO de cada uma (funis, categorias, modelos de mensagem, roteiro de ligação) mora
 * no banco dela, pelo seed da empresa. O que é TEXTO de tela, rótulo ou módulo
 * ligado/desligado mora aqui.
 *
 * Regra de ouro: os valores da KOMUNE são os textos que já estavam escritos no código
 * antes de existir uma segunda empresa — a tela dela não muda nem uma letra. O teste
 * `empresas.test.ts` guarda isso.
 *
 * Quem escolhe a empresa é o ambiente: `NEXT_PUBLIC_EMPRESA` no site (lido em
 * `apps/web/src/lib/empresa.ts`) e `EMPRESA` nos workers. Sem a variável, é a KOMUNE,
 * para o que já está no ar não precisar de nada novo.
 */

export type EmpresaSlug = 'komune' | 'imova';

export type TipoDeParceiro = 'fornecedor' | 'produtor' | 'cerimonialista';

export interface Empresa {
  slug: EmpresaSlug;
  /** Como a empresa é chamada no meio da frase: "da Komune", "na Imova Imobiliária". */
  nome: string;
  /** Como aparece quando o texto fala do número de WhatsApp: "o número da KOMUNE". */
  nomeDoNumero: string;
  /**
   * O nome curto, que abre o título do aviso do navegador: quem está nas duas
   * empresas precisa saber de qual delas é o aviso (30/10/2026).
   */
  nomeNoAviso: string;
  /** Nome do app na aba do navegador e no ícone instalado. */
  tituloDoApp: string;
  /** Linha de baixo do login. */
  descricaoDoLogin: string;
  /** Descrição da página e do app instalado (metadata e manifest). */
  descricaoDoApp: string;
  /** A quem pedir acesso, nas telas de erro e de permissão. */
  admins: { ou: string; e: string; tecnicos: string };
  /** Rótulo de cada tipo de parceiro; null = tipo que a empresa não usa. */
  tipos: Record<TipoDeParceiro, string | null>;
  /**
   * Rótulos de grupo de categoria que a empresa troca. `categories.group` aceita só a
   * lista fechada (alimentos_bebidas, infraestrutura, servicos, locais, recreacao,
   * producao), e o grupo decide o tipo do parceiro: a Imova usa `servicos` para imóvel
   * e `producao` para cliente, e mostra "Imóveis" e "Clientes".
   */
  gruposDeCategoria: Partial<Record<string, string>>;
  /**
   * O que quem liga diz sobre onde pegou o contato ("Peguei seu contato [origem]").
   * null = as frases de sempre, escritas em `components/ligacao/tipos.ts`.
   */
  origens: { porFonte: Readonly<Record<string, string>>; padrao: string } | null;
  /** Módulos que existem para a empresa. Desligado = some da tela. */
  modulos: {
    /** Pré-cadastro na plataforma Komune, link de reivindicação, /r/ e avisos da plataforma. */
    plataformaKomune: boolean;
    /** Leitura da IA, resumos e rascunhos: usam a base de conhecimento da empresa. */
    ia: boolean;
    /**
     * Etiquetas de atitude do cliente (interesse e objeção) e a ordem "Mais
     * interessados" em Conversas (29/10/2026). Só da Imova: a KOMUNE tem as dela.
     * O banco também trava: a regra só liga no banco da Imova.
     */
    atitudeDoCliente: boolean;
    /**
     * Ligação pelo WhatsApp (Calling API da Meta), 30/10/2026. Só da Imova: a KOMUNE
     * liga pela Twilio. O banco também trava (`app.wa_ligacao_ligada`).
     */
    ligacaoWhatsapp: boolean;
    /**
     * A ficha do cliente que se preenche sozinha (03/11/2026). Só da Imova: quem
     * escreve vira ficha de Cliente, a próxima ação se escreve pela etapa e pela
     * conversa, e a aba Clientes de Conversas mostra os clientes com ficha. O
     * banco também trava (`app.ficha_automatica_config`).
     */
    fichaDoCliente: boolean;
    /**
     * Concluir a conversa (03/11/2026): o arquivar com nome na tela, a lista de
     * "Concluídas" e a volta quando alguém do time escreve. Nasceu só na Imova e
     * foi para a KOMUNE em 04/11/2026, com a tela de Conversas no jeito do
     * WhatsApp ("todas as mudanças que fizemos na aba de conversas da Imova").
     * Desligado, volta o ícone de arquivar. O banco também trava
     * (`app.concluir_ligado`).
     */
    concluirConversa: boolean;
    /**
     * Anúncios de imóveis que sobem para o Canal Pro (04/11/2026): a aba Anúncios
     * e o arquivo VRSync que o Grupo OLX lê a cada 12 horas. Só da Imova: no banco
     * da KOMUNE a migração não cria nada, e a Edge Function `canal-pro-feed` só é
     * publicada no projeto da Imova.
     */
    anuncios: boolean;
    /**
     * A IA que atende o cliente sozinha (06/11/2026): responde, tira dúvida dos
     * imóveis, marca visita e passa para um corretor; o selo e o "Parar a IA" na
     * conversa, o "Boa / Corrigir" nas respostas dela e a tela "IA que atende"
     * (caderno, placar e configuração). Só da Imova: na KOMUNE a migração não cria
     * nada e a porteira de mensagens continua exigindo aprovação (ADR-05).
     */
    iaQueAtende: boolean;
    /**
     * Os relatórios da Imova, o "relatório que vende" (09/11/2026; a primeira
     * versão é de 06/11): a aba Relatórios tem Visão geral (abre primeiro),
     * Imóveis (interessados por imóvel, o lead mais quente de cada um e as
     * sugestões da IA), Oportunidades (o dinheiro parado e a fila de hoje), Funil
     * e equipe, e Progresso da IA. Os painéis da captação da KOMUNE saem da
     * barra. No banco da KOMUNE as migrações não criam nada.
     */
    relatoriosDaImova: boolean;
    /**
     * O canal de chegada do lead (06/11/2026): Placa, Anúncios, Redes sociais ou
     * Outros (até 09/11, Indicação), posto pela regra e pela IA (que lê a foto da placa) e corrigível por
     * quem atende; etiqueta em Conversas, bloco na ficha e painel "Canais" nos
     * relatórios. Só da Imova. O banco também trava (`app.canal_de_chegada_config`).
     */
    canalDeChegada: boolean;
    /**
     * O Meu dia novo (10/11/2026), a fase 1 do protótipo aprovado ("Gostei dessa
     * atualização. Suba para o ambiente da Imova"): os números do dia numa faixa
     * compacta com a marca de ritmo, quem respondeu separado em "janela aberta" e
     * "só com modelo" (o aviso da janela uma vez por bloco, e não em cada linha), a
     * última mensagem do lead na linha, a ação escrita na própria linha e a agenda
     * de hoje ao lado da fila. Só da Imova: é só tela, nenhum dado novo no banco.
     */
    meuDiaNovo: boolean;
    /**
     * A visita marcada no CRM com hora (`visita_marcar`, `tasks.origin = 'manual'`)
     * mostra a hora e o fim no cartão da Agenda (11/11/2026, junto com o Calendly:
     * na imobiliária a visita é horário combinado com o cliente). Na KOMUNE a visita
     * continua sendo "porta a bater" sem hora (PRD RF-AGE-01). Só tela.
     */
    horaNaVisita: boolean;
    /**
     * A espera em degraus (11/11/2026): "15 min sem resposta avisa quem atende;
     * 1 h avisa a gestão". O cartão, o som e a notificação do sistema no
     * computador (`components/avisos/vigia-de-espera`), com a mesma regra do
     * aviso no celular (`public.esperas_para_avisar`). Só da Imova: no banco da
     * KOMUNE a migração 20261111200000 não cria as funções da espera.
     */
    esperaEmDegraus: boolean;
  };
  /**
   * A política de privacidade pública, em `/privacidade`. É o link que a Meta pede para
   * publicar o app do WhatsApp e o Google pede para publicar o login. null = a empresa
   * publica a política fora do CRM (a KOMUNE, em komune.app.br/privacidade), e a rota
   * continua atrás do login, como sempre esteve.
   */
  privacidade: PoliticaDePrivacidade | null;
  /**
   * O que muda na MOLDURA do CRM de uma empresa para a outra (10/11/2026). As cores
   * de tela não moram aqui: moram no `globals.css`, num bloco `[data-empresa]` que só
   * vale para a empresa dele. Aqui fica o que o navegador lê fora do CSS. A KOMUNE
   * guarda, valor por valor, o que estava fixo no código antes (um teste confere).
   */
  visual: VisualDaEmpresa;
}

/** A moldura de uma empresa: tema de entrada, barra do navegador e ícones da PWA. */
export interface VisualDaEmpresa {
  /** O tema com que o CRM abre para quem nunca escolheu um no alternador. */
  temaPadrao: 'dark' | 'light';
  /** A cor da barra do navegador (e da barra de status do app instalado), por tema. */
  corDaBarra: { dark: string; light: string };
  /** A pasta dos ícones da PWA dentro de `public/`, sem barra no fim. */
  icones: string;
  /** As duas cores do manifest: a splash do app instalado e a barra antes de o CRM abrir. */
  manifest: { fundo: string; tema: string };
}

/** Quem responde pelos dados e como falar com ela, no topo de `/privacidade`. */
export interface PoliticaDePrivacidade {
  /** O controlador (LGPD, art. 5º, VI), como a pessoa conhece a empresa. */
  controlador: string;
  /**
   * O que identifica o controlador como pessoa jurídica: razão social, CNPJ e o CRECI
   * da empresa, nunca o do corretor responsável técnico.
   */
  registro: string;
  endereco: string;
  /** Canal dos pedidos de privacidade, que também é o do encarregado (LGPD, art. 41). */
  email: string;
  whatsapp: string;
  /** Por quanto tempo contatos e conversas ficam depois do último contato, por extenso. */
  guarda: string;
  /** Data da versão em vigor, por extenso. Muda junto com qualquer mudança no texto. */
  versao: string;
}

export const EMPRESAS: Record<EmpresaSlug, Empresa> = {
  komune: {
    slug: 'komune',
    nome: 'Komune',
    nomeDoNumero: 'KOMUNE',
    nomeNoAviso: 'KOMUNE',
    tituloDoApp: 'Tríade',
    descricaoDoLogin: 'CRM de captação da Komune.',
    descricaoDoApp:
      'CRM de captação da KOMUNE: parceiros, Revisão, funis, conversas de WhatsApp, agenda, metas e relatórios.',
    admins: {
      ou: 'Rafael, Luiz ou Matheus',
      e: 'Rafael, Luiz e Matheus',
      tecnicos: 'Luiz ou Matheus',
    },
    tipos: { fornecedor: 'Fornecedor', produtor: 'Produtor', cerimonialista: 'Cerimonialista' },
    gruposDeCategoria: {},
    origens: null,
    modulos: {
      plataformaKomune: true,
      ia: true,
      atitudeDoCliente: false,
      ligacaoWhatsapp: false,
      fichaDoCliente: false,
      concluirConversa: true,
      anuncios: false,
      iaQueAtende: false,
      relatoriosDaImova: false,
      canalDeChegada: false,
      meuDiaNovo: false,
      horaNaVisita: false,
      esperaEmDegraus: false,
    },
    privacidade: null,
    visual: {
      temaPadrao: 'dark',
      corDaBarra: { dark: '#0f172a', light: '#f0f8ff' },
      icones: '/icons',
      manifest: { fundo: '#f0f8ff', tema: '#0f172a' },
    },
  },
  imova: {
    slug: 'imova',
    nome: 'Imova Imobiliária',
    nomeDoNumero: 'Imova Imobiliária',
    nomeNoAviso: 'Imova',
    tituloDoApp: 'Tríade · Imova',
    descricaoDoLogin: 'CRM da Imova Imobiliária.',
    descricaoDoApp:
      'CRM da Imova Imobiliária: proprietários e clientes, funis, conversas de WhatsApp, agenda, metas e relatórios.',
    admins: { ou: 'um administrador', e: 'os administradores', tecnicos: 'um administrador' },
    tipos: { fornecedor: 'Proprietário', produtor: 'Cliente', cerimonialista: null },
    gruposDeCategoria: { servicos: 'Imóveis', producao: 'Clientes' },
    origens: {
      porFonte: {
        google_places: 'no Google Maps',
        instagram: 'no Instagram',
        planilha: 'numa lista de contatos da Imova Imobiliária',
        contato_pessoal: 'com uma pessoa aqui da Imova Imobiliária, que me passou o seu contato',
        indicacao: 'por indicação de um cliente da Imova Imobiliária',
        captura_campo: 'num atendimento da Imova Imobiliária',
        whatsapp_entrada: 'pelo WhatsApp da Imova Imobiliária',
        // A ficha que nasce de um lead do Canal Pro (migração 20261105100000).
        canal_pro: 'pelo anúncio da Imova Imobiliária que você viu no ZAP, no Viva Real ou na OLX',
      },
      padrao: 'numa lista de contatos da Imova Imobiliária',
    },
    modulos: {
      plataformaKomune: false,
      ia: false,
      atitudeDoCliente: true,
      ligacaoWhatsapp: true,
      fichaDoCliente: true,
      concluirConversa: true,
      anuncios: true,
      iaQueAtende: true,
      relatoriosDaImova: true,
      canalDeChegada: true,
      meuDiaNovo: true,
      horaNaVisita: true,
      esperaEmDegraus: true,
    },
    privacidade: {
      controlador: 'Imova Imobiliária',
      registro: 'razão social IMOVA LTDA, CNPJ 66.913.275/0001-24, CRECI-RN 9825',
      endereco: 'Av. Engenheiro Roberto Freire, 4715, Sala A, Ponta Negra, Natal/RN, CEP 59090-000',
      email: 'contato@imovaimobiliaria.com.br',
      whatsapp: '(84) 99405-8888',
      guarda: '2 anos',
      versao: '27 de outubro de 2026',
    },
    // A Imova abre no claro (10/11/2026): o time dela atende de dia e sai para avaliar
    // imóvel e fotografar placa, e o claro é o tema que se lê no sol. As cores são as
    // do logo: o petróleo (#2D827D) puxado para o fundo da casca e a névoa do fundo da
    // página. O escuro continua no alternador.
    visual: {
      temaPadrao: 'light',
      corDaBarra: { dark: '#0b1918', light: '#f1f5f4' },
      icones: '/icons/imova',
      manifest: { fundo: '#f1f5f4', tema: '#0f3a37' },
    },
  },
};

/** A empresa de um slug; slug desconhecido é erro, nunca "cai" na KOMUNE em silêncio. */
export function empresaPorSlug(slug: string | undefined | null): Empresa {
  const chave = (slug ?? 'komune').trim() as EmpresaSlug;
  const empresa = EMPRESAS[chave];
  if (!empresa) {
    throw new Error(
      `Empresa "${slug}" não existe no Tríade (${Object.keys(EMPRESAS).join(', ')}).`,
    );
  }
  return empresa;
}
