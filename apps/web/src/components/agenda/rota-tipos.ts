import type { Temperature } from '@komune/schema';

/**
 * Contrato da rota da tarde (PRD §7.5, RF-ROT-01 a RF-ROT-05).
 *
 * ===========================================================================
 * O QUE A ROTA É, E O QUE ELA NÃO É
 * ===========================================================================
 * É a ordem das visitas do dia por TEMPO DE CARRO, calculada pelo OSRM sobre o
 * grafo de ruas do Rio Grande do Norte, na máquina dedicada. Não é linha reta,
 * não é ordem por bairro e não é palpite: quando o OSRM não responde, não há
 * rota, e a tela diz isso em vez de mostrar uma lista qualquer.
 *
 * ===========================================================================
 * A DISTINÇÃO QUE ESTA TELA NÃO PODE APAGAR: CENTROIDE ≠ PORTA
 * ===========================================================================
 * A base tem bairro e cidade; logradouro, nenhum. A coordenada de "Capim Macio"
 * é o CENTRO do polígono do bairro, com ~2,4 km de raio. Isso ordena visita e
 * agrupa vizinhança muito bem, e não serve para chegar em lugar nenhum.
 *
 * Por isso, aqui:
 *   · cada parada mostra a precisão e o raio, em metros, no cartão;
 *   · o link do mapa busca pelo NOME do parceiro mais o bairro — o que a
 *     Heloísa digitaria —, e NÃO pelas coordenadas do CRM. Mandar o Google Maps
 *     navegar até o centroide de Capim Macio é mandar ela parar o carro no meio
 *     do bairro e descobrir sozinha que o buffet está a 1 km dali;
 *   · a origem do trajeto no Maps é a posição ATUAL do aparelho (o parâmetro
 *     `origin` fica de fora do link de propósito), porque o CRM não sabe de onde
 *     ela está saindo.
 */

export type PrecisaoGeo = 'logradouro' | 'bairro' | 'cidade' | 'incerta';

export type StatusDaRota = 'enfileirada' | 'pronta' | 'falhou';

/** Um alvo do dia: uma visita, elegível ou não, com o motivo quando não é. */
export type AlvoDaRota = {
  task_id: string;
  organization_id: string;
  organizacao: string;
  bairro: string | null;
  cidade: string | null;
  endereco: string | null;
  titulo: string;
  due_at: string;
  lat: number | null;
  lng: number | null;
  precisao: PrecisaoGeo | null;
  raio_m: number | null;
  temperatura: Temperature;
  categoria: string | null;
  deal_id: string | null;
  etapa: string | null;
  elegivel: boolean;
  motivo: MotivoDeExclusao | null;
};

export type MotivoDeExclusao =
  'apagada' | 'suprimido' | 'sem_coordenada' | 'so_cidade' | 'precisao_incerta';

export type ParadaDaRota = {
  posicao: number;
  task_id: string;
  organization_id: string;
  organizacao: string;
  bairro: string | null;
  cidade: string | null;
  endereco: string | null;
  titulo: string;
  quando: string;
  lat: number;
  lng: number;
  precisao: PrecisaoGeo;
  raio_m: number | null;
  segundos_do_anterior: number;
  metros_do_anterior: number;
  temperatura: Temperature;
  etapa: string | null;
  concluida: boolean;
  /** Reconferência na leitura: `false` quando a ficha saiu depois do cálculo. */
  ainda_vale: boolean;
};

export type PlanoDaRota = {
  id: string;
  status: StatusDaRota;
  tentativa: number;
  origem: { rotulo: string; lat: number; lng: number };
  total_segundos: number | null;
  total_metros: number | null;
  motivo_da_falha: string | null;
  calculado_em: string | null;
  pedido_em: string;
};

export type RotaDoDia = {
  dia: string;
  assignee_id: string;
  config: {
    origem?: { rotulo?: string; lat?: number; lng?: number; confirmada?: boolean };
    max_paradas?: number;
    min_paradas?: number;
    teto_paradas?: number;
    janela?: { inicio?: string; fim?: string };
  } | null;
  plano: PlanoDaRota | null;
  paradas: ParadaDaRota[];
  alvos: AlvoDaRota[];
  motor: { nome: string; ultimo_pulso: string | null; de_pe: boolean };
  atribuicao: string;
};

// ---------------------------------------------------------------------------
// Frases
// ---------------------------------------------------------------------------

/** O que cada motivo de exclusão quer dizer para quem está com o celular na mão. */
export const FRASE_DO_MOTIVO: Record<MotivoDeExclusao, string> = {
  suprimido: 'Pediu para não ser contatado. Fora da rota, em qualquer modo.',
  apagada: 'A ficha foi apagada depois que a visita entrou na agenda.',
  sem_coordenada: 'Sem bairro na ficha: não dá para situar no mapa.',
  so_cidade: 'Só temos o município. O centro de Natal não é o endereço de ninguém.',
  precisao_incerta:
    'O OpenStreetMap devolveu um ponto de outro tipo para este bairro (uma praia, uma estação). Não dá para confiar nele.',
};

export const FRASE_DA_PRECISAO: Record<PrecisaoGeo, string> = {
  logradouro: 'rua e número',
  bairro: 'centro do bairro',
  cidade: 'centro do município',
  incerta: 'ponto de tipo desconhecido',
};

/** "12 min", "1 h 05". Tempo de carro, sempre arredondado para cima no minuto. */
export function duracaoCurta(segundos: number): string {
  const minutos = Math.max(0, Math.round(segundos / 60));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `${horas} h ${String(minutos % 60).padStart(2, '0')}`;
}

