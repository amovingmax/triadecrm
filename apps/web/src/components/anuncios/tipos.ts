/**
 * Anúncios de imóveis que sobem para o Canal Pro (04/11/2026), só na Imova.
 *
 * O vocabulário da tela. Quem decide o que é válido, o que falta para ir ao ar e
 * quem pode publicar é o Postgres (`app.anuncio_pendencias`, `public.anuncio_*`,
 * migração 20261104150000); aqui ficam os rótulos e as dicas que a pessoa lê
 * ANTES de salvar. A tradução para o VRSync mora na Edge Function `canal-pro-feed`.
 */
import { type AppRole } from '@/lib/auth/role';

export type Situacao = 'rascunho' | 'no_ar' | 'pausado';
export type Negocio = 'venda' | 'aluguel' | 'venda_aluguel';
export type Destaque = 'padrao' | 'destaque' | 'super_destaque' | 'exclusivo' | 'superior';
export type PeriodoAluguel = 'mensal' | 'diario' | 'semanal' | 'trimestral' | 'anual';
export type MostrarEndereco = 'completo' | 'rua' | 'bairro';

/**
 * Pôr no ar, tirar do ar, escolher o destaque, excluir e mexer em anúncio no ar
 * (decisão do usuário em 04/11/2026: "todos criam, gestão publica"). Espelho de
 * `app.admin_ou_gestor()`, que as funções conferem.
 */
export function podePublicarAnuncio(papel: AppRole): boolean {
  return papel === 'admin' || papel === 'gestor';
}

export type TipoDeImovel = {
  id: string;
  rotulo: string;
  grupo: 'Residencial' | 'Comercial';
  /** Qual área o portal lê. Espelho de `app.anuncio_tipo`. */
  area: 'util' | 'total';
  pedeQuartos: boolean;
  pedeBanheiros: boolean;
};

