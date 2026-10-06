import { FICHA_SEM_NOME } from '@/components/conversas/formatos';
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
 * Ela deixa de ser nova para todos quando alguém do time responde (ver
 * `semResposta`).
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
  /**
   * Quando alguém do time escreveu aqui pela última vez, pelo mesmo critério de
   * `alguemEscreveu`. `null` = ninguém escreveu ainda.
   */
  readonly respondidaEm: string | null;
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
 * As conversas minhas que ainda esperam resposta: chegou mensagem depois da
 * última vez que alguém do time escreveu nelas. São elas que o número ao lado de
 * Conversas conta e que a lista marca com "Nova".
 *
 * ===========================================================================
 * SÓ A RESPOSTA TIRA A MARCA (05/10/2026)
 * ===========================================================================
 * Até aqui a marca saía quando a pessoa ABRIA a conversa. Janio: "se eu clicar
 * na conversa somente para ler o que foi falado, a notificação e a identidade
 * visual já somem, o que não é o ideal. O correto seria sair somente quando
 * alguém mandasse um 'Bom dia' ou alguma mensagem". Ler não é atender: quem abre
 * para conferir e fecha deixava a conversa com cara de resolvida, e o cliente
 * esperando.
 *
 * Agora a marca fica até sair uma resposta do time — escrita ou áudio de gente,
 * ou rascunho da IA aprovado por gente (`alguemEscreveu`). Resposta automática,
 * modelo e envio que falhou não contam. Quem respondeu passa a atender a
 * conversa (`app.messages_quem_responde_atende`), e ela vai para as "Minhas"
 * dessa pessoa.
 *
 * Empate conta como respondida: a resposta nunca nasce antes da mensagem que
 * ela responde, e o carimbo igual só aparece por arredondamento.
 */
export function semResposta(minhas: readonly ConversaComResposta[]): ConversaComResposta[] {
  return minhas.filter(
    (c) => c.respondidaEm === null || maisRecente(c.chegouEm, c.respondidaEm) > 0,
  );
}

/**
 * Até onde o piso pode andar sem engolir conversa à espera de resposta.
 *
 * O piso é o carimbo abaixo do qual a conferência nem lê (`visto`, no aparelho).
 * Ele não anda quando a pessoa entra na tela nem quando abre uma conversa; anda
 * quando o que ficou para trás já foi respondido. Sem isso a leitura traria para
 * sempre as mesmas conversas já resolvidas.
 *
 *   - Nada à espera → o piso vai até a última chegada lida.
 *   - Há à espera   → o piso vai até a chegada mais recente que seja ANTERIOR à
 *                     mais antiga à espera. O que está antes dela ou não é meu,
 *                     ou já foi respondido.
 *   - Leitura cheia → o piso fica onde está. A leitura traz só as mais recentes
 *                     (`TETO_DE_RESPOSTAS`); andar sobre ela engoliria, sem
 *                     ninguém ver, a conversa à espera que ficou abaixo do teto.
 *
 * `null` = não há para onde andar.
 */
export function pisoPossivel(
  conversas: readonly ConversaComResposta[],
  aEspera: readonly ConversaComResposta[],
  leituraCheia = false,
): string | null {
  if (leituraCheia) return null;
  let maisAntiga: string | null = null;
  for (const c of aEspera) {
    if (maisAntiga === null || maisRecente(c.chegouEm, maisAntiga) < 0) maisAntiga = c.chegouEm;
  }
  if (maisAntiga === null) return ultimaChegada(conversas);

  const corte = maisAntiga;
  return ultimaChegada(conversas.filter((c) => maisRecente(c.chegouEm, corte) < 0));
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
  const ficha = nomeDaFicha?.trim() || null;
  // A ficha nascida de uma mensagem se chama "Contato do WhatsApp (84) 9…": o
  // rótulo carrega o número, e é exatamente o que não pode ir para o aviso. Na
  // lista de Conversas ela aparece pelo número inteiro (05/10/2026); aqui, não.
  const nome = ficha && !FICHA_SEM_NOME.test(ficha) ? ficha : perfil;
  if (nome === null) {
    const digitos = conversa.telefone.replace(/\D/g, '');
    return digitos.length >= 4 ? `Número terminado em ${digitos.slice(-4)}` : 'Número sem número';
  }
  return nome;
}

/**
 * Parceiro ou cliente: quem escreveu.
 *
 * ===========================================================================
 * A IDENTIDADE DO CARTÃO (02/10/2026)
 * ===========================================================================
 * Janio: "poderíamos fazer uma identidade visual nas notificações para clientes
 * e parceiros?". Os dois pedem respostas diferentes — o parceiro está num funil,
 * com alguém conduzindo; o cliente é quem comprou ingresso e tem uma dúvida — e
 * o cartão era idêntico para os dois. Agora ele diz quem é por três sinais, e
 * nenhum deles é cor (a única cromia do produto continua sendo a térmica):
 *   1. o SELO: "Mensagem de parceiro" ou "Mensagem de cliente";
 *   2. o AVATAR: quadrado com loja para a empresa, redondo com pessoa para gente;
 *   3. a LINHA DE CONTEXTO: categoria e etapa do parceiro; para o cliente, que é
 *      cliente do app e o fim do número.
 */
export type TipoDoAviso = 'parceiro' | 'cliente';

export function tipoDoAviso(conversa: Pick<ConversaComResposta, 'organizacaoId'>): TipoDoAviso {
  return conversa.organizacaoId === null ? 'cliente' : 'parceiro';
}

/**
 * O selo do cartão. Mantém a palavra "mensagem": o cartão nasceu para deixar
 * "muito claro que tem uma nova mensagem", e só "PARCEIRO" não diria isso.
 */
export function seloDoAviso(tipo: TipoDoAviso): string {
  return tipo === 'parceiro' ? 'Mensagem de parceiro' : 'Mensagem de cliente';
}

/**
 * A linha sob o nome. `texto` pode ser longo e se corta; `destaque` é curto e
 * fica sempre inteiro — é a etapa do parceiro, que diz como responder.
 */
export interface ContextoDoAviso {
  readonly texto: string | null;
  readonly destaque: string | null;
}

/** O que se sabe do parceiro na hora do aviso. `null` em tudo = a leitura falhou. */
export interface FichaDoAviso {
  readonly nome: string | null;
  readonly categoria: string | null;
  readonly etapa: string | null;
}

export function contextoDoAviso(
  conversa: ConversaComResposta,
  ficha: FichaDoAviso | null,
): ContextoDoAviso {
  if (tipoDoAviso(conversa) === 'parceiro') {
    return {
      texto: ficha?.categoria?.trim() || null,
      destaque: ficha?.etapa?.trim() || null,
    };
  }

  // O fim do número só quando o nome não é ele: sem nome no perfil o cartão já
  // se chama "Número terminado em 0002", e repetir embaixo não diz nada.
  const digitos = conversa.telefone.replace(/\D/g, '');
  const temNome = Boolean(conversa.nomeDoPerfil?.trim());
  return {
    texto: 'Cliente do app',
    destaque: temNome && digitos.length >= 4 ? `final ${digitos.slice(-4)}` : null,
  };
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
