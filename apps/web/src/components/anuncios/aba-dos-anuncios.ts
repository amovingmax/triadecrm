/**
 * A aba Anúncios sem repetição (18/11/2026), só na Imova: as regras, sem React e
 * sem banco, para o Vitest. Quem desenha é `tela-anuncios.tsx`.
 *
 * O pedido do usuário: "tem muita informação repetida entrando no CRM ... o
 * imóvel do terreno, o TE0001, já existe aqui dentro do CRM, não tem para que
 * ficar aparecendo novamente"; e a aba "cada vez menos repetitiva, mais objetiva,
 * mais clara e mais funcional". Aprovado pelo protótipo
 * (https://claude.ai/artifact/JxhgD1FcBnfqm3Svt6VQ8t) no mesmo dia.
 *
 * UM IMÓVEL, UM CARTÃO. O que o Canal Pro diz de um anúncio se junta ao cartão
 * dele: a linha de mesmo código (ou ligada pelo "trazer") é a PRÓPRIA; a linha de
 * outro código que é o mesmo imóvel (`canal_pro_parece_com`: mesma cidade, mesma
 * área, mesmo bairro) é uma CÓPIA ANTIGA e fica dentro do cartão, sem aparecer
 * como outro imóvel. Em 18/11 eram 6 cópias, como "Terreno Capim Macio" do
 * TE0001_IMOVA, que a gestão tinha excluído à mão e voltavam a cada relatório.
 *
 * UMA SITUAÇÃO POR CARTÃO (`estadoDoCartao`), no lugar de "Publicado · No portal
 * pelo sistema atual · No Canal Pro: Ativo · no CRM: rascunho".
 *
 * "PRECISA DE VOCÊ" (`itensDeAtencao`): uma linha por pendência, cada uma com uma
 * ação, no lugar dos avisos espalhados pelo caminho, pelo resumo e pelos cartões.
 */
import { chave } from '@/components/importacao/mapeamento';

import { foraDoArquivo, oQueFalta, situacaoForaDoCrm } from './regras-do-cartao';
import { ativoNoCanalPro } from './relatorio-canal-pro';
import type { AnuncioNaLista } from './tipos';

// ---------------------------------------------------------------------------
// O que o Canal Pro diz, linha por linha
// ---------------------------------------------------------------------------

/** Uma linha da última lista do Canal Pro (relatório ou sincronização). */
export type LinhaDoCanalPro = {
  id: string;
  codigo: string;
  titulo: string | null;
  situacao: string | null;
  /** O anúncio do CRM que veio desta linha (o "trazer para o CRM"). */
  anuncio_id: string | null;
  /** O anúncio do CRM que é o mesmo imóvel, com outro código (`canal_pro_parece_com`). */
  parece_com: string | null;
  /** Marcada como excluída no Canal Pro pela gestão. */
  excluido_em: string | null;
  /** Estava marcada e voltou num relatório seguinte: a exclusão não pegou. */
  marcado_excluido_em: string | null;
  visto_em: string | null;
  preco_venda: number | null;
  preco_aluguel: number | null;
  fotos: number | null;
  visualizacoes: number | null;
  contatos: number | null;
};