/** Os tipos de `app.anuncio_tipo`, com o nome que o ZAP mostra. */
export const TIPOS_DE_IMOVEL: readonly TipoDeImovel[] = [
  {
    id: 'apartamento',
    rotulo: 'Apartamento',
    grupo: 'Residencial',
    area: 'util',
    pedeQuartos: true,
    pedeBanheiros: true,
  },
  {
    id: 'casa',
    rotulo: 'Casa',
    grupo: 'Residencial',
    area: 'util',
    pedeQuartos: true,
    pedeBanheiros: true,
  },
  {
    id: 'casa_condominio',
    rotulo: 'Casa de condomínio',
    grupo: 'Residencial',
    area: 'util',
    pedeQuartos: true,
    pedeBanheiros: true,
  },
  {
    id: 'casa_vila',
    rotulo: 'Casa de vila',
    grupo: 'Residencial',
    area: 'util',
    pedeQuartos: true,
    pedeBanheiros: true,
  },
  {
    id: 'sobrado',
    rotulo: 'Sobrado',
    grupo: 'Residencial',
    area: 'util',
    pedeQuartos: true,
    pedeBanheiros: true,
  },
  {
    id: 'cobertura',
    rotulo: 'Cobertura',
    grupo: 'Residencial',
    area: 'util',
    pedeQuartos: true,
    pedeBanheiros: true,
  },
  {
    id: 'flat',
    rotulo: 'Flat',
    grupo: 'Residencial',
    area: 'util',
    pedeQuartos: true,
    pedeBanheiros: true,
  },
  {
    id: 'kitnet',
    rotulo: 'Kitnet',
    grupo: 'Residencial',
    area: 'util',
    pedeQuartos: false,
    pedeBanheiros: true,
  },
  {
    id: 'studio',
    rotulo: 'Studio',
    grupo: 'Residencial',
    area: 'util',
    pedeQuartos: false,
    pedeBanheiros: true,
  },
  {
    id: 'loft',
    // O validador do Grupo OLX recusa "Residential / Loft": vai como apartamento.
    rotulo: 'Loft (no portal, como apartamento)',
    grupo: 'Residencial',
    area: 'util',
    pedeQuartos: true,
    pedeBanheiros: true,
  },
  {
    id: 'terreno',
    rotulo: 'Terreno / lote',
    grupo: 'Residencial',
    area: 'total',
    pedeQuartos: false,
    pedeBanheiros: false,
  },
  {
    id: 'chacara',
    rotulo: 'Chácara',
    grupo: 'Residencial',
    area: 'total',
    pedeQuartos: true,
    pedeBanheiros: true,
  },
  {
    id: 'fazenda_sitio',
    rotulo: 'Fazenda / sítio',
    grupo: 'Residencial',
    area: 'total',
    pedeQuartos: true,
    pedeBanheiros: true,
  },
  {
    id: 'sala_comercial',
    rotulo: 'Sala comercial',
    grupo: 'Comercial',
    area: 'util',
    pedeQuartos: false,
    pedeBanheiros: true,
  },
  {
    id: 'consultorio',
    rotulo: 'Consultório',
    grupo: 'Comercial',
    area: 'util',
    pedeQuartos: false,
    pedeBanheiros: true,
  },
  {
    id: 'loja',
    rotulo: 'Loja / ponto comercial',
    grupo: 'Comercial',
    area: 'util',
    pedeQuartos: false,
    pedeBanheiros: false,
  },
  {
    id: 'imovel_comercial',
    rotulo: 'Imóvel comercial',
    grupo: 'Comercial',
    area: 'util',
    pedeQuartos: false,
    pedeBanheiros: false,
  },
  {
    id: 'predio_comercial',
    rotulo: 'Prédio inteiro',
    grupo: 'Comercial',
    area: 'util',
    pedeQuartos: false,
    pedeBanheiros: false,
  },
  {
    id: 'predio_residencial',
    rotulo: 'Prédio residencial',
    grupo: 'Comercial',
    area: 'util',
    pedeQuartos: true,
    pedeBanheiros: true,
  },
  {
    id: 'andar_corporativo',
    rotulo: 'Andar corporativo',
    grupo: 'Comercial',
    area: 'util',
    pedeQuartos: false,
    pedeBanheiros: false,
  },
  {
    id: 'galpao',
    rotulo: 'Galpão / depósito',
    grupo: 'Comercial',
    area: 'total',
    pedeQuartos: false,
    pedeBanheiros: false,
  },
  {
    id: 'terreno_comercial',
    rotulo: 'Terreno comercial',
    grupo: 'Comercial',
    area: 'total',
    pedeQuartos: false,
    pedeBanheiros: false,
  },
  {
    id: 'garagem',
    rotulo: 'Garagem',
    grupo: 'Comercial',
    area: 'util',
    pedeQuartos: false,
    pedeBanheiros: false,
  },
  {
    id: 'hotel',
    rotulo: 'Hotel / pousada',
    grupo: 'Comercial',
    area: 'util',
    pedeQuartos: false,
    pedeBanheiros: false,
  },
];

export function tipoDeImovel(id: string): TipoDeImovel {
  return TIPOS_DE_IMOVEL.find((t) => t.id === id) ?? TIPOS_DE_IMOVEL[0]!;
}

export type TagDoCodigo = 'TE' | 'SA' | 'IM' | 'CO';

/**
 * A tag do código do anúncio, que sai sozinha do tipo (decisões do usuário em
 * 10/11/2026: "TE0001 para Terrenos, IM0001 para Imóveis"; "caso escolhermos um
 * anúncio de terreno, a tag deve automaticamente ser TE"). O banco dá o próximo
 * número livre (`app.anuncio_proximo_codigo`, migração 20261110100000). PT (o
 * PT0001_IMOVA da Arbo) não é tag do CRM. Espelho de `app.anuncio_tag_do_tipo`.
 */
export function tagDoTipo(tipo: string): TagDoCodigo {
  if (tipo === 'terreno' || tipo === 'terreno_comercial') return 'TE';
  if (tipo === 'sala_comercial' || tipo === 'consultorio') return 'SA';
  return tipoDeImovel(tipo).grupo === 'Residencial' ? 'IM' : 'CO';
}

