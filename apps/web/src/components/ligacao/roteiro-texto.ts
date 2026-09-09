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
 * A categoria do parceiro, como se fala dela.
 *
 * O catálogo escreve para uma tabela de administração — "Buffet adulto/corporativo",
 * "Som, iluminação e DJ com estrutura", "Locais: salões, chácaras, hotéis, restaurantes,
 * praia", "Celebrante, beleza, convites, transfer, segurança, staff". Lido em voz alta,
 * o segundo vira uma lista de compras e o quarto é impronunciável.
 *
 * A regra é a da fala: fica o que vem antes da primeira barra ou do primeiro prefixo de
 * dois-pontos, e a primeira letra desce, porque a categoria entra no meio da frase
 * ("vocês entram na categoria buffet adulto") e não no começo dela.
 *
 * `null` quando a organização não tem categoria — e é comum. `preencherTexto` apaga o
 * marcador, e por isso toda frase do roteiro que usa `[categoria]` foi escrita para
 * fechar sem ele: "…entram na categoria." continua sendo português.
 */
export function categoriaFalada(categoria: string | null): string | null {
  if (!categoria) return null;
  const primeira = categoria.split(/[/:]/)[0]?.trim();
  if (!primeira) return null;
  return primeira.charAt(0).toLocaleLowerCase('pt-BR') + primeira.slice(1);
}

/**
 * O texto do nó, já falável.
 *
 * Quatro dos oito marcadores podem vir vazios, e cada frase do roteiro foi escrita
 * para continuar sendo português sem eles:
 *
 * - `[nome]` — 66 dos 100 parceiros da base não têm contato nomeado;
 * - `[dia]` e `[hora]` — só existem depois que a pessoa combina alguma coisa;
 * - `[categoria]` — nem toda organização tem categoria atribuída.
 *
 * Os outros quatro (`[saudacao]`, `[eu]`, `[origem]`, `[empresa]`) são calculados ou
 * vêm de coluna não nula, e nunca faltam.
 *
 * A regra que isso impõe à REDAÇÃO, e que o teste do roteiro cobra: um marcador
 * opcional só pode ficar colado numa pontuação, como aposto de uma palavra que
 * sobrevive sozinha ("vocês entram na categoria [categoria].") — nunca depois de uma
 * preposição ("começando por [categoria].") nem depois de um travessão, que
 * `preencherTexto` não sabe recolher.
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
      // Primeiro nome também aqui, e não só em `eu`: o contato é gravado como veio
      // da coleta, e "Obrigado pelo tempo, Maria das Graças Nogueira da Silva" não é
      // frase que alguém diga ao telefone.
      nome: item.contatoNome ? primeiroNome(item.contatoNome) : null,
      origem: fraseDeOrigem(item.origemSlug),
      eu: primeiroNome(quemLiga),
      dia: diaFalado(combinadoEm, agora),
      hora: horaFalada(combinadoEm),
      // O marcador que desfaz o roteiro de casamento: em vez de uma enumeração
      // fechada de quatro categorias ("buffet, DJ, decoração e espaço"), que dizia a
      // doze das dezesseis categorias de fornecedor que a ligação não era para elas,
      // o gancho fala a categoria DESTE parceiro.
      categoria: categoriaFalada(item.categoria),
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
