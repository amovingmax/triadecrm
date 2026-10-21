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
  };
}

export const EMPRESAS: Record<EmpresaSlug, Empresa> = {
  komune: {
    slug: 'komune',
    nome: 'Komune',
    nomeDoNumero: 'KOMUNE',
    tituloDoApp: 'Tríade',
    descricaoDoLogin: 'CRM de captação da Komune.',
    descricaoDoApp:
      'CRM de captação da KOMUNE: parceiros, Revisão, funis, conversas de WhatsApp, agenda, metas e relatórios.',
    admins: { ou: 'Rafael, Luiz ou Matheus', e: 'Rafael, Luiz e Matheus', tecnicos: 'Luiz ou Matheus' },
    tipos: { fornecedor: 'Fornecedor', produtor: 'Produtor', cerimonialista: 'Cerimonialista' },
    gruposDeCategoria: {},
    origens: null,
    modulos: { plataformaKomune: true, ia: true },
  },
  imova: {
    slug: 'imova',
    nome: 'Imova Imobiliária',
    nomeDoNumero: 'Imova Imobiliária',
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
    modulos: { plataformaKomune: false, ia: false },
  },
};

/** A empresa de um slug; slug desconhecido é erro, nunca "cai" na KOMUNE em silêncio. */
export function empresaPorSlug(slug: string | undefined | null): Empresa {
  const chave = (slug ?? 'komune').trim() as EmpresaSlug;
  const empresa = EMPRESAS[chave];
  if (!empresa) {
    throw new Error(`Empresa "${slug}" não existe no Tríade (${Object.keys(EMPRESAS).join(', ')}).`);
  }
  return empresa;
}