/** "2,2 km" / "740 m". */
export function distanciaCurta(metros: number): string {
  if (metros < 1000) return `${Math.round(metros / 10) * 10} m`;
  return `${(Math.round(metros / 100) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1 })} km`;
}

/** O rótulo de precisão de uma parada: "centro do bairro · ~2,4 km de raio". */
export function rotuloDaPrecisao(precisao: PrecisaoGeo, raioM: number | null): string {
  const raio = raioM === null ? null : `~${distanciaCurta(raioM)} de raio`;
  return [FRASE_DA_PRECISAO[precisao], raio].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------
// Os links do mapa
// ---------------------------------------------------------------------------

/**
 * O texto de busca de uma parada.
 *
 * Nome do parceiro + bairro + cidade, exatamente como a Agenda já faz. NÃO usa
 * `lat,lng`: a coordenada do CRM é centroide de bairro, e navegar até um
 * centroide é chegar no lugar errado com a certeza de estar no certo.
 */
export function buscaDaParada(p: {
  organizacao: string;
  bairro: string | null;
  cidade: string | null;
  endereco: string | null;
}): string {
  const local = [p.bairro, p.cidade ?? 'Natal', 'RN'].filter(Boolean).join(', ');
  return p.endereco?.trim() ? `${p.endereco}, ${local}` : `${p.organizacao}, ${local}`;
}

export function linkDaParada(p: Parameters<typeof buscaDaParada>[0]): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(buscaDaParada(p))}`;
}

/** Quantos pontos intermediários cabem no link do Maps (RF-ROT-05). */
export const TETO_DE_WAYPOINTS = 3;

/**
 * O trajeto inteiro num link só (RF-ROT-05).
 *
 * `origin` fica de fora de propósito: sem ele o Google Maps parte da posição
 * ATUAL do aparelho, que é o único ponto de partida que o CRM não precisa
 * adivinhar. O último parceiro é o destino; os do meio viram `waypoints`, até o
 * teto de três — acima disso o link fica grande demais para alguns aparelhos
 * abrirem, e a tela avisa que as últimas paradas ficaram de fora do trajeto
 * único (cada uma continua tendo o link individual).
 */
export function linkDoTrajeto(
  paradas: readonly Parameters<typeof buscaDaParada>[0][],
): { url: string; incluidas: number } | null {
  if (paradas.length === 0) return null;

  const usadas = paradas.slice(0, TETO_DE_WAYPOINTS + 1);
  const destino = usadas[usadas.length - 1];
  if (!destino) return null;

  const meio = usadas.slice(0, -1).map((p) => buscaDaParada(p));
  const partes = [
    'https://www.google.com/maps/dir/?api=1',
    `destination=${encodeURIComponent(buscaDaParada(destino))}`,
    'travelmode=driving',
  ];
  if (meio.length > 0) {
    partes.splice(2, 0, `waypoints=${meio.map(encodeURIComponent).join('|')}`);
  }
  return { url: partes.join('&'), incluidas: usadas.length };
}

/** Waze abre uma parada só, e por busca — mesma razão do link do Maps. */
export function linkDoWaze(p: Parameters<typeof buscaDaParada>[0]): string {
  return `https://waze.com/ul?q=${encodeURIComponent(buscaDaParada(p))}&navigate=yes`;
}

// ---------------------------------------------------------------------------
// Contas da rota
// ---------------------------------------------------------------------------

/** Tempo de carro acumulado até cada parada, em segundos. */
export function acumuladoDeCarro(paradas: readonly ParadaDaRota[]): number[] {
  let soma = 0;
  return paradas.map((p) => {
    soma += p.segundos_do_anterior;
    return soma;
  });
}

/**
 * As paradas que dividem o MESMO ponto no mapa.
 *
 * Acontece o tempo todo com centroide de bairro: dois parceiros do mesmo bairro
 * são um ponto só para o OSRM, e o trecho entre eles volta como 0 s. Sem dizer
 * isso, a tela promete "0 min até a próxima" e a Heloísa ainda tem 1 km pela
 * frente. A comparação é por coordenada exata porque é exatamente assim que o
 * centroide é atribuído: as duas fichas herdam a MESMA linha de `geo_places`.
 */
export function paradasNoMesmoPonto(paradas: readonly ParadaDaRota[]): Set<string> {
  const porPonto = new Map<string, string[]>();
  for (const p of paradas) {
    const chave = `${p.lat},${p.lng}`;
    porPonto.set(chave, [...(porPonto.get(chave) ?? []), p.task_id]);
  }
  const repetidas = new Set<string>();
  for (const ids of porPonto.values()) {
    if (ids.length > 1) for (const id of ids) repetidas.add(id);
  }
  return repetidas;
}

/** Os alvos que ficaram de fora, agrupados pelo motivo, na ordem da gravidade. */
export const ORDEM_DOS_MOTIVOS: MotivoDeExclusao[] = [
  'suprimido',
  'apagada',
  'precisao_incerta',
  'so_cidade',
  'sem_coordenada',
];

export function agruparExclusoes(
  alvos: readonly AlvoDaRota[],
): { motivo: MotivoDeExclusao; itens: AlvoDaRota[] }[] {
  const fora = alvos.filter((a) => !a.elegivel && a.motivo !== null);
  return ORDEM_DOS_MOTIVOS.flatMap((motivo) => {
    const itens = fora.filter((a) => a.motivo === motivo);
    return itens.length > 0 ? [{ motivo, itens }] : [];
  });
}