/**
 * A tag de um código que o CRM deu ("TE0006" → TE); código de fora (com
 * sufixo, como TE0001_IMOVA, ou com texto) → null. Espelho de `app.anuncio_tag_do_codigo`.
 */
export function tagDoCodigo(codigo: string): TagDoCodigo | null {
  const m = /^(TE|SA|IM|CO)[0-9]{4,9}$/.exec(codigo);
  return m ? (m[1] as TagDoCodigo) : null;
}

/**
 * Se o código ainda segue o tipo: só no rascunho que nasceu no CRM e nunca foi
 * ao ar. Publicado, o código é o do portal; trazido de fora, é o que liga o
 * anúncio ao que já está lá. Espelho da regra de `public.anuncio_salvar`.
 */
export function tagTrocavel(a: {
  origem: string;
  situacao: Situacao;
  publicado_em: string | null;
}): boolean {
  return a.origem === 'crm' && a.situacao === 'rascunho' && a.publicado_em === null;
}

export const NEGOCIOS: readonly { id: Negocio; rotulo: string }[] = [
  { id: 'venda', rotulo: 'Venda' },
  { id: 'aluguel', rotulo: 'Aluguel' },
  { id: 'venda_aluguel', rotulo: 'Venda e aluguel' },
];

export const PERIODOS: readonly { id: PeriodoAluguel; rotulo: string; sufixo: string }[] = [
  { id: 'mensal', rotulo: 'Por mês', sufixo: '/mês' },
  { id: 'diario', rotulo: 'Por dia', sufixo: '/dia' },
  { id: 'semanal', rotulo: 'Por semana', sufixo: '/semana' },
  { id: 'trimestral', rotulo: 'Por trimestre', sufixo: '/trimestre' },
  { id: 'anual', rotulo: 'Por ano', sufixo: '/ano' },
];

/**
 * O PublicationType do VRSync. Qualquer destaque gasta uma vaga de destaque do
 * plano, e o banco não deixa passar do limite (migração 20261104180000). Os dois
 * PREMIERE são só de contrato Zap+, que a Imova não tem: a escolha os esconde. O
 * "Destaque triplo" (TRIPLE) saiu porque o validador do Grupo OLX o recusa.
 */
export const DESTAQUES: readonly {
  id: Destaque;
  rotulo: string;
  dica: string;
  zapMais?: true;
}[] = [
  { id: 'padrao', rotulo: 'Padrão', dica: 'Sem destaque.' },
  { id: 'destaque', rotulo: 'Destaque', dica: 'Usa uma vaga de destaque do plano.' },
  { id: 'super_destaque', rotulo: 'Super destaque', dica: 'Usa uma vaga de destaque do plano.' },
  {
    id: 'exclusivo',
    rotulo: 'Destaque exclusivo (Zap+)',
    dica: 'Só em contrato Zap+.',
    zapMais: true,
  },
  {
    id: 'superior',
    rotulo: 'Destaque superior (Zap+)',
    dica: 'Só em contrato Zap+.',
    zapMais: true,
  },
];

export function rotuloDoDestaque(id: Destaque): string {
  return DESTAQUES.find((d) => d.id === id)?.rotulo ?? 'Padrão';
}

export const MOSTRAR_ENDERECO: readonly { id: MostrarEndereco; rotulo: string }[] = [
  { id: 'rua', rotulo: 'A rua, sem o número' },
  { id: 'bairro', rotulo: 'Só o bairro' },
  { id: 'completo', rotulo: 'O endereço completo' },
];

export const SITUACOES: Record<Situacao, string> = {
  rascunho: 'Rascunho',
  no_ar: 'No ar',
  pausado: 'Fora do ar',
};

/**
 * As características mais pedidas em Natal, com o valor exato do <Feature> do
 * VRSync (developers.grupozap.com/feeds/vrsync/elements/details.html#features).
 * O banco guarda o valor em inglês; a tela mostra o rótulo.
 */
