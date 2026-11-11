/**
 * O cartão do anúncio como o do Canal Pro (05/11/2026), só na Imova.
 *
 * Pedido do usuário com o print das duas telas lado a lado: "Preciso que o meu
 * CRM fique igual o Canal Pro". O cartão de lá traz, nesta ordem, o endereço
 * como título, Venda/Aluguel, de onde veio, o código com botão de copiar, área e
 * cômodos, o preço, "Criado em · Atualizado em", a nota de qualidade, a situação
 * (Publicado, Em processamento, Não publicado), as visualizações e os leads.
 *
 * Aqui mora a conta de cada pedaço, sem tela, para o Vitest conferir. Os dados
 * vêm de `public.anuncios_na_lista` (migração 20261105140000).
 *
 * A NOTA DE QUALIDADE é do CRM, com as regras que o Canal Pro publica para o
 * anunciante (as do protótipo de 04/11): o Canal Pro não entrega a nota dele no
 * relatório nem por API, então a do CRM pode sair diferente da que aparece lá.
 * A tela diz isso ao abrir a nota.
 */
import { ativoNoCanalPro } from './relatorio-canal-pro';
import {
  type AnuncioNaLista,
  type MostrarEndereco,
  type Negocio,
  type SituacaoDoCanalPro,
  tipoDeImovel,
} from './tipos';

const FUSO = 'America/Fortaleza';

// ---------------------------------------------------------------------------
// Regras por tipo de imóvel que `TIPOS_DE_IMOVEL` não carrega
// ---------------------------------------------------------------------------

/**
 * Terreno é só chão: a nota de "Áreas e cômodos" pede só a área total, e o
 * cartão não mostra vaga. Mesma regra do protótipo (`terra`).
 */
const TERRENOS: ReadonlySet<string> = new Set(['terreno', 'terreno_comercial']);

/**
 * Os tipos que costumam pagar condomínio: neles, a nota de "Condomínio e IPTU"
 * pede os dois; nos outros, só o IPTU. São os do protótipo (`cond`), mais o
 * loft (vai ao portal como apartamento), o consultório (é uma sala) e o andar
 * corporativo (fica em prédio de escritórios).
 */
const COM_CONDOMINIO: ReadonlySet<string> = new Set([
  'apartamento',
  'casa_condominio',
  'cobertura',
  'kitnet',
  'studio',
  'flat',
  'loft',
  'sala_comercial',
  'consultorio',
  'andar_corporativo',
]);

export function ehTerreno(tipo: string): boolean {
  return TERRENOS.has(tipo);
}

// ---------------------------------------------------------------------------
// A nota de qualidade
// ---------------------------------------------------------------------------

export type ItemDaNota = {
  id:
    | 'fotos'
    | 'descricao'
    | 'caracteristicas'
    | 'video'
    | 'endereco'
    | 'titulo'
    | 'valores'
    | 'areas';
  rotulo: string;
  /** Arredondado a uma casa: a soma dos itens fecha com a nota. */
  pontos: number;
  maximo: number;
  /** O que a pessoa lê: como está e o que falta para a nota máxima do item. */
  dica: string;
};

export type NotaDeQualidade = { nota: number; itens: ItemDaNota[] };

export type DadosDaNota = Pick<
  AnuncioNaLista,
  | 'tipo'
  | 'titulo'
  | 'fotos'
  | 'descricao_tamanho'
  | 'caracteristicas_qtd'
  | 'video_youtube'
  | 'cep'
  | 'numero'
  | 'condominio'
  | 'iptu'
  | 'area_util'
  | 'area_total'
  | 'quartos'
  | 'suites'
  | 'banheiros'
  | 'vagas'
>;

/** O link do YouTube que o portal aceita (vídeo, shorts ou youtu.be). Mesmo do protótipo. */
const YOUTUBE =
  /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?(\S*&)?v=|shorts\/)|youtu\.be\/)[\w-]{6,}/i;

function cepValido(cep: string | null): boolean {
  return /^\d{5}-?\d{3}$/.test((cep ?? '').trim());
}

function plural(n: number, um: string, varios: string): string {
  return n === 1 ? um : varios;
}

const INTEIRO = new Intl.NumberFormat('pt-BR');

function casa(n: number): number {
  return Math.round(n * 10) / 10;
}

