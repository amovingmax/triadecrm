import { FICHA_SEM_NOME, nomeExibido } from '@/components/conversas/formatos';
import { finalDoNumero } from '@/components/conversas/fora-da-base-dados';
import { type AppRole } from '@/lib/auth/role';

/**
 * De quem é o aviso de uma resposta que chegou.
 *
 * ===========================================================================
 * O PROBLEMA QUE ISTO RESOLVE
 * ===========================================================================
 * O número da KOMUNE é um só e vive na Cloud API: não toca celular nenhum. Até
 * aqui a resposta do parceiro só era anunciada a quem estivesse com a tela de
 * Conversas aberta e visível; fora dela, restava o e-mail por lote. A pessoa
 * trabalhando no funil descobria a resposta quando lembrava de olhar.
 *
 * ===========================================================================
 * A REGRA, EM DUAS LINHAS
 * ===========================================================================
 * 1. **Alguém do time já escreveu nesta conversa** → o aviso é de quem atende
 *    (`conversations.assignee_id`), e só dele. É o mesmo dono que
 *    `app.messages_quem_responde_atende` grava quando alguém responde.
 * 2. **Ninguém escreveu ainda** (cliente novo, resposta ao "Bom dia" automático,
 *    resposta a cumprimento de modelo ou de campanha) → o aviso é de todos que
 *    atendem a fila inteira: admin, gestor e sdr. É o mesmo recorte de
 *    `public.meu_dia` desde o ADR-17: "a fila de quem respondeu é de quem abrir".
 *
 * Responsável desativado conta como "ninguém escreveu": aviso endereçado a quem
 * saiu da empresa é aviso que ninguém recebe.
 *
 * ===========================================================================
 * O CLIENTE É DE TODOS OS OPERADORES (02/10/2026)
 * ===========================================================================
 * As duas linhas acima valem para o PARCEIRO, que tem ficha, funil e alguém
 * conduzindo a captação. Janio, depois de ver em produção: "a mensagem chegou
 * somente para quem está assumindo a conversa, e isto é o certo [...] agora
 * quero a mesma situação para a aba de 'clientes' (que são as pessoas que usam
 * o app), sendo que essa aba deve ter a notificação exibida para todos os
 * operadores".
 *
 * Quem não é ficha (`organizacaoId === null`) é atendimento, não captação: quem
 * escreve é o comprador de ingresso com uma dúvida, e quem responde é quem
 * estiver na frente do CRM. Por isso toda mensagem de cliente avisa admin,
 * gestor e sdr, mesmo depois de um colega já ter respondido àquela conversa.
 * Cada operador deixa de vê-la como nova quando ELE a abre.
 *
 * ===========================================================================
 * POR QUE AQUI, E NÃO NO BANCO
 * ===========================================================================
 * Isto é regra de TELA, não de segurança: a RLS de `conversations` e `messages`
 * já decidiu o que cada pessoa enxerga, e nada aqui alarga isso. É o mesmo caso
 * de `esperandoResposta` em `conversas/montagem.ts`. Ficar fora do banco é
 * também o que deixa esta entrega sem migração nenhuma — nada no caminho do
 * WhatsApp muda, e nada em produção precisa ser aplicado antes do site.
 */

/** Uma conversa em que chegou mensagem depois da última vez que a pessoa olhou. */
export interface ConversaComResposta {
  readonly conversaId: string;
  /** `null` é a conversa de quem ainda não é ficha (a aba "Clientes"). */
  readonly organizacaoId: string | null;
  /** O "Atendendo" da tela: `conversations.assignee_id`. */
  readonly responsavelId: string;
  /** `conversations.last_inbound_at`, como o banco escreveu. */
  readonly chegouEm: string;
  /** O nome que a pessoa usa no WhatsApp, quando a Meta mandou. */
  readonly nomeDoPerfil: string | null;
  readonly telefone: string;
  /** Alguém do time já escreveu ou gravou áudio aqui (modelo não conta). */
  readonly alguemEscreveu: boolean;
}

export interface QuemSouEu {
  readonly id: string;
  readonly papel: AppRole;
}