export const CARACTERISTICAS: readonly {
  grupo: string;
  itens: readonly { valor: string; rotulo: string }[];
}[] = [
  {
    grupo: 'No imóvel',
    itens: [
      { valor: 'Balcony', rotulo: 'Varanda' },
      { valor: 'Gourmet Balcony', rotulo: 'Varanda gourmet' },
      { valor: 'Barbecue Balcony', rotulo: 'Churrasqueira na varanda' },
      { valor: 'American Kitchen', rotulo: 'Cozinha americana' },
      { valor: 'Kitchen Cabinets', rotulo: 'Armário na cozinha' },
      { valor: 'Builtin Wardrobe', rotulo: 'Armário embutido' },
      { valor: 'Closet', rotulo: 'Closet' },
      { valor: 'Furnished', rotulo: 'Mobiliado' },
      { valor: 'Planned Furniture', rotulo: 'Móveis planejados' },
      { valor: 'Cooling', rotulo: 'Ar-condicionado' },
      { valor: 'Home Office', rotulo: 'Escritório' },
      { valor: 'Service Room', rotulo: 'Quarto de serviço' },
      { valor: "Maid's Quarters", rotulo: 'Área de serviço' },
      { valor: 'Lavabo', rotulo: 'Lavabo' },
      { valor: 'Backyard', rotulo: 'Quintal' },
      { valor: 'Private Pool', rotulo: 'Piscina privativa' },
      { valor: 'Solar Energy', rotulo: 'Energia solar' },
      { valor: 'Corner Property', rotulo: 'Imóvel de esquina' },
      { valor: 'Ocean View', rotulo: 'Vista para o mar' },
      { valor: 'Panoramic View', rotulo: 'Vista panorâmica' },
      { valor: 'Pets Allowed', rotulo: 'Aceita animais' },
    ],
  },
  {
    grupo: 'No condomínio',
    itens: [
      { valor: 'Pool', rotulo: 'Piscina' },
      { valor: 'Childrens Pool', rotulo: 'Piscina infantil' },
      { valor: 'Elevator', rotulo: 'Elevador' },
      { valor: 'Gym', rotulo: 'Academia' },
      { valor: 'Party Room', rotulo: 'Salão de festas' },
      { valor: 'Gourmet Area', rotulo: 'Espaço gourmet' },
      { valor: 'BBQ', rotulo: 'Churrasqueira' },
      { valor: 'Playground', rotulo: 'Playground' },
      { valor: 'Sports Court', rotulo: 'Quadra poliesportiva' },
      { valor: 'Game room', rotulo: 'Salão de jogos' },
      { valor: 'Pet Space', rotulo: 'Espaço pet' },
      { valor: 'Sauna', rotulo: 'Sauna' },
      { valor: 'Concierge 24h', rotulo: 'Portaria 24h' },
      { valor: 'Fenced Yard', rotulo: 'Condomínio fechado' },
      { valor: 'Security Camera', rotulo: 'Câmera de segurança' },
      { valor: 'Electronic Gate', rotulo: 'Portão eletrônico' },
      { valor: 'Intercom', rotulo: 'Interfone' },
      { valor: 'Generator', rotulo: 'Gerador' },
      { valor: 'Guest Parking', rotulo: 'Vaga para visitante' },
      { valor: 'Bicycles Place', rotulo: 'Bicicletário' },
    ],
  },
];

const ROTULO_DA_CARACTERISTICA = new Map(
  CARACTERISTICAS.flatMap((g) => g.itens.map((i) => [i.valor, i.rotulo] as const)),
);

export function rotuloDaCaracteristica(valor: string): string {
  return ROTULO_DA_CARACTERISTICA.get(valor) ?? valor;
}

/** O formulário inteiro, como `public.anuncio_salvar` recebe. */
export type DadosDoAnuncio = {
  tipo: string;
  negocio: Negocio;
  titulo: string;
  descricao: string;
  preco_venda: number | null;
  preco_aluguel: number | null;
  periodo_aluguel: PeriodoAluguel;
  condominio: number | null;
  iptu: number | null;
  iptu_periodo: 'anual' | 'mensal';
  area_util: number | null;
  area_total: number | null;
  quartos: number | null;
  suites: number | null;
  banheiros: number | null;
  vagas: number | null;
  caracteristicas: string[];
  cep: string | null;
  estado: string | null;
  cidade: string | null;
  bairro: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  mostrar_endereco: MostrarEndereco;
  video_youtube: string | null;
  proprietario_id: string | null;
};

