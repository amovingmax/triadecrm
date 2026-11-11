/**
 * A primeira resposta no Meu dia novo da Imova (módulo `meuDiaNovo`, 11/11/2026).
 *
 * O gargalo: o cliente espera em média 73 min pela primeira resposta no expediente
 * e 10 h fora dele, e "ninguém é cobrado por ela". O pedido: "Uma meta de
 * 'primeira resposta' no Meu dia."
 *
 * A conta mora no banco (`public.meu_dia_primeira_resposta`, migração
 * 20261111201000): quem espera agora, cada espera respondida no dia, a mediana em
 * minutos de EXPEDIENTE e quantas ficaram dentro do alvo. Este arquivo só lê o
 * que veio, escolhe a cor e escreve as frases. Nada de relógio do aparelho: a
 * hora de referência é a `agora` que o banco devolve junto.
 */

/** A régua: alvo e degrau da gestão em minutos de expediente, e o expediente. */
export type ReguaDaResposta = {
  alvoMin: number;
  gestaoMin: number;
  /** "08:00" */
  inicio: string;
  /** "18:00" */
  fim: string;
};

/** Uma conversa que espera a resposta do time agora. */
export type EsperaAgora = {
  conversaId: string;
  nome: string;
  /** Para onde o toque leva: a conversa em Conversas. */
  caminho: string;
  /** A primeira mensagem do cliente depois da última resposta. */
  desde: string;
  /** Quanto da espera já caiu no expediente. */
  minutos: number;
  semResponsavel: boolean;
};

/** As esperas respondidas no dia: quantas, quantas no alvo e a mediana. */
export type NumerosDaResposta = {
  respondidas: number;
  noAlvo: number;
  /** Em minutos de expediente. `null` = nenhuma respondida. */
  medianaMin: number | null;
};

/** Um grupo da versão da equipe: uma pessoa, as sem responsável ou o total. */
export type GrupoDaEquipe = NumerosDaResposta & {
  esperando: number;
  /** A espera mais antiga do grupo. */
  maisAntiga: string | null;
  /** Quanto dela já caiu no expediente: é o que dá a cor. */
  maisAntigaMin: number | null;
};

export type PessoaDaEquipe = GrupoDaEquipe & { id: string; nome: string; papel: string };

export type PrimeiraResposta = {
  regua: ReguaDaResposta;
  /** O dia das respondidas, "2026-11-11". */
  dia: string;
  /** O relógio do banco no momento da leitura. */
  agora: string;
  pessoa: NumerosDaResposta & {
    id: string;
    esperando: number;
    semResponsavel: number;
    /** As mais antigas primeiro; o banco manda até 20. */
    itens: EsperaAgora[];
  };
  /** Só para admin e gestor. */
  equipe: {
    pessoas: PessoaDaEquipe[];
    semResponsavel: GrupoDaEquipe;
    total: GrupoDaEquipe;
  } | null;
};

// ---------------------------------------------------------------------------
// A fronteira: o jsonb do banco vira tipo honesto
// ---------------------------------------------------------------------------

type Cru = Record<string, unknown>;

function objeto(valor: unknown): Cru {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Cru) : {};
}

function numero(valor: unknown, padrao: number): number {
  const n = typeof valor === 'number' ? valor : typeof valor === 'string' ? Number(valor) : NaN;
  return Number.isFinite(n) ? n : padrao;
}

function numeroOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const n = numero(valor, NaN);
  return Number.isFinite(n) ? n : null;
}

function texto(valor: unknown, padrao: string): string {
  return typeof valor === 'string' && valor.trim() ? valor : padrao;
}

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor : null;
}

function numerosDe(cru: Cru): NumerosDaResposta {
  return {
    respondidas: numero(cru.respondidas, 0),
    noAlvo: numero(cru.no_alvo, 0),
    medianaMin: numeroOuNulo(cru.mediana_min),
  };
}

function grupoDe(valor: unknown): GrupoDaEquipe {
  const cru = objeto(valor);
  return {
    ...numerosDe(cru),
    esperando: numero(cru.esperando, 0),
    maisAntiga: textoOuNulo(cru.mais_antiga),
    maisAntigaMin: numeroOuNulo(cru.mais_antiga_min),
  };
}

/**
 * Lê o retorno de `public.meu_dia_primeira_resposta`. Campo que falta vira o
 * padrão (zero, nulo, a régua de fábrica), para uma versão do banco um passo
 * atrás da do site não derrubar o Meu dia.
 */