/** O valor de uma coluna da linha guardada, pelo nome sem acento nem caixa. */
export function campoDaLinha(linha: unknown, nomes: readonly string[]): string | null {
  if (!linha || typeof linha !== 'object') return null;
  const alvo = new Set(nomes.map(chave));
  for (const [k, v] of Object.entries(linha as Record<string, unknown>)) {
    if (alvo.has(chave(k)) && v !== null && v !== undefined && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return null;
}

export function inteiroDaLinha(linha: unknown, nomes: readonly string[]): number | null {
  const v = campoDaLinha(linha, nomes);
  if (v === null) return null;
  const n = Number(v.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export type DoCanalPro = {
  /** A linha de mesmo código (ou a que deu origem ao anúncio). */
  propria: LinhaDoCanalPro | null;
  /** Outros códigos do mesmo imóvel. */
  copias: LinhaDoCanalPro[];
};

/**
 * Junta cada linha do Canal Pro ao cartão do anúncio dela. As que não têm cartão
 * nem são cópia ficam soltas (só as não excluídas: a excluída não pede nada).
 */
export function juntarDoCanalPro(
  anuncios: readonly Pick<AnuncioNaLista, 'id' | 'codigo'>[],
  linhas: readonly LinhaDoCanalPro[],
): { porAnuncio: Map<string, DoCanalPro>; soltas: LinhaDoCanalPro[] } {
  const porCodigo = new Map(anuncios.map((a) => [a.codigo, a.id]));
  const ids = new Set(anuncios.map((a) => a.id));
  const porAnuncio = new Map<string, DoCanalPro>();
  const pegar = (id: string) => {
    let d = porAnuncio.get(id);
    if (!d) {
      d = { propria: null, copias: [] };
      porAnuncio.set(id, d);
    }
    return d;
  };
  const soltas: LinhaDoCanalPro[] = [];
  for (const l of linhas) {
    const dono =
      porCodigo.get(l.codigo) ?? (l.anuncio_id && ids.has(l.anuncio_id) ? l.anuncio_id : null);
    if (dono) {
      const d = pegar(dono);
      // Duas linhas para o mesmo anúncio: a de mesmo código vale; a outra é cópia.
      if (!d.propria || porCodigo.get(l.codigo) === dono) {
        if (d.propria) d.copias.push(d.propria);
        d.propria = l;
      } else d.copias.push(l);
      continue;
    }
    if (l.parece_com && ids.has(l.parece_com)) {
      pegar(l.parece_com).copias.push(l);
      continue;
    }
    if (!l.excluido_em) soltas.push(l);
  }
  return { porAnuncio, soltas };
}

/** A cópia ainda está no ar no Canal Pro (e ocupa uma vaga lá). */
export function copiaAtiva(l: Pick<LinhaDoCanalPro, 'situacao' | 'excluido_em'>): boolean {
  return !l.excluido_em && ativoNoCanalPro(l.situacao);
}

/** Quantas fotos o Canal Pro tem a mais que o CRM (0 quando não sabe). */
export function fotosQueFaltam(
  a: Pick<AnuncioNaLista, 'fotos'>,
  d: DoCanalPro | undefined,
): number {
  const la = d?.propria?.fotos ?? null;
  return la === null ? 0 : Math.max(0, la - a.fotos);
}

// ---------------------------------------------------------------------------
// A situação do cartão
// ---------------------------------------------------------------------------

export type TomDoEstado = 'arbo' | 'espera' | 'crm' | 'fora' | 'rascunho' | 'alerta' | 'excluido';
export type EstadoDoCartao = { rotulo: string; tom: TomDoEstado; dica: string };

type ParaOEstado = Pick<
  AnuncioNaLista,
  | 'situacao'
  | 'excluido_em'
  | 'pendencias'
  | 'publicado_em'
  | 'ultima_leitura_do_portal'
  | 'no_canal_pro_situacao'
  | 'no_canal_pro_visto_em'
  | 'no_sistema_atual'
  | 'sistema_atual_em'
>;

/** Uma etiqueta só, com as palavras do Canal Pro e quem publica. */
export function estadoDoCartao(a: ParaOEstado): EstadoDoCartao {
  if (a.excluido_em) {
    return {
      rotulo: 'Excluído',
      tom: 'excluido',
      dica: 'Fora da lista e do arquivo do Canal Pro. Volta, fora do ar, pelo Restaurar.',
    };
  }
  if (foraDoArquivo(a)) {
    return {
      rotulo: 'No ar com pendência',
      tom: 'alerta',
      dica: 'O arquivo do Canal Pro pula este anúncio até a pendência ser resolvida.',
    };
  }
  if (a.situacao === 'no_ar') {
    const leitura = a.ultima_leitura_do_portal ? Date.parse(a.ultima_leitura_do_portal) : null;
    const publicado = a.publicado_em ? Date.parse(a.publicado_em) : null;
    if (leitura === null) {
      return {
        rotulo: 'No ar no CRM · aguarda a troca',
        tom: 'espera',
        dica: 'O Canal Pro ainda lê o arquivo do sistema atual. Vai ao portal pelo CRM depois da troca da URL.',
      };
    }
    if (publicado !== null && publicado > leitura) {
      return {
        rotulo: 'Publicado · entra na próxima leitura',
        tom: 'espera',
        dica: 'O Grupo OLX lê o arquivo do CRM a cada 12 horas.',
      };
    }
    return {
      rotulo: 'Publicado pelo CRM',
      tom: 'crm',
      dica: 'No ZAP, Viva Real e OLX pelo arquivo do CRM.',
    };
  }
  if (a.situacao === 'pausado') {
    return { rotulo: 'Fora do ar', tom: 'fora', dica: 'Tirado do ar pelo CRM.' };
  }
  const fora = situacaoForaDoCrm(a);
  if (fora === 'ativo') {
    return a.no_sistema_atual === true
      ? {
          rotulo: 'Publicado pela Arbo',
          tom: 'arbo',
          dica: 'No portal pelo sistema atual (a Arbo). Passa a ser do CRM na troca.',
        }
      : {
          rotulo: 'Publicado no Canal Pro',
          tom: 'arbo',
          dica: 'Ativo no Canal Pro, por fora do CRM.',
        };
  }
  if (fora === 'inativo') {
    return {
      rotulo: 'Não publicado',
      tom: 'fora',
      dica: 'Inativo no Canal Pro: não aparece nos portais. Publicar ocupa uma vaga do plano.',
    };
  }
  const faltam = a.pendencias?.length ?? 0;
  return faltam > 0
    ? {
        rotulo: `Rascunho · falta ${faltam}`,
        tom: 'rascunho',
        dica: `Para ir ao ar falta ${oQueFalta(a.pendencias ?? [])}.`,
      }
    : { rotulo: 'Rascunho · pronto', tom: 'rascunho', dica: 'Pronto para pôr no ar.' };
}

// ---------------------------------------------------------------------------
// Precisa de você
// ---------------------------------------------------------------------------

export type AcaoDeAtencao =
  | { tipo: 'sincronizar' }
  | { tipo: 'abrir'; anuncioId: string }
  | { tipo: 'editar'; anuncioId: string }
  | { tipo: 'filtrar'; filtro: 'nao_publicados_prontos' };

export type ItemDeAtencao = {
  id: string;
  tom: 'alerta' | 'info';
  icone: 'fotos' | 'editar' | 'copia' | 'publicar' | 'canal_pro';
  titulo: string;
  texto: string;
  rotulo: string;
  acao: AcaoDeAtencao;
};

const ehDeFoto = (p: string) => /foto/i.test(p);

/** O anúncio é "não publicado" (inativo no Canal Pro) e está pronto para ir ao ar. */
export function naoPublicadoPronto(a: ParaOEstado & Pick<AnuncioNaLista, 'pendencias'>): boolean {
  return (
    !a.excluido_em &&
    a.situacao === 'rascunho' &&
    situacaoForaDoCrm(a) === 'inativo' &&
    (a.pendencias?.length ?? 0) === 0
  );
}

function juntarNomes(l: readonly string[]): string {
  if (l.length <= 1) return l.join('');
  return `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}`;
}

/**
 * O que pede a gestão, uma linha por assunto. Quem não publica (SDR) não vê:
 * todas as ações são de gestão.
 */
export function itensDeAtencao(e: {
  anuncios: readonly AnuncioNaLista[];
  porAnuncio: Map<string, DoCanalPro>;
  soltas: readonly LinhaDoCanalPro[];
  vagasLivres: number | null;
}): ItemDeAtencao[] {
  const itens: ItemDeAtencao[] = [];
  const vivos = e.anuncios.filter((a) => !a.excluido_em);

  const semFotos = vivos
    .map((a) => ({ a, faltam: fotosQueFaltam(a, e.porAnuncio.get(a.id)) }))
    .filter((x) => x.faltam > 0);
  if (semFotos.length) {
    const total = semFotos.reduce((s, x) => s + x.faltam, 0);
    const zero = semFotos.filter((x) => x.a.fotos === 0).map((x) => x.a.codigo);
    const parte = semFotos
      .filter((x) => x.a.fotos > 0)
      .map((x) => `${x.a.codigo} com ${x.a.fotos} de ${x.a.fotos + x.faltam}`);
    const frases = [
      zero.length ? `${juntarNomes(zero)} sem nenhuma` : null,
      parte.length ? juntarNomes(parte) : null,
    ].filter(Boolean);
    itens.push({
      id: 'fotos',
      tom: 'alerta',
      icone: 'fotos',
      titulo: `${semFotos.length === 1 ? '1 anúncio' : `${semFotos.length} anúncios`} com fotos faltando · ${total} ${total === 1 ? 'está' : 'estão'} no Canal Pro`,
      texto: `${frases.join('; ')}.`,
      rotulo: 'Trazer do Canal Pro',
      acao: { tipo: 'sincronizar' },
    });
  }

  for (const a of vivos) {
    if (!foraDoArquivo(a)) continue;
    itens.push({
      id: `fora-${a.id}`,
      tom: 'alerta',
      icone: 'editar',
      titulo: `${a.codigo} · no ar, mas fora do arquivo`,
      texto: `Falta ${oQueFalta(a.pendencias ?? [])}. Sem isso, o portal o tira do ar na próxima leitura.`,
      rotulo: 'Corrigir',
      acao: { tipo: 'editar', anuncioId: a.id },
    });
  }

  for (const a of vivos) {
    if (a.situacao !== 'rascunho' || situacaoForaDoCrm(a) === 'ativo') continue;
    const pend = a.pendencias ?? [];
    if (pend.length === 0) continue;
    // Falta só foto e o Canal Pro tem: já está no item das fotos.
    const faltaFotoQueVem = fotosQueFaltam(a, e.porAnuncio.get(a.id)) > 0;
    const resto = faltaFotoQueVem ? pend.filter((p) => !ehDeFoto(p)) : pend;
    if (resto.length === 0) continue;
    itens.push({
      id: `rascunho-${a.id}`,
      tom: 'alerta',
      icone: 'editar',
      titulo: `${a.codigo} · falta ${oQueFalta(resto)}`,
      texto: 'Rascunho: completando, fica pronto para pôr no ar.',
      rotulo: 'Completar',
      acao: { tipo: 'editar', anuncioId: a.id },
    });
  }

  const ativas: { copia: LinhaDoCanalPro; anuncio: AnuncioNaLista }[] = [];
  for (const a of vivos) {
    for (const c of e.porAnuncio.get(a.id)?.copias ?? []) {
      if (copiaAtiva(c)) ativas.push({ copia: c, anuncio: a });
    }
  }
  if (ativas.length) {
    itens.push({
      id: 'copias',
      tom: 'alerta',
      icone: 'copia',
      titulo:
        ativas.length === 1
          ? '1 cópia antiga ainda ativa no Canal Pro'
          : `${ativas.length} cópias antigas ainda ativas no Canal Pro`,
      texto: `${ativas.map((x) => `${x.copia.codigo} (= ${x.anuncio.codigo})`).join(', ')}. Cada uma ocupa uma vaga do plano lá: exclua no Canal Pro.`,
      rotulo: 'Ver',
      acao: { tipo: 'abrir', anuncioId: ativas[0]!.anuncio.id },
    });
  }

  if (e.soltas.length) {
    itens.push({
      id: 'soltas',
      tom: 'info',
      icone: 'canal_pro',
      titulo:
        e.soltas.length === 1
          ? '1 anúncio do Canal Pro ainda sem cartão no CRM'
          : `${e.soltas.length} anúncios do Canal Pro ainda sem cartão no CRM`,
      texto: `${juntarNomes(e.soltas.slice(0, 4).map((l) => l.codigo))}${e.soltas.length > 4 ? ` e mais ${e.soltas.length - 4}` : ''}. A sincronização os traz, com as fotos.`,
      rotulo: 'Sincronizar',
      acao: { tipo: 'sincronizar' },
    });
  }

  const prontos = vivos.filter(naoPublicadoPronto);
  if (prontos.length && (e.vagasLivres === null || e.vagasLivres > 0)) {
    const porVisitas = [...prontos].sort(
      (x, y) => (y.no_canal_pro_visualizacoes ?? 0) - (x.no_canal_pro_visualizacoes ?? 0),
    );
    const vagas =
      e.vagasLivres === null
        ? ''
        : ` · ${e.vagasLivres === 1 ? '1 vaga livre' : `${e.vagasLivres} vagas livres`}`;
    itens.push({
      id: 'prontos',
      tom: 'info',
      icone: 'publicar',
      titulo: `${prontos.length === 1 ? '1 não publicado já pode' : `${prontos.length} não publicados já podem`} ir ao ar${vagas}`,
      texto: `Por visualizações no Canal Pro: ${porVisitas
        .slice(0, 4)
        .map(
          (a) =>
            `${a.codigo}${a.no_canal_pro_visualizacoes !== null ? ` (${a.no_canal_pro_visualizacoes.toLocaleString('pt-BR')})` : ''}`,
        )
        .join(', ')}.`,
      rotulo: 'Escolher',
      acao: { tipo: 'filtrar', filtro: 'nao_publicados_prontos' },
    });
  }
  return itens;
}

// ---------------------------------------------------------------------------
// Novo anúncio: o imóvel já está no CRM?
// ---------------------------------------------------------------------------

const COMERCIAIS = new Set(['loja', 'sala_comercial', 'imovel_comercial', 'consultorio']);
const TERRENOS = new Set(['terreno', 'terreno_comercial']);
const grupoDoTipo = (t: string) =>
  COMERCIAIS.has(t) ? 'comercial' : TERRENOS.has(t) ? 'terreno' : t;

/** Até quanto a área pode diferir para ainda ser o mesmo imóvel (5%). */
const FOLGA_DA_AREA = 0.05;

/**
 * Os anúncios do CRM que parecem o imóvel que alguém vai cadastrar: mesmo tipo
 * (loja e sala contam juntas; terreno e terreno comercial também), mesma cidade,
 * área a até 5% e, quando os dois dizem, o mesmo bairro. Os excluídos entram:
 * restaurar é melhor que cadastrar de novo.
 */
export function parecidosNoCrm(
  d: { tipo: string; cidade: string; bairro: string; area: number | null },
  anuncios: readonly Pick<
    AnuncioNaLista,
    'id' | 'tipo' | 'cidade' | 'bairro' | 'area_util' | 'area_total'
  >[],
): string[] {
  if (!d.tipo || !chave(d.cidade) || !d.area || d.area <= 0) return [];
  const area = d.area;
  const perto = (x: number | null) => x !== null && Math.abs(x - area) / area <= FOLGA_DA_AREA;
  return anuncios
    .filter(
      (a) =>
        grupoDoTipo(a.tipo) === grupoDoTipo(d.tipo) &&
        chave(a.cidade ?? '') === chave(d.cidade) &&
        (perto(a.area_total) || perto(a.area_util)) &&
        (!chave(d.bairro) || !chave(a.bairro ?? '') || chave(a.bairro ?? '') === chave(d.bairro)),
    )
    .map((a) => a.id);
}

// ---------------------------------------------------------------------------
// A busca da lista
// ---------------------------------------------------------------------------

/** Código, título, bairro, cidade e os códigos das cópias antigas. */
export function casaComABusca(
  a: Pick<AnuncioNaLista, 'codigo' | 'titulo' | 'bairro' | 'cidade'>,
  copias: readonly Pick<LinhaDoCanalPro, 'codigo'>[],
  busca: string,
): boolean {
  const q = chave(busca);
  if (!q) return true;
  return chave(
    [a.codigo, a.titulo, a.bairro, a.cidade, ...copias.map((c) => c.codigo)].join(' '),
  ).includes(q);
}
