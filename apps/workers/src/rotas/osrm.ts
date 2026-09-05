/**
 * O OSRM visto do worker: uma chamada, `/table`.
 *
 * O OSRM roda na máquina dedicada (infra/local/docker-compose.yml, perfil
 * `rotas`), sobre o extrato do Rio Grande do Norte do OpenStreetMap, e NÃO tem
 * porta publicada: quem fala com ele é este worker, pela rede do Compose
 * (`http://osrm:5000`). Em desenvolvimento, pelo override
 * `infra/local/docker-compose.dev.yml`, que prende a porta em 127.0.0.1.
 *
 * `/table` devolve a matriz de tempos e distâncias entre todos os pontos numa
 * requisição só — é isso que faz a rota da tarde caber nos 5 s do RF-ROT-07. O
 * `/route`, que desenharia a linha no mapa, não é chamado: a tela não desenha
 * mapa, ela lista paradas e manda para o Google Maps navegar.
 *
 * Coordenadas vão em `lon,lat` (a ordem do OSRM, ao contrário da do resto do
 * mundo). Trocar as duas põe Natal no meio do Atlântico e o OSRM responde
 * `NoSegment` — daí o cuidado de fazer a conversão em um lugar só, aqui.
 */

export type Ponto = { lat: number; lng: number };

export type MatrizDoOsrm = {
  /** Segundos de i até j, incluindo a origem no índice 0. */
  duracoes: number[][];
  /** Metros de i até j, mesma indexação. */
  distancias: number[][];
};

export class ErroDoOsrm extends Error {
  constructor(
    readonly motivo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroDoOsrm';
  }
}

function paraCoordenadas(pontos: readonly Ponto[]): string {
  return pontos.map((p) => `${p.lng},${p.lat}`).join(';');
}

function matrizNumerica(bruta: unknown, lado: number, campo: string): number[][] {
  if (!Array.isArray(bruta) || bruta.length !== lado) {
    throw new ErroDoOsrm(
      'resposta_incompleta',
      `O OSRM devolveu "${campo}" fora do tamanho pedido.`,
    );
  }
  return bruta.map((linha) => {
    if (!Array.isArray(linha) || linha.length !== lado) {
      throw new ErroDoOsrm(
        'resposta_incompleta',
        `O OSRM devolveu "${campo}" com linha de tamanho errado.`,
      );
    }
    // `null` no lugar do número é o jeito de o OSRM dizer "não há caminho entre
    // estes dois pontos". Vira `NaN` e é `resolverOrdem` quem recusa a matriz.
    return linha.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN));
  });
}

/**
 * A matriz de tempos e distâncias entre `origem` (índice 0) e `paradas`.
 *
 * `timeoutMs` existe porque um OSRM que aceita a conexão e nunca responde
 * seguraria o worker para sempre, e a mensagem voltaria para a fila só quando o
 * `visibility timeout` de 120 s expirasse.
 */
export async function matrizDeTempos(argumentos: {
  baseUrl: string;
  origem: Ponto;
  paradas: readonly Ponto[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<MatrizDoOsrm> {
  const pontos = [argumentos.origem, ...argumentos.paradas];
  const lado = pontos.length;
  const url =
    `${argumentos.baseUrl.replace(/\/+$/, '')}` +
    `/table/v1/driving/${paraCoordenadas(pontos)}?annotations=duration,distance`;

  const buscar = argumentos.fetchImpl ?? fetch;
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), argumentos.timeoutMs ?? 20_000);

  let resposta: Response;
  try {
    resposta = await buscar(url, { signal: controle.signal });
  } catch (erro) {
    throw new ErroDoOsrm(
      'inalcancavel',
      `Não deu para falar com o OSRM em ${argumentos.baseUrl}: ${erro instanceof Error ? erro.message : String(erro)}`,
    );
  } finally {
    clearTimeout(relogio);
  }

  if (!resposta.ok) {
    throw new ErroDoOsrm('http', `O OSRM respondeu HTTP ${resposta.status}.`);
  }

  const corpo = (await resposta.json()) as {
    code?: string;
    message?: string;
    durations?: unknown;
    distances?: unknown;
  };

  if (corpo.code !== 'Ok') {
    throw new ErroDoOsrm(
      'codigo',
      `O OSRM recusou o pedido (${corpo.code ?? 'sem código'}): ${corpo.message ?? ''}`.trim(),
    );
  }

  return {
    duracoes: matrizNumerica(corpo.durations, lado, 'durations'),
    distancias: matrizNumerica(corpo.distances, lado, 'distances'),
  };
}