function emLista(partes: string[]): string {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

/**
 * A nota de 0 a 10 e o detalhe de cada item, com os pesos do protótipo: fotos
 * até 15 (3 pontos), descrição até 600 caracteres (2), características até 8
 * (1,5), vídeo do YouTube (0,5), CEP e número (1), título de 30 a 80
 * caracteres (1), condomínio e IPTU (0,5), áreas e cômodos (0,5).
 */
export function qualidadeDoAnuncio(d: DadosDaNota): NotaDeQualidade {
  const tipo = tipoDeImovel(d.tipo);
  const terreno = ehTerreno(d.tipo);
  const itens: ItemDaNota[] = [];

  const nf = Math.max(0, d.fotos ?? 0);
  itens.push({
    id: 'fotos',
    rotulo: 'Fotos',
    pontos: Math.min(nf / 15, 1) * 3,
    maximo: 3,
    dica:
      nf >= 15
        ? `${nf} fotos. Nota máxima.`
        : `${nf} ${plural(nf, 'foto', 'fotos')}. Com 15 a nota é máxima.`,
  });

  const dl = Math.max(0, d.descricao_tamanho ?? 0);
  itens.push({
    id: 'descricao',
    rotulo: 'Descrição',
    pontos: Math.min(dl / 600, 1) * 2,
    maximo: 2,
    dica:
      dl >= 600
        ? 'Descrição completa.'
        : `${INTEIRO.format(dl)} ${plural(dl, 'caractere', 'caracteres')}. Com 600 a nota é máxima.`,
  });

  const nc = Math.max(0, d.caracteristicas_qtd ?? 0);
  itens.push({
    id: 'caracteristicas',
    rotulo: 'Características',
    pontos: Math.min(nc / 8, 1) * 1.5,
    maximo: 1.5,
    dica:
      nc >= 8
        ? `${nc} marcadas. Nota máxima.`
        : `${nc} ${plural(nc, 'marcada', 'marcadas')}. Com 8 a nota é máxima.`,
  });

  const video = YOUTUBE.test((d.video_youtube ?? '').trim());
  itens.push({
    id: 'video',
    rotulo: 'Vídeo',
    pontos: video ? 0.5 : 0,
    maximo: 0.5,
    dica: video ? 'Vídeo do YouTube informado.' : 'Sem vídeo do YouTube.',
  });

  const temCep = cepValido(d.cep);
  const temNumero = (d.numero ?? '').trim() !== '';
  itens.push({
    id: 'endereco',
    rotulo: 'CEP e número',
    pontos: (temCep ? 0.5 : 0) + (temNumero ? 0.5 : 0),
    maximo: 1,
    dica:
      temCep && temNumero
        ? 'Com CEP e número.'
        : temCep
          ? 'Falta o número. Ele não aparece no portal se você não quiser.'
          : temNumero
            ? 'Falta o CEP.'
            : 'Falta o CEP e o número.',
  });

  const tl = (d.titulo ?? '').trim().length;
  const tituloBom = tl >= 30 && tl <= 80;
  itens.push({
    id: 'titulo',
    rotulo: 'Título',
    pontos: tituloBom ? 1 : 0,
    maximo: 1,
    dica: `${tl} ${plural(tl, 'caractere', 'caracteres')}. ${tituloBom ? 'Bom tamanho.' : 'O ideal é de 30 a 80.'}`,
  });

  const pedeCondominio = COM_CONDOMINIO.has(d.tipo);
  const faltaValor = [
    ...(pedeCondominio && d.condominio === null ? ['o condomínio'] : []),
    ...(d.iptu === null ? ['o IPTU'] : []),
  ];
  itens.push({
    id: 'valores',
    rotulo: pedeCondominio ? 'Condomínio e IPTU' : 'IPTU',
    pontos: faltaValor.length === 0 ? 0.5 : 0,
    maximo: 0.5,
    dica: faltaValor.length === 0 ? 'Informados.' : `Informe ${emLista(faltaValor)}.`,
  });

  const faltaArea: string[] = [];
  if (!((d.area_total ?? 0) > 0)) faltaArea.push('área total');
  if (!terreno) {
    if (!((d.area_util ?? 0) > 0)) faltaArea.unshift('área útil');
    if (tipo.pedeQuartos && d.quartos === null) faltaArea.push('quartos');
    if (tipo.pedeQuartos && d.suites === null) faltaArea.push('suítes');
    if (d.banheiros === null) faltaArea.push('banheiros');
    if (d.vagas === null) faltaArea.push('vagas');
  }
  itens.push({
    id: 'areas',
    rotulo: terreno ? 'Área' : 'Áreas e cômodos',
    pontos: faltaArea.length === 0 ? 0.5 : 0,
    maximo: 0.5,
    dica: faltaArea.length === 0 ? 'Completos.' : `Falta: ${emLista(faltaArea)}.`,
  });

  for (const item of itens) item.pontos = casa(item.pontos);
  return { nota: casa(itens.reduce((s, i) => s + i.pontos, 0)), itens };
}

export type FaixaDaNota = 'boa' | 'media' | 'baixa';

export function faixaDaNota(nota: number): FaixaDaNota {
  return nota >= 8 ? 'boa' : nota >= 5 ? 'media' : 'baixa';
}

const UMA_CASA = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** 7.8 → "7,8". */
export function formatarNota(n: number): string {
  return UMA_CASA.format(n);
}

// ---------------------------------------------------------------------------
// O título do cartão: o endereço
// ---------------------------------------------------------------------------

const ESTADOS: Record<string, string> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapá',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Pará',
  PB: 'Paraíba',
  PR: 'Paraná',
  PE: 'Pernambuco',
  PI: 'Piauí',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondônia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'São Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
};