export function lerPrimeiraResposta(valor: unknown): PrimeiraResposta {
  const cru = objeto(valor);
  const regua = objeto(cru.regua);
  const pessoa = objeto(cru.pessoa);
  const equipe = cru.equipe === null || cru.equipe === undefined ? null : objeto(cru.equipe);
  const itens = Array.isArray(pessoa.itens) ? pessoa.itens : [];

  return {
    regua: {
      alvoMin: numero(regua.alvo_min, 15),
      gestaoMin: numero(regua.gestao_min, 60),
      inicio: texto(regua.expediente_inicio, '08:00'),
      fim: texto(regua.expediente_fim, '18:00'),
    },
    dia: texto(cru.dia, ''),
    agora: texto(cru.agora, ''),
    pessoa: {
      id: texto(pessoa.id, ''),
      esperando: numero(pessoa.esperando, 0),
      semResponsavel: numero(pessoa.sem_responsavel, 0),
      ...numerosDe(pessoa),
      itens: itens.flatMap((item) => {
        const linha = objeto(item);
        const conversaId = textoOuNulo(linha.conversation_id);
        const desde = textoOuNulo(linha.desde);
        if (!conversaId || !desde) return [];
        return [
          {
            conversaId,
            nome: texto(linha.nome, 'um contato'),
            caminho: texto(linha.caminho, '/conversas'),
            desde,
            minutos: numero(linha.minutos, 0),
            semResponsavel: linha.sem_responsavel === true,
          },
        ];
      }),
    },
    equipe: equipe
      ? {
          pessoas: (Array.isArray(equipe.pessoas) ? equipe.pessoas : []).flatMap((item) => {
            const linha = objeto(item);
            const id = textoOuNulo(linha.id);
            if (!id) return [];
            return [
              {
                id,
                nome: texto(linha.nome, 'Sem nome'),
                papel: texto(linha.papel, ''),
                ...grupoDe(linha),
              },
            ];
          }),
          semResponsavel: grupoDe(equipe.sem_responsavel),
          total: grupoDe(equipe.total),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// A cor
// ---------------------------------------------------------------------------

/**
 * As cores do ritmo do Meu dia, com um degrau a mais. Até o alvo (15 min), dentro:
 * o petróleo. Passou do alvo e ainda não chegou ao degrau da gestão (60 min),
 * perto: o laranja da marca, como "abaixo do ritmo". Passou do degrau da gestão,
 * fora: o vermelho de alerta. Sem número (ninguém respondido), neutro.
 *
 * O degrau da gestão é o mesmo da "espera em degraus" (o aviso no celular aos 15 e
 * aos 60 min): a cor muda na mesma hora em que o aviso sobe de degrau.
 */
export type TomDaResposta = 'dentro' | 'perto' | 'fora' | 'neutro';

export function tomDoTempo(minutos: number | null, regua: ReguaDaResposta): TomDaResposta {
  if (minutos === null || !Number.isFinite(minutos)) return 'neutro';
  if (minutos <= regua.alvoMin) return 'dentro';
  if (minutos <= regua.gestaoMin) return 'perto';
  return 'fora';
}

// ---------------------------------------------------------------------------
// As frases
// ---------------------------------------------------------------------------

/**
 * Uma duração curta, no jeito de falar do time: "agora", "12 min", "2 h 10",
 * "3 h", "1 d 4 h", "12 d". Acima de um dia as horas só aparecem enquanto
 * dizem alguma coisa (até uma semana).
 */
export function duracaoCurta(minutos: number): string {
  const total = Math.max(0, Math.round(minutos));
  if (total < 1) return 'menos de 1 min';
  if (total < 60) return `${total} min`;
  const horas = Math.floor(total / 60);
  if (horas < 24) {
    const resto = total % 60;
    return resto === 0 ? `${horas} h` : `${horas} h ${String(resto).padStart(2, '0')}`;
  }
  const dias = Math.floor(horas / 24);
  const horasDoResto = horas % 24;
  return dias < 7 && horasDoResto > 0 ? `${dias} d ${horasDoResto} h` : `${dias} d`;
}

/** Minutos de relógio entre dois instantes ISO; nunca negativo. */
export function minutosEntre(desde: string, ate: string): number {
  const ms = Date.parse(ate) - Date.parse(desde);
  return Number.isFinite(ms) ? Math.max(0, ms / 60_000) : 0;
}

/** "há 2 h 10", contado no relógio, como o cliente sente. */
export function haQuanto(desde: string, agora: string): string {
  return `há ${duracaoCurta(minutosEntre(desde, agora))}`;
}

/**
 * Quanto da espera caiu no expediente, só quando difere do relógio: a mensagem
 * das 22h esperou a noite inteira, mas a cobrança começa às 8h. Diferença menor
 * que um minuto é a mesma coisa dita duas vezes.
 */
export function noExpediente(espera: EsperaAgora, agora: string): string | null {
  const relogio = minutosEntre(espera.desde, agora);
  if (relogio - espera.minutos < 1) return null;
  return espera.minutos < 1
    ? 'fora do expediente'
    : `${duracaoCurta(espera.minutos)} no expediente`;
}

/** "3 esperando · a mais antiga há 2 h 10"; com uma só, "1 esperando há 40 min". */
export function fraseDaEspera(
  esperando: number,
  maisAntiga: string | null,
  agora: string,
): string | null {
  if (esperando <= 0) return null;
  if (!maisAntiga) return `${esperando} esperando`;
  return esperando === 1
    ? `1 esperando ${haQuanto(maisAntiga, agora)}`
    : `${esperando} esperando · a mais antiga ${haQuanto(maisAntiga, agora)}`;
}

/**
 * A linha embaixo da espera quando há conversa sem responsável (quem atendia saiu
 * da empresa, ou não atende): ela aparece para todos que atendem, e a pessoa
 * precisa saber que não é só dela.
 */
export function fraseSemResponsavel(semResponsavel: number, esperando: number): string | null {
  if (semResponsavel <= 0) return null;
  if (semResponsavel >= esperando) {
    return semResponsavel === 1
      ? 'Está sem responsável: aparece para todos que atendem.'
      : 'Todas estão sem responsável: aparecem para todos que atendem.';
  }
  return semResponsavel === 1
    ? '1 delas está sem responsável e aparece para todos que atendem.'
    : `${semResponsavel} delas estão sem responsável e aparecem para todos que atendem.`;
}

/** "4 de 6 em até 15 min". Sem respondida, nada: a tela diz outra frase. */
export function fraseDoAlvo(numeros: NumerosDaResposta, regua: ReguaDaResposta): string | null {
  if (numeros.respondidas <= 0) return null;
  return `${numeros.noAlvo} de ${numeros.respondidas} em até ${duracaoCurta(regua.alvoMin)}`;
}

/** A mediana na tela: "12 min", "1 h 15", "menos de 1 min". */
export function medianaEmTexto(medianaMin: number | null): string | null {
  return medianaMin === null ? null : duracaoCurta(medianaMin);
}

/** "08:00" → "8h"; "08:30" → "8h30". */
export function horaDoExpediente(hora: string): string {
  const [h, m] = hora.split(':');
  const horas = Number(h);
  if (!Number.isFinite(horas)) return hora;
  return m && m !== '00' ? `${horas}h${m}` : `${horas}h`;
}

/** A régua em uma frase, para quem pergunta "como isso é contado?". */
export function fraseDaRegua(regua: ReguaDaResposta): string {
  return (
    `Alvo: responder em até ${duracaoCurta(regua.alvoMin)} de expediente ` +
    `(${horaDoExpediente(regua.inicio)} às ${horaDoExpediente(regua.fim)}, dias úteis).`
  );
}

/**
 * A frase de "Hoje" quando ninguém foi respondido: um zero na tela pareceria
 * resultado ruim, e não é resultado nenhum.
 */
export function fraseSemRespondidas(esperando: number, hoje: boolean): string {
  if (!hoje) return 'Nenhuma espera respondida neste dia.';
  return esperando > 0
    ? 'Nenhuma resposta hoje ainda. Comece pela que espera há mais tempo.'
    : 'Nenhuma espera respondida hoje ainda.';
}

/**
 * Para onde vai "Abrir em Conversas". No próprio dia, a lista de sempre (que abre
 * em "Minhas"); no dia de outra pessoa, as conversas que ela atende.
 */
export function linkDaLista(pessoaId: string, doProprio: boolean): string {
  return doProprio
    ? '/conversas'
    : `/conversas?ver=todas&atendente=${encodeURIComponent(pessoaId)}`;
}

/**
 * O título da coluna das respondidas: "Hoje", ou o dia, se a leitura for de
 * outro dia (a aba aberta desde ontem, antes de reler).
 */
export function rotuloDoDia(dia: string, hoje: string): string {
  if (!dia || dia === hoje) return 'Hoje';
  const [, mes, diaDoMes] = dia.split('-');
  return mes && diaDoMes ? `Em ${diaDoMes}/${mes}` : 'Hoje';
}

/** Quantas esperas a lista mostra antes do "Mostrar mais". */
export const ESPERAS_A_MOSTRAR = 3;
