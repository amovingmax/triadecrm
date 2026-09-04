import { TIMEZONE } from '@komune/schema';

import { fraseDeOrigem, horaEmFortaleza, preencherTexto, type ItemDoLote } from './tipos';

/**
 * Os valores que entram nos placeholders do roteiro, e o pouco de cuidado que cada um
 * exige para não virar uma frase esquisita lida em voz alta.
 *
 * `preencherTexto` (em `tipos.ts`) APAGA o placeholder sem valor, em vez de mostrar
 * "[nome]" na tela: ler um colchete em voz alta é pior do que pular a palavra. Aqui a
 * responsabilidade é a inversa — dar valor a tudo que dá para saber antes de discar.
 */

const HORA_CURTA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
});

const DIA_DA_SEMANA = new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE, weekday: 'long' });

const DIA_E_MES = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  day: '2-digit',
  month: '2-digit',
});

/**
 * "Bom dia", "Boa tarde" ou "Boa noite", pela hora de Fortaleza — nunca pela hora do
 * aparelho, que pode estar em outro fuso. A janela de ligação vai até as 20h, então
 * "Boa noite" existe e é o cumprimento certo das 18h em diante.
 */
export function saudacaoDe(quando: Date): string {
  const hora = horaEmFortaleza(quando);
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** "amanhã", "terça-feira" ou "quinta 11/09", conforme a distância. */
export function diaFalado(iso: string | null, agora: Date = new Date()): string | null {
  if (!iso) return null;
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return null;

  const emDias = Math.round(
    (Date.parse(`${diaCivil(quando)}T00:00:00Z`) - Date.parse(`${diaCivil(agora)}T00:00:00Z`)) /
      86_400_000,
  );
  if (emDias === 0) return 'hoje';
  if (emDias === 1) return 'amanhã';
  if (emDias > 1 && emDias <= 6) return DIA_DA_SEMANA.format(quando);
  return `dia ${DIA_E_MES.format(quando)}`;
}

/** "09:00", na hora de Natal. */
export function horaFalada(iso: string | null): string | null {
  if (!iso) return null;
  const quando = new Date(iso);
  return Number.isNaN(quando.getTime()) ? null : HORA_CURTA.format(quando);
}

function diaCivil(quando: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(quando);
}

/** Só o primeiro nome: é assim que a pessoa se apresenta ao telefone. */
export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/**
 * O texto do nó, já falável.
 *
 * `[dia]` e `[hora]` só existem depois que a pessoa combina alguma coisa; enquanto
 * não há data combinada eles somem, e a frase continua correndo ("Então eu ligo, já
 * anotei aqui"). É melhor do que ler uma data inventada pelo sistema em voz alta.
 */
export function falaDoNo(
  texto: string,
  item: ItemDoLote,
  quemLiga: string,
  combinadoEm: string | null,
  agora: Date = new Date(),
): string {
  return costurarPontuacao(
    preencherTexto(texto, {
      saudacao: saudacaoDe(agora),
      empresa: item.nome,
      nome: item.contatoNome,
      origem: fraseDeOrigem(item.origemSlug),
      eu: primeiroNome(quemLiga),
      dia: diaFalado(combinadoEm, agora),
      hora: horaFalada(combinadoEm),
    }),
  );
}

/**
 * Costura a pontuação que sobra quando um placeholder vocativo some.
 *
 * O roteiro chama a pessoa pelo nome no meio da frase ("Ótimo. [nome], a Komune é
 * onde…", "Obrigado pelo tempo, [nome]. Até lá!"), e 66 dos 100 parceiros da base não
 * têm contato nomeado. `preencherTexto` apaga o placeholder — o que é certo, porque
 * ler "[nome]" em voz alta é pior —, mas deixa a vírgula órfã: "Ótimo., a Komune" e
 * "Obrigado pelo tempo,. Até lá!". Quem lê em voz alta tropeça nas duas.
 *
 * As duas emendas são seguras porque nenhuma frase em português tem ".," nem ",.": a
 * vírgula colada num ponto final só existe quando o vocativo desapareceu. A letra
 * seguinte volta a ser maiúscula, porque ali começa mesmo uma frase nova.
 *
 * A correção definitiva é a redação da seed (`supabase/seed.sql`, bloco 12c); esta é
 * a rede que garante que nada quebrado chegue à boca de quem está ao telefone.
 */
function costurarPontuacao(texto: string): string {
  return texto
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/([.!?])\s*,\s*(\p{L})/gu, (_todo, fim: string, letra: string) => {
      return `${fim} ${letra.toLocaleUpperCase('pt-BR')}`;
    })
    .replace(/ {2,}/g, ' ')
    .trim();
}