/** "RN" → "Rio Grande do Norte"; o que não for sigla conhecida fica como veio. */
export function nomeDoEstado(sigla: string | null): string {
  const s = (sigla ?? '').trim();
  return ESTADOS[s.toUpperCase()] ?? s;
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * "Avenida Engenheiro Roberto Freire - Ponta Negra, Natal - Rio Grande do
 * Norte", como o Canal Pro escreve. O número entra só quando o anúncio mostra o
 * endereço completo no portal (`mostrar_endereco`, o `displayAddress` do
 * arquivo), e não se repete quando a rua já o traz ("Av X, 2004"). Sem rua,
 * fica o bairro e a cidade; sem nada, null.
 */
export function enderecoDoCartao(a: {
  endereco: string | null;
  numero: string | null;
  mostrar_endereco: MostrarEndereco | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
}): string | null {
  const numero = (a.numero ?? '').trim();
  let rua = (a.endereco ?? '').trim();
  if (
    rua &&
    numero &&
    a.mostrar_endereco === 'completo' &&
    !new RegExp(`[\\s,]${escaparRegex(numero)}$`).test(rua)
  ) {
    rua = `${rua}, ${numero}`;
  }
  const cidadeEstado = [(a.cidade ?? '').trim(), nomeDoEstado(a.estado)]
    .filter(Boolean)
    .join(' - ');
  const lugar = [(a.bairro ?? '').trim(), cidadeEstado].filter(Boolean).join(', ');
  return [rua, lugar].filter(Boolean).join(' - ') || null;
}

// ---------------------------------------------------------------------------
// Os chips
// ---------------------------------------------------------------------------

export function negociosDoCartao(negocio: Negocio): ('Venda' | 'Aluguel')[] {
  if (negocio === 'venda_aluguel') return ['Venda', 'Aluguel'];
  return negocio === 'aluguel' ? ['Aluguel'] : ['Venda'];
}

export type OrigemDoAnuncio = AnuncioNaLista['origem'];

/** De onde o anúncio veio, no lugar do "Via Integração" do Canal Pro. */
export function rotuloDaOrigem(a: {
  origem: OrigemDoAnuncio;
  codigo: string;
  codigo_no_canal_pro: string | null;
}): string {
  if (a.origem === 'sistema_atual') return 'Via sistema atual';
  if (a.origem === 'relatorio_canal_pro' || a.codigo_no_canal_pro) {
    return a.codigo_no_canal_pro && a.codigo_no_canal_pro !== a.codigo
      ? `Do Canal Pro (${a.codigo_no_canal_pro})`
      : 'Do Canal Pro';
  }
  return 'Criado no CRM';
}

// ---------------------------------------------------------------------------
// Área e cômodos
// ---------------------------------------------------------------------------

export type Comodo = {
  id: 'area' | 'quartos' | 'banheiros' | 'vagas';
  /** O que aparece ao lado do ícone. */
  texto: string;
  /** O que o leitor de tela lê. */
  descricao: string;
};

/**
 * A linha de ícones do Canal Pro: área, quartos, banheiros e vagas. A área é a
 * que o portal lê para o tipo (útil, ou total no terreno e no galpão). O
 * cômodo que o tipo usa aparece sempre, com 0 quando está vazio; o que o tipo
 * não usa (quarto em sala comercial, vaga em terreno) só aparece se tiver
 * número.
 */
export function comodosDoCartao(
  a: Pick<AnuncioNaLista, 'tipo' | 'area_util' | 'area_total' | 'quartos' | 'banheiros' | 'vagas'>,
): Comodo[] {
  const tipo = tipoDeImovel(a.tipo);
  const lista: Comodo[] = [];
  const total = tipo.area === 'total';
  const area = total ? (a.area_total ?? a.area_util) : (a.area_util ?? a.area_total);
  if (area !== null && area > 0) {
    const qual = (total ? a.area_total !== null : a.area_util === null) ? 'total' : 'útil';
    lista.push({
      id: 'area',
      texto: `${INTEIRO.format(area)} m²`,
      descricao: `${INTEIRO.format(area)} m² de área ${qual}`,
    });
  }
  const comodo = (
    id: Comodo['id'],
    valor: number | null,
    usa: boolean,
    um: string,
    varios: string,
  ) => {
    if (!usa && !(valor !== null && valor > 0)) return;
    const n = valor ?? 0;
    lista.push({ id, texto: String(n), descricao: `${n} ${plural(n, um, varios)}` });
  };
  comodo('quartos', a.quartos, tipo.pedeQuartos, 'quarto', 'quartos');
  comodo('banheiros', a.banheiros, tipo.pedeBanheiros, 'banheiro', 'banheiros');
  comodo('vagas', a.vagas, !ehTerreno(a.tipo), 'vaga', 'vagas');
  return lista;
}

// ---------------------------------------------------------------------------
// Datas e situação
// ---------------------------------------------------------------------------

const DIA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** "05/11/2026", no fuso da operação. */
export function formatarDia(iso: string): string {
  return DIA.format(new Date(iso));
}

/**
 * "Criado em" como o Canal Pro mostra: a data original do anúncio no portal (a
 * coluna "Criação" do relatório), quando o relatório a traz; senão, o dia em que
 * o anúncio entrou no CRM. A do relatório é só data (AAAA-MM-DD): não passa por
 * fuso, senão 16/09 viraria 15/09.
 */
export function diaDeCriacao(a: Pick<AnuncioNaLista, 'criado_em' | 'no_canal_pro_criado_em'>): {
  dia: string;
  doCanalPro: boolean;
} {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a.no_canal_pro_criado_em ?? '');
  if (m) return { dia: `${m[3]}/${m[2]}/${m[1]}`, doCanalPro: true };
  return { dia: formatarDia(a.criado_em), doCanalPro: false };
}

