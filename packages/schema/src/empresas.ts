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
  };
  /**
   * A política de privacidade pública, em `/privacidade`. É o link que a Meta pede para
   * publicar o app do WhatsApp e o Google pede para publicar o login. null = a empresa
   * publica a política fora do CRM (a KOMUNE, em komune.app.br/privacidade), e a rota
   * continua atrás do login, como sempre esteve.
   */
  privacidade: PoliticaDePrivacidade | null;
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
    modulos: { plataformaKomune: true, ia: true, atitudeDoCliente: false },
    privacidade: null,
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
      },
      padrao: 'numa lista de contatos da Imova Imobiliária',
    },
    modulos: { plataformaKomune: false, ia: false, atitudeDoCliente: true },
    privacidade: {
      controlador: 'Imova Imobiliária',
      registro: 'razão social IMOVA LTDA, CNPJ 66.913.275/0001-24, CRECI-RN 9825',
      endereco: 'Av. Engenheiro Roberto Freire, 4715, Sala A, Ponta Negra, Natal/RN, CEP 59090-000',
      email: 'contato@imovaimobiliaria.com.br',
      whatsapp: '(84) 99405-8888',
      guarda: '2 anos',
      versao: '27 de outubro de 2026',
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
