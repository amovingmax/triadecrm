/**
 * Leitura de texto de anúncio: tipo do imóvel, título sem dado pessoal, rua
 * (sem número) e os sinais que o título dá (frente-mar, esquina...). Porte de
 * `coletar/anuncios/_regras.mjs` do protótipo.
 *
 * O que é regra de veracidade (faixas, repetidos, imóvel nosso, cerca) NÃO mora
 * aqui: é o banco (`app.mercado_verificar`) que decide. Aqui só se lê o que a
 * página diz, sem inventar: um sinal que o texto não traz fica fora (nunca
 * "false").
 */

export const semAcento = (s: unknown): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export const slug = (s: unknown): string =>
  semAcento(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** "capim-macio" → "capim macio". */
export const deslug = (s: unknown): string =>
  String(s ?? '')
    .replace(/[-_]+/g, ' ')
    .trim();

/** "capim macio" → "Capim Macio" (para bairro e cidade tirados do link). */
export const comoNome = (s: string): string =>
  s
    .split(/\s+/)
    .map((w) => (/^(da|de|do|das|dos|e)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

/**
 * Tipo do sistema a partir do tipo da fonte. Venda e aluguel usam os mesmos.
 * terreno | casa | casa_condominio | apartamento | loja | sala | galpao | predio | rural | outro
 */
export function tipoDe(tipoDaFonte: unknown, texto: unknown = ''): string | null {
  const t = semAcento(tipoDaFonte);
  const x = semAcento(texto);
  if (/terreno|lote|area/.test(t)) return 'terreno';
  if (/galp|deposito|armazem|industrial/.test(t)) return 'galpao';
  if (/sala|conj\.? comercial|conjunto comercial|andar/.test(t)) return 'sala';
  if (/loja|ponto|comercio|casa.*comercial|sobrado comercial|box/.test(t)) return 'loja';
  if (/predio|edificio/.test(t)) return 'predio';
  if (/chacara|sitio|fazenda|rural|haras/.test(t)) return 'rural';
  if (/condom/.test(t) && /casa|sobrado/.test(t)) return 'casa_condominio';
  if (/casa|sobrado|village|vila/.test(t))
    return /condominio fechado/.test(x) ? 'casa_condominio' : 'casa';
  if (/apart|cobertura|flat|kitnet|kitchenette|studio|loft|duplex|triplex/.test(t))
    return 'apartamento';
  if (/comercial/.test(t)) return /sala/.test(x) ? 'sala' : /galp/.test(x) ? 'galpao' : 'loja';
  if (/garagem|vaga/.test(t)) return 'outro';
  return null;
}

export const TIPOS_CONSTRUIDOS = new Set([
  'casa',
  'casa_condominio',
  'apartamento',
  'loja',
  'sala',
  'galpao',
  'predio',
]);

function tirarTelefones(s: string): string {
  return s.replace(/\+?\(?\d[\d\s().-]{6,}\d\)?/g, (m: string, off: number, tudo: string) => {
    const dig = m.replace(/\D/g, '');
    if (dig.length < 8 || dig.length > 13) return m;
    if (/^\s*\d{1,3}(\.\d{3})+\s*$/.test(m)) return m; // preço ou área com ponto de milhar
    if (/R\$\s*$/i.test(tudo.slice(Math.max(0, off - 4), off))) return m; // vem depois de "R$"
    return ' ';
  });
}

/** Título sem dado pessoal: sem telefone, e-mail, perfil de rede social, CRECI nem "fale com <nome>". */
export function limparTitulo(t: unknown): string | null {
  if (t === null || t === undefined || t === '') return null;
  const limpo = tirarTelefones(
    String(t)
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '')
      .replace(/(^|[\s(/])@[\w.]{3,}/g, '$1')
      .replace(/[\w.]*_(corretor|corretora|imoveis|imob|consultor|consultora)\w*/gi, '')
      .replace(/\bcreci[\s\w/-]*\d[\w-]*/gi, ''),
  )
    .replace(
      /\b(whats\s?app|wpp|zap|tel(efone)?|fone|celular|contato|ligue)\s*[:.]?\s*(?=$|[\s,;|–-]*$)/gi,
      '',
    )
    .replace(/\b(whats\s?app|wpp)\s*:?/gi, '')
    .replace(
      /\b(fale com|falar com|com o corretor|com a corretora|corretora?)\s+[A-ZÀ-Ú][a-zà-ú]+(\s+[A-ZÀ-Ú][a-zà-ú]+)?/g,
      '',
    )
    .replace(/\s*\/\s*(?=\s|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;!])/g, '$1')
    .replace(/[\s,;:–|-]+$/g, '')
    .replace(/^[\s,;:–|-]+/g, '')
    .trim();
  return limpo === '' ? null : limpo.slice(0, 300);
}

const PREFIXO_DE_RUA =
  '(rua|r\\.|avenida|av\\.?|alameda|al\\.|travessa|tv\\.|rodovia|estrada|rota do sol|via costeira)';
const RUA_GENERICA =
  /^(rua|avenida|travessa|alameda|estrada|rodovia)\s+(publica|projetada|sem nome|s\/n|principal|a|b|c)\b/;

/** Rua ou avenida tirada do título, sem número. Do nome do arquivo da foto (Chaves na Mão), se o título não diz. */
export function logradouroDe(o: {
  titulo?: string | null;
  imagem?: string | null;
  cidade?: string | null;
  bairro?: string | null;
  tipoDaFonte?: string | null;
}): string | null {
  const t = String(o.titulo ?? '');
  const m = t.match(new RegExp(`\\b${PREFIXO_DE_RUA}\\s+([^,–|()\\n]+)`, 'i'));
  if (m) {
    const nome = `${m[1] ?? ''} ${m[2] ?? ''}`
      .replace(/\s+-\s+.*$/, '')
      .replace(/\b(n[º°o]\.?|numero|nº)\s*\d+.*$/i, '')
      .replace(/\s*\d+[a-z]?\s*$/i, '')
      .replace(/\s+(em|no|na|bairro)\s+.*$/i, '')
      .trim()
      .replace(
        /\s+(quadra|qd\.?|lote|lt\.?|bloco|casa|apto|apartamento|sala|km|cep|esquina|pr[oó]ximo|perto)\b.*$/i,
        '',
      )
      .trim()
      .replace(/^r\.\s*/i, 'Rua ')
      .replace(/^av\.?\s+/i, 'Avenida ')
      .replace(/^al\.\s*/i, 'Alameda ')
      .replace(/^tv\.\s*/i, 'Travessa ');
    if (
      nome.length >= 6 &&
      nome.length <= 70 &&
      !/\d{3,}/.test(nome) &&
      !RUA_GENERICA.test(semAcento(nome))
    ) {
      return comoNome(nome.toLowerCase());
    }
  }
  if (o.imagem && o.cidade) {
    const arq = (String(o.imagem).split('/').pop() ?? '').replace(/\.(jpe?g|png|webp)$/i, '');
    const inicios = [slug(o.bairro), slug(String(o.bairro ?? '').replace(/\(.*?\)/g, ''))].map(
      (b) => `rn-${slug(o.cidade)}-${b}-`,
    );
    const ini = inicios.find((x) => arq.includes(x)) ?? inicios[0] ?? '';
    const i = arq.indexOf(ini);
    if (ini && i >= 0) {
      let resto = arq.slice(i + ini.length);
      const cortes = [
        slug(o.tipoDaFonte ?? ''),
        'casa',
        'apartamento',
        'terreno',
        'sala',
        'loja',
        'galpao',
        'conj',
        'predio',
        'cobertura',
        'flat',
        'kitnet',
        'chacara',
        'sobrado',
        'ponto',
      ].filter(Boolean);
      let fim = -1;
      for (const c of cortes) {
        const k = resto.indexOf(`-${c}-`);
        if (k > 0 && (fim < 0 || k < fim)) fim = k;
      }
      if (fim > 0) resto = resto.slice(0, fim);
      if (
        resto &&
        !/nao-encontrad/.test(resto) &&
        /^(rua|avenida|av|alameda|travessa|rodovia|estrada|rota)/.test(resto)
      ) {
        const nome = comoNome(resto.split('-').join(' '));
        if (nome.length >= 6 && nome.length <= 70 && !RUA_GENERICA.test(semAcento(nome)))
          return nome;
      }
    }
  }
  return null;
}

export interface Sinais {
  frente_mar?: true;
  vista_mar?: true;
  esquina?: true;
  condominio_fechado?: true;
  lazer?: true;
}

/** Sinais tirados do texto: só entram quando o anúncio DIZ (silêncio não é "não"). */
export function sinaisDe(texto: unknown, tipoDaFonte: unknown): Sinais {
  const t = semAcento(texto);
  const p = semAcento(tipoDaFonte);
  const s: Sinais = {};
  if (
    /frente (para o |pro |ao |pra o )?mar|beira[ -]?mar|pe na areia|frente (para a |pra |a )?praia|frente-mar/.test(
      t,
    )
  )
    s.frente_mar = true;
  if (/vista (para o |pro |ao )?mar|vista mar|vista-mar/.test(t)) s.vista_mar = true;
  if (/\besquina\b/.test(t)) s.esquina = true;
  if (
    /condom/.test(p) ||
    /condominio fechado|cond\. fechado|loteamento fechado/.test(t) ||
    /^loteamento$/.test(p.trim())
  ) {
    s.condominio_fechado = true;
  }
  if (/piscina|area de lazer|lazer completo/.test(t)) s.lazer = true;
  return s;
}

/** Repasse, ágio, cota, fração ou permuta: o anúncio não é o preço do imóvel inteiro. */
export const ehRepasseOuCota = (titulo: unknown): boolean =>
  /repasse|agio|\bcota\b|fracao|multipropriedade|timeshare|permuta/.test(semAcento(titulo));