/** O anúncio aberto no editor: o formulário e o que só a tela mostra. */
export type Anuncio = DadosDoAnuncio & {
  id: string;
  codigo: string;
  /** De onde veio: 'crm', 'sistema_atual' ou 'relatorio_canal_pro'. */
  origem: string;
  situacao: Situacao;
  destaque: Destaque;
  updated_at: string;
  publicado_em: string | null;
  excluido_em: string | null;
  proprietario_nome: string | null;
  /** O código do anúncio manual do Canal Pro de onde este veio, quando veio. */
  codigo_no_canal_pro: string | null;
};

export type FotoDoAnuncio = { id: string; caminho: string; posicao: number };

/** Uma linha de `public.anuncios_na_lista`. */
export type AnuncioNaLista = {
  id: string;
  codigo: string;
  situacao: Situacao;
  titulo: string;
  tipo: string;
  negocio: Negocio;
  preco_venda: number | null;
  preco_aluguel: number | null;
  periodo_aluguel: PeriodoAluguel;
  area_util: number | null;
  area_total: number | null;
  quartos: number | null;
  bairro: string | null;
  cidade: string | null;
  destaque: Destaque;
  updated_at: string;
  publicado_em: string | null;
  excluido_em: string | null;
  motivo_exclusao: string | null;
  fotos: number;
  capa: string | null;
  pendencias: string[] | null;
  proprietario_nome: string | null;
  criado_por_nome: string | null;
  /** O código do anúncio manual do Canal Pro de onde este veio, quando veio. */
  codigo_no_canal_pro: string | null;
  /** Quantos leads dos portais o anúncio recebeu, sem os descartados (20261105100000). */
  leads: number;
  // Daqui para baixo, o que o cartão do Canal Pro mostra (20261105140000).
  criado_em: string;
  suites: number | null;
  banheiros: number | null;
  vagas: number | null;
  condominio: number | null;
  iptu: number | null;
  cep: string | null;
  estado: string | null;
  endereco: string | null;
  numero: string | null;
  mostrar_endereco: MostrarEndereco;
  video_youtube: string | null;
  /** Quantos caracteres a descrição tem (a descrição não vem para a lista). */
  descricao_tamanho: number;
  caracteristicas_qtd: number;
  /** De onde veio: criado aqui, trazido do relatório do Canal Pro ou do sistema atual. */
  origem: 'crm' | 'relatorio_canal_pro' | 'sistema_atual';
  importado_em: string | null;
  /** A última vez que o robô do Grupo OLX leu o arquivo do CRM. */
  ultima_leitura_do_portal: string | null;
  /** O que o último relatório exportado do Canal Pro disse do anúncio de mesmo código. */
  no_canal_pro_situacao: string | null;
  no_canal_pro_visto_em: string | null;
  /** Só quando o relatório traz a coluna; o CRM não conta visualização. */
  no_canal_pro_visualizacoes: number | null;
  /** "Total de contatos" do relatório do Canal Pro (quem chamou pelo portal, por qualquer meio). */
  no_canal_pro_contatos: number | null;
  /** "Criação" do relatório do Canal Pro, em AAAA-MM-DD: a data original do anúncio no portal. */
  no_canal_pro_criado_em: string | null;
  /**
   * Se o código está no arquivo do sistema atual (20261106100000): true = estava
   * na última leitura; false = estava e sumiu; null = nunca esteve.
   */
  no_sistema_atual: boolean | null;
  /** A leitura que confirmou `no_sistema_atual` (a última, ou a em que sumiu). */
  sistema_atual_em: string | null;
};