/** O que dizem do anúncio, fora do CRM, o relatório do Canal Pro e o arquivo do sistema atual. */
type ForaDoCrm = Pick<
  AnuncioNaLista,
  'no_canal_pro_situacao' | 'no_canal_pro_visto_em' | 'no_sistema_atual' | 'sistema_atual_em'
>;

/**
 * Se o anúncio está no portal sem ser pelo CRM (06/11/2026): 'ativo', 'inativo'
 * ou null, quando nem o relatório do Canal Pro nem o arquivo do sistema atual
 * sabem dele. O relatório manda, porque é o que o portal diz; só perde para o
 * arquivo do sistema atual quando o anúncio SAIU do arquivo depois do relatório
 * (o sistema parou de mandá-lo, e o portal o tira na próxima leitura). Sem
 * relatório, estar no último arquivo do sistema atual é estar no portal.
 */
export function situacaoForaDoCrm(a: ForaDoCrm): 'ativo' | 'inativo' | null {
  if (saiuDoSistemaAtual(a)) {
    const relatorio = a.no_canal_pro_visto_em ? new Date(a.no_canal_pro_visto_em).getTime() : null;
    const saiu = a.sistema_atual_em ? new Date(a.sistema_atual_em).getTime() : null;
    if (relatorio === null || (saiu !== null && saiu > relatorio)) return 'inativo';
  }
  if (a.no_canal_pro_situacao !== null) {
    return ativoNoCanalPro(a.no_canal_pro_situacao) ? 'ativo' : 'inativo';
  }
  return a.no_sistema_atual === true ? 'ativo' : null;
}

