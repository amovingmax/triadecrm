/**
 * As regras do aviso de espera em degraus (11/11/2026), sem React e sem banco,
 * para serem testadas à parte. Quem usa é `vigia-de-espera.tsx`.
 *
 * Pedido do usuário: "Alerta em degraus: 15 min sem resposta avisa quem atende;
 * 1 h avisa a gestão." Quem decide QUEM é avisado e QUANDO é o banco
 * (`public.esperas_para_avisar`, migração 20261111200000): a mesma regra do aviso
 * no celular, para os dois concordarem. Aqui fica só o que é da tela: o que já foi
 * anunciado neste navegador, o texto do cartão e da notificação do sistema.
 */

/** `espera` = o degrau de quem atende (15 min); `espera_gestao` = o da gestão (1 h). */
export type DegrauDaEspera = 'espera' | 'espera_gestao';

export interface EsperaParaAvisar {
  readonly conversaId: string;
  /** `null` é a conversa de quem ainda não tem ficha. */
  readonly organizacaoId: string | null;
  /** O nome da ficha, ou o do perfil do WhatsApp (`app.nome_da_conversa`). */
  readonly nome: string;
  /** Quando a espera começou: a primeira mensagem do cliente sem resposta (ISO). */
  readonly desde: string;
  readonly degrau: DegrauDaEspera;
  /** Minutos de expediente desde o começo da espera. */
  readonly minutos: number;
  /** No degrau da gestão: o primeiro nome de quem atende, ou `null` (sem responsável). */
  readonly responsavel: string | null;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

/** Uma linha do banco, conferida. A linha que não faz sentido é deixada de lado. */
export function lerEspera(linha: unknown): EsperaParaAvisar | null {
  if (typeof linha !== 'object' || linha === null) return null;
  const l = linha as Record<string, unknown>;
  const conversaId = texto(l.conversa_id);
  const desde = texto(l.desde);
  const degrau = l.degrau;
  const minutos = typeof l.minutos === 'number' ? l.minutos : Number(l.minutos);
  if (!conversaId || !desde || Number.isNaN(Date.parse(desde))) return null;
  if (degrau !== 'espera' && degrau !== 'espera_gestao') return null;
  if (!Number.isFinite(minutos)) return null;
  return {
    conversaId,
    organizacaoId: texto(l.organizacao_id),
    nome: texto(l.nome)?.trim() ?? 'Um contato',
    desde,
    degrau,
    minutos,
    responsavel: texto(l.responsavel)?.trim() ?? null,
  };
}

/**
 * Uma espera, um degrau: a mesma conversa, quando o cliente volta a esperar depois
 * de uma resposta, é outra espera (o começo muda). É a chave do aviso no celular,
 * com o começo em milissegundos.
 */
export function chaveDaEspera(
  e: Pick<EsperaParaAvisar, 'conversaId' | 'degrau' | 'desde'>,
): string {
  return `${e.conversaId}:${e.degrau}:${Date.parse(e.desde)}`;
}

/** "15 min", "1 h", "1 h 30 min". */
export function duracaoDaEspera(minutos: number): string {
  const m = Math.max(0, Math.floor(minutos));
  if (m < 60) return `${m} min`;
  const horas = Math.floor(m / 60);
  const resto = m % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/** "Maria Souza espera resposta há 15 min"; na gestão, "… há 1 h · com João". */
export function linhaDaEspera(e: EsperaParaAvisar): string {
  const base = `${e.nome} espera resposta há ${duracaoDaEspera(e.minutos)}`;
  if (e.degrau !== 'espera_gestao') return base;
  return `${base} · ${e.responsavel ? `com ${e.responsavel}` : 'sem responsável'}`;
}

/** O título do cartão: o primeiro degrau chama quem atende; o segundo, a gestão. */
export function tituloDaEspera(e: Pick<EsperaParaAvisar, 'degrau'>): string {
  return e.degrau === 'espera_gestao' ? 'Cliente ainda sem resposta' : 'Cliente esperando resposta';
}

/** O botão do cartão: quem atende responde; a gestão vai ver. */
export function botaoDaEspera(e: Pick<EsperaParaAvisar, 'degrau'>): string {
  return e.degrau === 'espera_gestao' ? 'Ver conversa' : 'Responder';
}

/**
 * O título e o corpo da notificação do sistema. O título leva a empresa, como o
 * aviso de mensagem ("Imova · Nova mensagem"), para quem tem as duas abertas.
 */
export function textoDoAvisoDeEspera(
  esperas: readonly EsperaParaAvisar[],
  empresa: string,
): { titulo: string; corpo: string } {
  const primeira = esperas[0];
  if (esperas.length === 1 && primeira) {
    return { titulo: `${empresa} · ${tituloDaEspera(primeira)}`, corpo: linhaDaEspera(primeira) };
  }
  const nomes = esperas.slice(0, 3).map((e) => e.nome);
  const resto = esperas.length - nomes.length;
  return {
    titulo: `${empresa} · ${esperas.length} clientes esperando resposta`,
    corpo: resto > 0 ? `${nomes.join(', ')} e mais ${resto}` : juntarComE(nomes),
  };
}

function juntarComE(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes.join('');
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/**
 * A marca da notificação do sistema: duas abas que chegam ao mesmo aviso chegam à
 * mesma marca, e o navegador troca um pelo outro em vez de empilhar. É também a
 * marca do toque (`outraAbaJaTocou`).
 */
export function marcaDaEspera(esperas: readonly EsperaParaAvisar[]): string {
  return `triade-espera-${esperas.map(chaveDaEspera).join(',')}`;
}

/**
 * O que já foi anunciado neste navegador: a chave de cada espera e quando ela foi
 * vista pela primeira vez (ms). Fica no aparelho, por pessoa.
 */
export type Anunciadas = Readonly<Record<string, number>>;

/**
 * As esperas a anunciar agora: as que ainda não foram anunciadas, uma por
 * conversa. Quando os dois degraus da mesma conversa chegam juntos (o CRM estava
 * fechado na hora do primeiro), fica só o da gestão, que já diz tudo.
 */
export function esperasNovas(
  lidas: readonly EsperaParaAvisar[],
  anunciadas: Anunciadas,
): EsperaParaAvisar[] {
  const porConversa = new Map<string, EsperaParaAvisar>();
  for (const e of lidas) {
    if (chaveDaEspera(e) in anunciadas) continue;
    const ja = porConversa.get(e.conversaId);
    if (!ja || (ja.degrau === 'espera' && e.degrau === 'espera_gestao')) {
      porConversa.set(e.conversaId, e);
    }
  }
  return [...porConversa.values()].sort((a, b) => Date.parse(a.desde) - Date.parse(b.desde));
}

/**
 * Quanto tempo uma chave que saiu da leitura ainda fica guardada. Uma aba que leu
 * um pouco antes da outra não pode apagar o que a outra acabou de anunciar e, na
 * volta seguinte, anunciar de novo.
 */
export const FOLGA_DA_ANUNCIADA_MS = 10 * 60_000;
/** O teto do que fica guardado: a lista só cresce com esperas abertas. */
export const TETO_DE_ANUNCIADAS = 500;

/**
 * O registro depois de uma leitura que deu certo: tudo o que foi lido fica
 * anunciado (inclusive na primeira leitura, que não anuncia nada); o que saiu da
 * leitura — a espera respondida, concluída, silenciada — é esquecido depois da
 * folga. Se a mesma espera voltar depois de esquecida (o silêncio acabou e o
 * cliente segue esperando), ela é anunciada de novo.
 */
export function anunciadasDepois(
  anunciadas: Anunciadas,
  lidas: readonly EsperaParaAvisar[],
  agoraMs: number,
): Record<string, number> {
  const proximas: Record<string, number> = {};
  for (const [chave, em] of Object.entries(anunciadas)) {
    if (agoraMs - em < FOLGA_DA_ANUNCIADA_MS) proximas[chave] = em;
  }
  for (const e of lidas) {
    const chave = chaveDaEspera(e);
    proximas[chave] = anunciadas[chave] ?? agoraMs;
  }
  const chaves = Object.keys(proximas);
  if (chaves.length <= TETO_DE_ANUNCIADAS) return proximas;
  const maisNovas = chaves
    .sort((a, b) => (proximas[b] ?? 0) - (proximas[a] ?? 0))
    .slice(0, TETO_DE_ANUNCIADAS);
  return Object.fromEntries(maisNovas.map((c) => [c, proximas[c] ?? agoraMs]));
}

/**
 * O registro lido do aparelho, conferido. `null` = nunca anunciou nada aqui (ou o
 * que estava guardado não se lê): a próxima leitura vira a linha de base, sem
 * anunciar o que já esperava.
 */
export function lerAnunciadas(guardado: string | null): Anunciadas | null {
  if (guardado === null) return null;
  try {
    const valor: unknown = JSON.parse(guardado);
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return null;
    const limpas: Record<string, number> = {};
    for (const [chave, em] of Object.entries(valor as Record<string, unknown>)) {
      if (typeof em === 'number' && Number.isFinite(em)) limpas[chave] = em;
    }
    return limpas;
  } catch {
    return null;
  }
}