/**
 * Um anúncio que está no Canal Pro por fora do CRM, como veio no relatório que
 * ele exporta: "Via Integração" (do sistema que publica hoje) ou "Via CanalPro"
 * (cadastrado à mão). O CRM não o edita nem o manda no arquivo: mostra, guia
 * como tirar do ar e, a pedido, traz para o CRM com o mesmo código.
 */
export type AnuncioNoCanalPro = {
  id: string;
  codigo: string;
  titulo: string | null;
  tipo: string | null;
  tipo_crm: string | null;
  negocio: Negocio | null;
  preco_venda: number | null;
  preco_aluguel: number | null;
  bairro: string | null;
  cidade: string | null;
  area: number | null;
  quartos: number | null;
  destaque: string | null;
  situacao: string | null;
  link: string | null;
  anuncio_id: string | null;
  /**
   * O anúncio do CRM que parece o mesmo imóvel, com outro código (cópia antiga):
   * `public.canal_pro_parece_com`, a mesma conta que a importação usa.
   */
  parece_com: string | null;
  /** Quando o relatório importado por último trouxe esta linha. */
  visto_em: string;
  /**
   * Quando alguém a tinha marcado como excluída, se um relatório importado depois
   * ainda a trouxe: a exclusão não pegou no Canal Pro (06/11/2026).
   */
  marcado_excluido_em: string | null;
};

/** Onde se exclui o anúncio cadastrado à mão ("Via CanalPro"): só lá (regra do Grupo OLX). */
export const URL_DO_CANAL_PRO = 'https://canalpro.grupozap.com';

export type SituacaoDoCanalPro = {
  /** Só para admin e gestor: a credencial da URL do arquivo. */
  chave: string | null;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  site: string | null;
  ultimaLeitura: { em: string; anuncios: number } | null;
  leiturasSeteDias: number;
  /** A última importação do relatório do Canal Pro. */
  importadoEm: string | null;
  importados: number | null;
  /**
   * O plano do Canal Pro: o limite (null = o CRM não confere) e o que está em
   * uso, anúncios do CRM no ar + os manuais da lista. A conta é do banco
   * (`app.canal_pro_ocupadas`), a mesma que recusa a publicação.
   */
  plano: {
    anuncios: number | null;
    destaques: number | null;
    anunciosEmUso: number;
    destaquesEmUso: number;
  };
  /** O arquivo do sistema atual: se o endereço está guardado (ele mesmo não vem) e a última leitura. */
  sistemaAtual: { temEndereco: boolean; lidoEm: string | null };
};

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

/** "R$ 450.000" — o portal só aceita reais inteiros, e a tela mostra assim. */
export function formatarPreco(valor: number | null): string | null {
  return valor === null ? null : BRL.format(valor);
}

/** O preço do cartão: venda, aluguel ou os dois. */
export function precoDoAnuncio(a: {
  negocio: Negocio;
  preco_venda: number | null;
  preco_aluguel: number | null;
  periodo_aluguel: PeriodoAluguel;
}): string {
  const venda = a.negocio !== 'aluguel' ? formatarPreco(a.preco_venda) : null;
  const sufixo = PERIODOS.find((p) => p.id === a.periodo_aluguel)?.sufixo ?? '/mês';
  const aluguel =
    a.negocio !== 'venda' && a.preco_aluguel !== null
      ? `${formatarPreco(a.preco_aluguel)}${sufixo}`
      : null;
  return [venda, aluguel].filter(Boolean).join(' · ') || 'Sem preço';
}

/**
 * "R$ 450.000" ou "450000" → 450000; vazio ou lixo → null. Centavos são
 * descartados (o portal só aceita reais inteiros). Zero só vale onde quer dizer
 * alguma coisa: condomínio 0 é "isento" no VRSync; preço 0 não existe.
 */
export function lerValor(texto: string, aceitaZero = false): number | null {
  const semCentavos = texto.trim().replace(/,\d{1,2}$/, '');
  const digitos = semCentavos.replace(/\D/g, '');
  if (digitos === '') return null;
  const n = Number(digitos);
  return Number.isSafeInteger(n) && (n > 0 || (aceitaZero && n === 0)) ? n : null;
}