/** O anúncio estava no arquivo do sistema atual e sumiu dele. */
export function saiuDoSistemaAtual(a: Pick<AnuncioNaLista, 'no_sistema_atual'>): boolean {
  return a.no_sistema_atual === false;
}

/**
 * Em que aba o anúncio fica, com as palavras do Canal Pro (decisões de 05 e
 * 06/11/2026: no ar, inativos e rascunhos): no ar pelo CRM é publicado; senão
 * vale `situacaoForaDoCrm` (ativo = publicado, pelo sistema atual; inativo = não
 * publicado); sem nada disso, fora do ar é não publicado e o resto é rascunho.
 */
export type EstadoNoPortal = 'publicado' | 'nao_publicado' | 'rascunho';

export function estadoNoPortal(a: Pick<AnuncioNaLista, 'situacao'> & ForaDoCrm): EstadoNoPortal {
  if (a.situacao === 'no_ar') return 'publicado';
  const fora = situacaoForaDoCrm(a);
  if (fora) return fora === 'ativo' ? 'publicado' : 'nao_publicado';
  return a.situacao === 'pausado' ? 'nao_publicado' : 'rascunho';
}

export type SeloDoAnuncio = {
  rotulo:
    | 'Publicado'
    | 'Em processamento'
    | 'Rascunho'
    | 'Não publicado'
    | 'Inativo'
    | 'Excluído'
    | 'Fora do arquivo';
  tom: 'publicado' | 'processando' | 'rascunho' | 'apagado' | 'alerta';
};

/**
 * A situação com as palavras do Canal Pro. No ar vira "Publicado" depois que o
 * robô do Grupo OLX leu o arquivo; antes disso (ou se ele nunca leu), "Em
 * processamento". Fora do ar é "Não publicado". No ar com pendência é "Fora do
 * arquivo" (11/11/2026): o arquivo o pula, e "Publicado" seria mentira.
 */
export function seloDoAnuncio(
  a: Pick<
    AnuncioNaLista,
    'situacao' | 'publicado_em' | 'ultima_leitura_do_portal' | 'excluido_em'
  > &
    Partial<Pick<AnuncioNaLista, 'pendencias'>> &
    ForaDoCrm,
): SeloDoAnuncio {
  if (a.excluido_em) return { rotulo: 'Excluído', tom: 'apagado' };
  if (foraDoArquivo(a)) return { rotulo: 'Fora do arquivo', tom: 'alerta' };
  // Fora do CRM, o portal manda: o anúncio está lá pelo sistema atual (ativo) ou
  // inativo, como o relatório do Canal Pro e o arquivo do sistema atual dizem.
  const fora = a.situacao === 'no_ar' ? null : situacaoForaDoCrm(a);
  if (fora) {
    return fora === 'ativo'
      ? { rotulo: 'Publicado', tom: 'publicado' }
      : { rotulo: 'Inativo', tom: 'apagado' };
  }
  if (a.situacao === 'rascunho') return { rotulo: 'Rascunho', tom: 'rascunho' };
  if (a.situacao === 'pausado') return { rotulo: 'Não publicado', tom: 'apagado' };
  const leitura = a.ultima_leitura_do_portal
    ? new Date(a.ultima_leitura_do_portal).getTime()
    : null;
  const publicado = a.publicado_em ? new Date(a.publicado_em).getTime() : null;
  const processando = leitura === null || (publicado !== null && publicado > leitura);
  return processando
    ? { rotulo: 'Em processamento', tom: 'processando' }
    : { rotulo: 'Publicado', tom: 'publicado' };
}

/**
 * O rascunho que está no arquivo do sistema que publica hoje continua no portal
 * por ele: a nota evita que alguém o veja como fora do ar.
 */
export function noPortalPeloSistemaAtual(
  a: Pick<AnuncioNaLista, 'no_sistema_atual' | 'situacao' | 'excluido_em'>,
): boolean {
  return a.no_sistema_atual === true && a.situacao === 'rascunho' && !a.excluido_em;
}

// ---------------------------------------------------------------------------
// No ar no CRM, mas fora do arquivo (11/11/2026)
// ---------------------------------------------------------------------------

/**
 * O anúncio está no ar no CRM, mas o arquivo do Canal Pro o pula: o arquivo só
 * leva o que está no ar, não excluído e SEM pendência (`public.canal_pro_feed`).
 * Acontece quando o anúncio ganha pendência depois de ir ao ar (por exemplo,
 * "excluir o original", quando um relatório importado traz de volta a linha
 * marcada como excluída). Até 11/11/2026 isso era calado, e o portal o tirava do
 * ar na leitura seguinte.
 */