/**
 * Espelho de `app.can_write()`. Quem não responde não é avisado: pôr um número
 * no menu de quem o banco vai recusar é mandar trabalhar e depois dizer não.
 */
const PAPEIS_QUE_RESPONDEM: readonly AppRole[] = ['admin', 'gestor', 'sdr', 'embaixador'];

/**
 * Quem recebe a fila inteira em `public.meu_dia` (migração `20261002180000`). O
 * embaixador fica de fora: a leitura dele é estreita, e ele só é avisado do que
 * está endereçado a ele.
 */
const PAPEIS_DA_FILA_INTEIRA: readonly AppRole[] = ['admin', 'gestor', 'sdr'];

export function recebeAvisos(papel: AppRole): boolean {
  return PAPEIS_QUE_RESPONDEM.includes(papel);
}

/**
 * `ativos` é quem está ativo no time; `null` quando a leitura falhou. Sem a
 * lista, o responsável é tratado como ativo: é o caso comum, e o contrário
 * transformaria uma falha de rede em aviso de tudo para todo mundo.
 */
export function ehParaMim(
  conversa: ConversaComResposta,
  eu: QuemSouEu,
  ativos: ReadonlySet<string> | null,
): boolean {
  if (!recebeAvisos(eu.papel)) return false;
  if (conversa.responsavelId === eu.id) return true;

  // Cliente: de todos os operadores, tenha alguém respondido ou não.
  if (conversa.organizacaoId === null) return PAPEIS_DA_FILA_INTEIRA.includes(eu.papel);

  const responsavelAtivo = ativos === null || ativos.has(conversa.responsavelId);
  if (conversa.alguemEscreveu && responsavelAtivo) return false;

  return PAPEIS_DA_FILA_INTEIRA.includes(eu.papel);
}

export function respostasParaMim(
  conversas: readonly ConversaComResposta[],
  eu: QuemSouEu,
  ativos: ReadonlySet<string> | null,
): ConversaComResposta[] {
  return conversas.filter((c) => ehParaMim(c, eu, ativos));
}

/**
 * Qual de dois carimbos do banco é o mais recente (positivo = `a`).
 *
 * Os dois vêm do PostgREST no mesmo fuso, mas com casas decimais variáveis: o
 * Postgres corta os zeros do fim. `Date.parse` resolve até o milissegundo, e o
 * desempate por texto cobre os microssegundos que ele joga fora.
 */
export function maisRecente(a: string, b: string): number {
  const diferenca = Date.parse(a) - Date.parse(b);
  if (diferenca !== 0 && !Number.isNaN(diferenca)) return diferenca;
  return a === b ? 0 : a > b ? 1 : -1;
}

/**
 * A chegada mais recente da lista: é para onde o piso anda quando não sobra
 * nenhuma conversa por abrir.
 *
 * O marco é sempre um carimbo DO BANCO, nunca o relógio do aparelho. Um
 * computador dois minutos adiantado marcaria "visto" no futuro e calaria as
 * respostas dos dois minutos seguintes — em silêncio, que é a pior forma.
 */
export function ultimaChegada(conversas: readonly ConversaComResposta[]): string | null {
  let ultima: string | null = null;
  for (const c of conversas) {
    if (ultima === null || maisRecente(c.chegouEm, ultima) > 0) ultima = c.chegouEm;
  }
  return ultima;
}

/**
 * As conversas minhas que ainda não abri: chegou mensagem depois da última vez
 * que abri cada uma. São elas que o número ao lado de Conversas conta e que a
 * lista marca com "Nova".
 *
 * ===========================================================================
 * POR QUE CONVERSA A CONVERSA (02/10/2026)
 * ===========================================================================
 * A primeira versão zerava tudo quando a pessoa entrava na tela de Conversas.
 * Janio: "ele não deve desaparecer todo de uma vez assim que eu abro a aba de
 * conversas, ele deve ir verificando uma por uma, caso eu abra uma mensagem ele
 * sai de 5 e vai pra 4". Ver a lista não é ler a conversa: com cinco esperando,
 * o número zerado dizia que não havia mais nada a fazer.
 *
 * `abertas` guarda, por conversa, a chegada que estava lá quando a pessoa a
 * abriu. Mensagem nova na mesma conversa tem carimbo maior, e ela volta a contar.
 */