/** "3" → 3; vazio → null. Para quartos, vagas e áreas (inteiros, como o portal pede). */
export function lerInteiro(texto: string): number | null {
  const limpo = texto.trim().replace(/\D/g, '');
  if (limpo === '') return null;
  const n = Number(limpo);
  return Number.isSafeInteger(n) ? n : null;
}

/** "59090000" → "59090-000". */
export function formatarCep(cep: string | null): string {
  const d = (cep ?? '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** O que cada recusa do banco quer dizer para quem clicou. */
const RECUSAS: Record<string, string> = {
  sem_permissao: 'O seu acesso não faz isso. Peça a um gestor.',
  so_gestao_mexe_no_ar:
    'Este anúncio está no ar: só admin e gestor mexem nele. Peça a um gestor, ou tire do ar antes.',
  no_ar_com_pendencias:
    'Este anúncio está no ar e ficaria incompleto. Complete o que falta, ou tire do ar antes de salvar pela metade.',
  pendencias: 'Ainda falta preencher o que está na lista ao lado.',
  excluido: 'Este anúncio foi excluído. Restaure antes de mexer nele.',
  nao_encontrado: 'Não achei este anúncio. Ele pode ter sido excluído.',
  proprietario_invalido: 'O proprietário escolhido não está mais na base. Escolha outro.',
  nao_esta_no_ar: 'Este anúncio já não está no ar.',
  sem_motivo: 'Escreva o motivo da exclusão (pelo menos 3 letras).',
  caminho_invalido: 'A foto não subiu para o lugar certo. Tente de novo.',
  arquivo_nao_chegou: 'A foto não chegou ao servidor. Tente de novo.',
  fotos_demais: 'O anúncio já tem 40 fotos, o máximo.',
  no_ar_ultima_foto:
    'No ar, o anúncio precisa de pelo menos uma foto. Ponha outra antes de tirar esta.',
  ordem_invalida: 'A ordem das fotos mudou enquanto você mexia. Recarregue a página.',
  sem_nome: 'Escreva o nome da imobiliária.',
  email_invalido: 'O e-mail da imobiliária não parece um e-mail.',
  destaque_invalido: 'Esse destaque não existe.',
  plano_cheio:
    'Todas as vagas do plano do Canal Pro estão ocupadas. Tire outro anúncio do ar, no CRM ou um dos que estão no Canal Pro por fora dele, antes de pôr este.',
  plano_sem_destaque:
    'Os destaques do plano do Canal Pro já estão em uso. Ponha este como Padrão, ou tire o destaque de outro anúncio.',
  plano_invalido:
    'Os números do plano não fecham: use de 0 a 10.000, e destaques não podem passar do total de anúncios.',
  foto_ilegivel: 'Não consegui abrir essa imagem. Use JPG, PNG ou a foto direto da câmera.',
  foto_grande_demais: 'A foto passou de 7 MB mesmo comprimida. Use uma foto menor.',
  rede: 'Sem conexão com o servidor. Confira a internet e tente de novo.',
  relatorio_vazio: 'O arquivo não tem nenhum anúncio.',
  relatorio_grande_demais: 'O arquivo tem mais de 2.000 anúncios. Exporte só os ativos.',
  relatorio_sem_codigo:
    'Nenhuma linha do arquivo tem o código do anúncio. Confira se é o relatório do Canal Pro.',
  // Os leads dos portais (20261105100000). O banco devolve `sem_motivo` e
  // `nao_encontrado` também para o lead; `leads-dados.ts` põe o prefixo `lead_`
  // para a frase falar do lead, e não do anúncio.
  lead_sem_motivo: 'Escreva o motivo do descarte (pelo menos 3 letras).',
  lead_nao_encontrado: 'Não achei este lead. Recarregue a página.',
  situacao_invalida: 'Essa situação não existe para o lead.',
};

export function fraseDaRecusa(motivo: string | undefined | null): string {
  return (motivo && RECUSAS[motivo]) || 'Não deu certo. Tente de novo.';
}