export function foraDoArquivo(
  a: Pick<AnuncioNaLista, 'situacao' | 'excluido_em'> & Partial<Pick<AnuncioNaLista, 'pendencias'>>,
): boolean {
  return a.situacao === 'no_ar' && !a.excluido_em && (a.pendencias?.length ?? 0) > 0;
}

/** "Falta X, Y e mais 2", com até quatro itens. */
export function oQueFalta(pendencias: readonly string[]): string {
  const p = pendencias.slice(0, 4).join(', ');
  return pendencias.length > 4 ? `${p} e mais ${pendencias.length - 4}` : p;
}

/**
 * A frase do anúncio no ar fora do arquivo. Depois que o Grupo OLX passou a ler o
 * arquivo do CRM, ele sai do portal na leitura seguinte; antes, fica pelo sistema
 * anterior, e sai na troca.
 */
export function fraseForaDoArquivo(
  pendencias: readonly string[],
  ultimaLeituraDoPortal: string | null,
): string {
  return `No ar no CRM, mas fora do arquivo: falta ${oQueFalta(pendencias)}. ${consequenciaForaDoArquivo(
    ultimaLeituraDoPortal,
  )} Complete o que falta, ou tire do ar.`;
}

/** O que acontece com o anúncio no ar fora do arquivo, conforme o Grupo OLX já lê o arquivo do CRM. */
export function consequenciaForaDoArquivo(ultimaLeituraDoPortal: string | null): string {
  return ultimaLeituraDoPortal
    ? 'O Grupo OLX o tira do portal na próxima leitura.'
    : 'Quando o Canal Pro passar a ler o arquivo do CRM, ele não vai.';
}

// ---------------------------------------------------------------------------
// O plano do Canal Pro, antes do clique (11/11/2026)
// ---------------------------------------------------------------------------

/**
 * O último relatório do Canal Pro já conta este anúncio como vaga ocupada: a
 * linha dele (mesmo código, ou trazido dela) está ativa lá, pelo sistema
 * anterior. Pôr no ar pelo CRM não gasta vaga nova: no portal é o mesmo anúncio.
 * Espelho de `app.canal_pro_ocupadas(p_fora)` (migração 20261111203000).
 */
export function ocupaVagaPeloRelatorio(
  a: Pick<AnuncioNaLista, 'situacao' | 'no_canal_pro_situacao' | 'no_canal_pro_visto_em'>,
): boolean {
  return (
    a.situacao !== 'no_ar' &&
    a.no_canal_pro_visto_em !== null &&
    ativoNoCanalPro(a.no_canal_pro_situacao)
  );
}

/**
 * O que o plano trava antes do clique, no menu do cartão e no editor. Quem recusa
 * é o banco (`anuncio_publicar`, `anuncio_destaque`); a tela só avisa. Desde
 * 11/11/2026, o anúncio que o relatório já conta não é barrado pelo plano cheio:
 * ele só ocuparia a própria vaga. O destaque dele não é conferido aqui (a tela
 * não sabe se a linha do relatório tem destaque): o banco decide.
 */
export function travasDoPlano(
  plano: SituacaoDoCanalPro['plano'] | null,
  a: { situacao: AnuncioNaLista['situacao']; destaque: string; ocupaVagaPeloRelatorio: boolean },
): { semVaga: boolean; semDestaque: boolean; destaqueBarrado: boolean } {
  const noAr = a.situacao === 'no_ar';
  const vagasDosOutros = (plano?.anunciosEmUso ?? 0) - (a.ocupaVagaPeloRelatorio ? 1 : 0);
  const semVaga = !noAr && plano?.anuncios != null && vagasDosOutros >= plano.anuncios;
  const destaquesDosOutros =
    (plano?.destaquesEmUso ?? 0) - (noAr && a.destaque !== 'padrao' ? 1 : 0);
  const semDestaque = plano?.destaques != null && destaquesDosOutros >= plano.destaques;
  const destaqueBarrado =
    !noAr && a.destaque !== 'padrao' && semDestaque && !a.ocupaVagaPeloRelatorio;
  return { semVaga, semDestaque, destaqueBarrado };
}