export function aindaNaoAbertas(
  minhas: readonly ConversaComResposta[],
  abertas: ReadonlyMap<string, string>,
): ConversaComResposta[] {
  return minhas.filter((c) => {
    const abertaAte = abertas.get(c.conversaId);
    return abertaAte === undefined || maisRecente(c.chegouEm, abertaAte) > 0;
  });
}

/**
 * Até onde o piso pode andar sem engolir conversa por abrir.
 *
 * O piso é o carimbo abaixo do qual a conferência nem lê (`visto`, no aparelho).
 * Ele não anda mais quando a pessoa entra na tela; anda quando o que ficou para
 * trás já foi aberto. Sem isso a leitura traria para sempre as mesmas conversas
 * já abertas, e o registro do que foi aberto cresceria sem fim.
 *
 *   - Nada por abrir → o piso vai até a última chegada lida.
 *   - Há por abrir   → o piso vai até a chegada mais recente que seja ANTERIOR à
 *                      mais antiga por abrir. O que está antes dela ou não é meu,
 *                      ou já abri.
 *
 * `null` = não há para onde andar.
 */
export function pisoPossivel(
  conversas: readonly ConversaComResposta[],
  porAbrir: readonly ConversaComResposta[],
): string | null {
  let maisAntiga: string | null = null;
  for (const c of porAbrir) {
    if (maisAntiga === null || maisRecente(c.chegouEm, maisAntiga) < 0) maisAntiga = c.chegouEm;
  }
  if (maisAntiga === null) return ultimaChegada(conversas);

  const corte = maisAntiga;
  return ultimaChegada(conversas.filter((c) => maisRecente(c.chegouEm, corte) < 0));
}

/** O registro do que foi aberto, sem o que o piso já cobre. */
export function semOQueOPisoCobre(
  abertas: ReadonlyMap<string, string>,
  piso: string,
): Map<string, string> {
  const restam = new Map<string, string>();
  for (const [conversaId, abertaAte] of abertas) {
    if (maisRecente(abertaAte, piso) > 0) restam.set(conversaId, abertaAte);
  }
  return restam;
}

/**
 * O que chegou desde a última conferência — é só isto que merece aviso.
 *
 * `conhecidas === null` é a primeira leitura depois de abrir o CRM: ela só
 * estabelece a linha de base. Sem isso, cada recarga da página anunciaria de
 * novo tudo o que já estava esperando.
 */
export function chegaramAgora(
  conhecidas: ReadonlyMap<string, string> | null,
  minhas: readonly ConversaComResposta[],
): ConversaComResposta[] {
  if (conhecidas === null) return [];
  return minhas.filter((c) => {
    const antes = conhecidas.get(c.conversaId);
    return antes === undefined || maisRecente(c.chegouEm, antes) > 0;
  });
}

/**
 * Com que nome a pessoa aparece no aviso. Nunca o telefone inteiro (RF-BAS-14):
 * a notificação do sistema aparece por cima de qualquer coisa, inclusive de uma
 * tela compartilhada numa reunião.
 */
export function nomeDoAviso(conversa: ConversaComResposta, nomeDaFicha: string | null): string {
  const perfil = conversa.nomeDoPerfil?.trim() || null;
  const nome = nomeDaFicha?.trim() ? nomeExibido(nomeDaFicha.trim(), perfil) : perfil;
  // A ficha nascida de uma mensagem se chama "Contato do WhatsApp (84) 9…": o
  // rótulo carrega o número, e é exatamente o que não pode ir para o aviso.
  if (nome === null || FICHA_SEM_NOME.test(nome)) {
    return `Número ${finalDoNumero(conversa.telefone)}`;
  }
  return nome;
}

const LISTA = new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' });

