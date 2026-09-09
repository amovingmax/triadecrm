import 'server-only';

/**
 * Busca de telefone no Google Places (API New).
 *
 * ---------------------------------------------------------------------------
 * ESTE MÓDULO NÃO GUARDA NADA, E ISSO É CONTRATUAL
 * ---------------------------------------------------------------------------
 * Os Termos do Google proíbem armazenar conteúdo do Places — telefone, site,
 * nome, nota — com uma exceção: `place_id` (e lat/lng por 30 dias). O anexo R03
 * §2.4 registra isso e prescreve o uso certo: Places é **gatilho de descoberta**,
 * e o dado definitivo se obtém com o próprio fornecedor.
 *
 * Então o telefone que sai daqui atravessa a rota, aparece na tela e morre.
 * Nenhum cache, nenhuma coluna, nem no `audit_log`. Quem quiser o número na ficha
 * liga, fala com o fornecedor e registra o contato — aí o dado é da relação.
 *
 * ---------------------------------------------------------------------------
 * O CUSTO É POR CAMPO PEDIDO, NÃO POR CHAMADA
 * ---------------------------------------------------------------------------
 * A cobrança segue o SKU mais alto presente no `FieldMask`. `nationalPhoneNumber`
 * e `websiteUri` são Enterprise (US$ 35/mil em Text Search, mil grátis por mês).
 * Pedir um campo a mais "porque pode ser útil" muda a faixa de preço da operação
 * inteira, então o field mask abaixo é a lista mínima — e cada item dela tem uma
 * razão de estar.
 */

const URL_BUSCA = 'https://places.googleapis.com/v1/places:searchText';

/**
 * Natal, Praça Cívica. O viés cobre a Grande Natal num raio de 30 km (Parnamirim,
 * Extremoz, São Gonçalo, Macaíba), que é o mercado do R09. Sem viés, "Mega
 * Eventos" devolve um lugar em São Paulo.
 */
const CENTRO_DE_NATAL = { latitude: -5.7945, longitude: -35.211 };
const RAIO_METROS = 30_000;

export type MotivoDoPlaces =
  | 'nao_configurado'
  | 'chave_recusada'
  | 'limite_do_google'
  | 'google_fora'
  | 'resposta_inesperada';

export type LugarEncontrado = {
  placeId: string;
  nome: string;
  endereco: string | null;
  /** Só para mostrar na tela. NÃO pode ser gravado. */
  telefone: string | null;
  site: string | null;
};

export type ResultadoDaBusca =
  | { ok: true; lugares: LugarEncontrado[] }
  | { ok: false; motivo: MotivoDoPlaces; detalhe: string };

export function temChaveDoPlaces(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

/**
 * Monta a consulta textual.
 *
 * Nome + categoria + bairro + cidade, nessa ordem, sem pontuação inventada: a
 * busca textual do Places lida melhor com uma frase natural que com operadores.
 * A categoria entra porque metade destes nomes é ambígua sozinha ("Vybbe",
 * "M3TA", "Grupo Feeling") e sem ela o Places acerta outro negócio.
 */
export function montarConsulta(ficha: {
  nome: string;
  categoria?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
}): string {
  return [ficha.nome, ficha.categoria, ficha.bairro, ficha.cidade ?? 'Natal', ficha.uf ?? 'RN']
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(', ');
}

export async function procurarLugar(consulta: string): Promise<ResultadoDaBusca> {
  const chave = process.env.GOOGLE_MAPS_API_KEY;
  if (!chave) {
    return {
      ok: false,
      motivo: 'nao_configurado',
      detalhe: 'GOOGLE_MAPS_API_KEY ausente no servidor.',
    };
  }

  let resposta: Response;
  try {
    resposta = await fetch(URL_BUSCA, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': chave,
        // Lista mínima. `id` é o único que pode ser guardado; o resto é para a
        // tela. `formattedAddress` entra porque é como a pessoa confere se o
        // Places achou o negócio certo antes de discar.
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri',
      },
      body: JSON.stringify({
        textQuery: consulta,
        languageCode: 'pt-BR',
        regionCode: 'BR',
        // Três, e não um: para nome ambíguo, quem decide qual é o negócio certo é
        // a pessoa olhando o endereço — não o primeiro resultado.
        maxResultCount: 3,
        locationBias: {
          circle: { center: CENTRO_DE_NATAL, radius: RAIO_METROS },
        },
        // Essencial para este caso: cerimonialista, DJ e fotógrafo geralmente não
        // têm loja física, e sem esta chave o Places não os devolve (R03 §2.4).
        includePureServiceAreaBusinesses: true,
      }),
    });
  } catch (erro) {
    return { ok: false, motivo: 'google_fora', detalhe: String(erro) };
  }

  const dados = (await resposta.json().catch(() => ({}))) as {
    places?: {
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      nationalPhoneNumber?: string;
      websiteUri?: string;
    }[];
    error?: { message?: string; status?: string };
  };

  if (!resposta.ok) {
    return {
      ok: false,
      motivo: motivoDoErro(resposta.status, dados.error?.status),
      detalhe: dados.error?.message ?? String(resposta.status),
    };
  }

  // Zero resultados é resposta legítima, não erro: o negócio pode simplesmente
  // não ter ficha no Maps — é o caso de boa parte dos cerimonialistas.
  const lugares = (dados.places ?? [])
    .filter((p): p is { id: string } & typeof p => Boolean(p.id))
    .map((p) => ({
      placeId: p.id,
      nome: p.displayName?.text ?? '(sem nome)',
      endereco: p.formattedAddress ?? null,
      telefone: p.nationalPhoneNumber ?? null,
      site: p.websiteUri ?? null,
    }));

  return { ok: true, lugares };
}

function motivoDoErro(status: number, googleStatus?: string): MotivoDoPlaces {
  if (status === 401 || status === 403) return 'chave_recusada';
  if (status === 429 || googleStatus === 'RESOURCE_EXHAUSTED') return 'limite_do_google';
  if (status >= 500) return 'google_fora';
  return 'resposta_inesperada';
}

export const RECADO_DO_PLACES: Record<MotivoDoPlaces, string> = {
  nao_configurado:
    'A busca no Google ainda não foi configurada no servidor. Fale com Luiz ou Matheus.',
  chave_recusada:
    'O Google recusou a chave da Komune — ela pode estar sem a API de Places habilitada ou restrita a outro domínio.',
  limite_do_google: 'A cota de buscas do mês acabou, ou o Google recusou por excesso de uso.',
  google_fora: 'Não deu para alcançar o Google agora. Tente de novo em instantes.',
  resposta_inesperada: 'O Google respondeu de um jeito que o CRM não entendeu.',
};