/** Quantos nomes cabem no corpo do aviso antes de virar "e mais N". */
const NOMES_NO_AVISO = 3;

export interface TextoDoAviso {
  readonly titulo: string;
  readonly corpo: string;
}

/**
 * O texto da notificação DO SISTEMA. Ela não leva o conteúdo da mensagem: aparece
 * por cima de qualquer coisa, inclusive de uma tela compartilhada numa reunião.
 * A prévia do texto vai no cartão de dentro do CRM (`previaDaMensagem`), que só
 * quem está logado vê.
 *
 * "Nova mensagem de", e não "respondeu": quem escreve primeiro — o cliente que
 * viu um anúncio — não está respondendo ninguém.
 */
export function textoDoAviso(nomes: readonly string[]): TextoDoAviso {
  const unicos = [...new Set(nomes)];
  if (nomes.length <= 1) {
    return {
      titulo: `Nova mensagem de ${unicos[0] ?? 'alguém'}`,
      corpo: 'Abra o Tríade para ler e responder.',
    };
  }

  const mostrados = unicos.slice(0, NOMES_NO_AVISO);
  const resto = unicos.length - mostrados.length;
  return {
    titulo: `${nomes.length} conversas com mensagem nova`,
    corpo: resto > 0 ? `${mostrados.join(', ')} e mais ${resto}.` : `${LISTA.format(mostrados)}.`,
  };
}

/** O que dizer de uma mensagem que não é texto. */
const PREVIA_POR_TIPO: Readonly<Record<string, string>> = {
  audio: 'Mensagem de áudio',
  image: 'Imagem',
  video: 'Vídeo',
  document: 'Documento',
  reaction: 'Reagiu a uma mensagem',
};

/** Quantos caracteres da mensagem cabem no cartão antes das reticências. */
const TAMANHO_DA_PREVIA = 140;

/**
 * A prévia da mensagem no cartão de dentro do CRM: o começo do texto, numa linha
 * só. Sem texto (áudio, imagem), diz o que chegou. `null` quando não se sabe —
 * o cartão então mostra só o nome, em vez de inventar.
 */
export function previaDaMensagem(tipo: string | null, corpo: string | null): string | null {
  const texto = corpo?.replace(/\s+/g, ' ').trim();
  if (texto) {
    return texto.length > TAMANHO_DA_PREVIA
      ? `${texto.slice(0, TAMANHO_DA_PREVIA - 1).trimEnd()}…`
      : texto;
  }
  return tipo ? (PREVIA_POR_TIPO[tipo] ?? null) : null;
}

/**
 * Para onde o aviso leva. Uma conversa só abre direto nela: a da ficha por
 * `?org=`, a de quem não é ficha por `?cliente=` (o id da conversa, porque ele
 * não tem ficha). Várias de uma vez levam a uma lista: a aba Clientes quando são
 * todas de clientes, senão a fila de quem respondeu.
 */
export function destinoDoAviso(
  novas: readonly Pick<ConversaComResposta, 'conversaId' | 'organizacaoId'>[],
): string {
  const primeira = novas[0];
  if (novas.length === 1 && primeira) {
    return primeira.organizacaoId
      ? `/conversas?org=${primeira.organizacaoId}`
      : `/conversas?cliente=${primeira.conversaId}`;
  }
  if (novas.every((c) => c.organizacaoId === null)) return '/conversas?aba=fora';
  return '/conversas?aba=responderam';
}

/**
 * A marca da notificação do sistema. Duas abas do CRM abertas calculam o mesmo
 * aviso; com a mesma marca o navegador troca um pelo outro em vez de empilhar.
 */
export function marcaDoAviso(novas: readonly ConversaComResposta[]): string {
  const primeira = novas[0];
  if (!primeira) return 'triade-resposta';
  return `triade-resposta-${primeira.conversaId}-${ultimaChegada(novas) ?? ''}-${novas.length}`;
}

/** O que o leitor de tela diz do número ao lado de Conversas. */
export function rotuloDasRespostas(quantas: number): string {
  return quantas === 1 ? '1 resposta nova' : `${quantas} respostas novas`;
}
