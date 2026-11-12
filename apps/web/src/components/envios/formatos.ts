import { EMPRESA } from '@/lib/empresa';

import {
  CAMPOS_DA_FICHA,
  type AcaoDoBotao,
  type Assinatura,
  type CampoDaFicha,
  type Contagem,
  type FiltroDoPublico,
  type ItemDoCadastro,
  type RegraDaVariavel,
} from './tipos';

/**
 * As regras de texto dos envios em massa — puras, para serem testadas sem tela.
 */

/** Preenchidas pelo banco em todo envio; ninguém escolhe o valor delas. */
export const VARIAVEIS_AUTOMATICAS = ['atendente', 'saudacao'] as const;

/**
 * As variáveis de um corpo, na ordem da primeira aparição e sem repetir — o
 * mesmo que `app.modelo_variaveis` faz no banco.
 */
export function variaveisDoCorpo(corpo: string): string[] {
  const vistas: string[] = [];
  for (const m of corpo.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    const nome = m[1] ?? '';
    if (nome !== '' && !vistas.includes(nome)) vistas.push(nome);
  }
  return vistas;
}

/** As variáveis que PEDEM regra: todas menos as automáticas. */
export function variaveisComRegra(corpo: string): string[] {
  return variaveisDoCorpo(corpo).filter(
    (v) => !(VARIAVEIS_AUTOMATICAS as readonly string[]).includes(v),
  );
}

function ehCampo(v: string): v is CampoDaFicha {
  return CAMPOS_DA_FICHA.some((c) => c.valor === v);
}

/**
 * A regra que a tela sugere para uma variável: puxa da ficha, com uma reserva
 * que ainda lê bem quando a ficha não tem o dado — sem reserva, a pessoa
 * seria pulada no envio. O teste no navegador ensinou as duas escolhas:
 * "Oi, tudo bem. Aqui é a Komune" soa estranho ("pessoal" não), e metade das
 * fichas não tem categoria ("fornecedores fundadores de eventos" lê bem).
 * Variável que não é campo da ficha vira texto fixo, a preencher.
 */
const RESERVAS: Record<string, string> = { nome: 'pessoal', categoria: 'eventos', cidade: 'Natal' };

export function regraSugerida(variavel: string): RegraDaVariavel {
  if (ehCampo(variavel)) return { campo: variavel, reserva: RESERVAS[variavel] ?? '' };
  return { fixo: '' };
}

/** As regras para um corpo novo, mantendo as que a pessoa já tinha escrito. */
export function regrasPara(
  corpo: string,
  anteriores: Record<string, RegraDaVariavel>,
): Record<string, RegraDaVariavel> {
  const regras: Record<string, RegraDaVariavel> = {};
  for (const v of variaveisComRegra(corpo)) regras[v] = anteriores[v] ?? regraSugerida(v);
  return regras;
}

/** A variável é um campo da ficha (dá para voltar a puxar dela)? */
export function ehCampoDaFicha(variavel: string): boolean {
  return ehCampo(variavel);
}

/**
 * As regras ao TROCAR de mensagem. Campo da ficha volta para a sugestão (puxar
 * da ficha, com reserva), a não ser que já estivesse puxando da ficha — um
 * "texto fixo" escolhido para outra mensagem não pode vir junto sem ninguém
 * ver. O texto fixo de uma variável que não é da ficha (o nome do evento)
 * continua: lá, fixo é o único jeito, e o que foi escrito ainda serve.
 */
export function regrasAoTrocar(
  corpo: string,
  anteriores: Record<string, RegraDaVariavel>,
): Record<string, RegraDaVariavel> {
  const regras: Record<string, RegraDaVariavel> = {};
  for (const v of variaveisComRegra(corpo)) {
    const antes = anteriores[v];
    regras[v] = ehCampo(v) ? (antes && 'campo' in antes ? antes : regraSugerida(v)) : (antes ?? regraSugerida(v));
  }
  return regras;
}

/** Variáveis cuja regra ainda não dá para usar (texto fixo vazio). */
export function regrasIncompletas(regras: Record<string, RegraDaVariavel>): string[] {
  return Object.entries(regras)
    .filter(([, r]) => 'fixo' in r && r.fixo.trim() === '')
    .map(([v]) => v);
}

// ---------------------------------------------------------------------------
// Motivos, em português
// ---------------------------------------------------------------------------

const MOTIVOS_DO_ITEM: Record<string, string> = {
  contato_suprimido: 'Pediu para não receber mensagens.',
  numero_suprimido: 'Pediu para não receber mensagens.',
  do_not_contact: 'Pediu para não receber mensagens.',
  contato_apagado: 'A pessoa foi apagada da ficha.',
  conversa_bloqueada: 'A conversa com este número está bloqueada no CRM.',
  organizacao_apagada: 'A ficha foi excluída.',
  sem_whatsapp: 'A ficha não tem WhatsApp.',
  ficha_sem_whatsapp: 'A ficha não tem WhatsApp.',
  mensagem_recente_sem_resposta:
    'Recebeu mensagem nossa há menos de 72 h e não respondeu. Mandar outra seguida é o que faz bloquear.',
  sem_janela_24h:
    'Não falou com a gente nas últimas 24 h. Texto livre não chega: para essa pessoa, só modelo aprovado.',
  sem_valor: 'Faltou valor para uma variável, e não havia reserva.',
  variavel_sem_regra: 'Uma variável ficou sem regra.',
  assinante_sem_permissao: 'Quem assinaria não está mais ativo ou não pode enviar.',
  modelo_nao_aprovado_na_meta: 'A Meta não aceita mais este modelo.',
  erro: 'Erro inesperado no envio.',
};

export function fraseDoMotivo(motivo: string | null | undefined): string {
  if (!motivo) return '';
  return MOTIVOS_DO_ITEM[motivo] ?? `Recusado: ${motivo}.`;
}

const RECUSAS_DO_LOTE: Record<string, string> = {
  sem_permissao: 'Só admin, gestor e SDR montam e controlam disparos.',
  nome_invalido: 'Dê um nome ao disparo (até 120 letras).',
  tipo_invalido: 'Escolha entre modelo aprovado e texto livre.',
  modelo_inexistente: 'Este modelo não existe mais. Escolha outro.',
  modelo_nao_aprovado_na_meta: 'A Meta ainda não aprovou este modelo.',
  texto_invalido: 'O texto precisa ter entre 1 e 1.000 letras.',
  variavel_sem_regra: 'Uma variável ficou sem regra.',
  variavel_longa_demais: 'O texto de uma variável ficou longo demais.',
  publico_vazio: 'Ninguém marcado para receber.',
  publico_grande_demais: 'No máximo 2.000 pessoas por disparo.',
  ritmo_invalido: 'O ritmo vai de 1 a 300 mensagens por hora.',
  inicio_distante_demais: 'Agende para no máximo 30 dias à frente.',
  assinatura_invalida: 'Escolha quem assina.',
  atendente_invalido: 'Um dos atendentes escolhidos não está ativo ou não pode enviar.',
  envio_inexistente: 'Este disparo não existe mais. Atualize a tela.',
  modelo_tem_atendente: `Este modelo diz "aqui é {{atendente}}". Em nome da ${EMPRESA.nome}, escolha um modelo sem nome de atendente.`,
  acoes_invalidas: 'Confira o que acontece em cada botão: o link precisa de texto e de rótulo.',
  destino_invalido: 'O destino do link precisa começar com https://.',
  nome_invalido_modelo: 'Dê ao modelo um nome de 3 a 80 letras.',
  categoria_invalida: 'Escolha marketing ou utilidade.',
  corpo_vazio: 'Escreva a mensagem.',
  corpo_longo_demais: 'A mensagem passou de 1.024 letras.',
  variavel_fora_do_formato: 'Variável fora do formato: use letras minúsculas, como {{nome}}.',
  variavel_na_borda: 'A mensagem não pode começar nem terminar com uma variável: a Meta recusa.',
  variaveis_coladas: 'Há duas variáveis coladas: ponha texto entre elas.',
  botoes_invalidos: 'Até 3 botões de até 25 letras, no máximo 1 de link, sem textos repetidos.',
  acao_invalida_no_estado: 'O disparo mudou de estado. Atualize a tela.',
  sem_permissao_modelo: 'Só admin e gestor criam modelos: é catálogo, como em Ajustes.',
  sem_origem:
    'Falta uma origem para as fichas novas (“contato pessoal” ou outra manual) ligada em Ajustes. Peça a um admin ou gestor.',
  lista_invalida: 'A lista passou do limite: até 500 pessoas por cadastro e 2.000 por disparo.',
};

export function fraseDaRecusa(motivo: string | undefined, variavel?: string): string {
  const base = RECUSAS_DO_LOTE[motivo ?? ''] ?? `O banco recusou: ${motivo ?? 'sem motivo'}.`;
  return variavel ? `${base} ({{${variavel}}})` : base;
}

// ---------------------------------------------------------------------------
// Tempo e progresso
// ---------------------------------------------------------------------------

/** 8h às 17h45: 9 h 45 min de envio por dia útil. */
export const HORAS_DE_ENVIO_POR_DIA = 9.75;

/**
 * Quanto tempo o lote leva, contando o ritmo e o teto de primeiros contatos.
 * É estimativa, e a tela diz isso: pulos adiantam, espera por teto atrasa.
 */
export function duracaoEstimada(
  quantidade: number,
  porHora: number,
  tetoDiario: number | null,
): string {
  if (quantidade <= 0 || porHora <= 0) return '—';
  const horas = quantidade / porHora;
  const diasPeloRitmo = Math.ceil(horas / HORAS_DE_ENVIO_POR_DIA);
  const diasPeloTeto = tetoDiario && tetoDiario > 0 ? Math.ceil(quantidade / tetoDiario) : 1;
  const dias = Math.max(diasPeloRitmo, diasPeloTeto);
  if (dias > 1) return `cerca de ${dias} dias úteis`;
  if (horas < 1) return `cerca de ${Math.max(1, Math.round(horas * 60))} min`;
  return `cerca de ${Math.round(horas * 10) / 10} h`.replace('.', ',');
}

/**
 * Quem recebe, dada a quantidade escolhida: os N primeiros dos marcados, na
 * ordem da lista. `null` (ou vazio) é "todos os marcados". A quantidade é
 * escolha de quem dispara (12/11/2026: "eu não quero que a quantidade seja
 * determinada"); o limite do dia é só o da Meta.
 */
export function aplicarQuantidade<T>(marcados: readonly T[], quantidade: number | null): T[] {
  if (quantidade === null || !Number.isFinite(quantidade)) return [...marcados];
  return marcados.slice(0, Math.max(0, Math.floor(quantidade)));
}

/**
 * Quantas destas mensagens cabem hoje e quantas ficam para o próximo dia útil.
 * Conta só quem ABRE conversa (quem está com a janela de 24 h aberta não gasta
 * o limite) e desconta o que os disparos em curso já vão mandar.
 */
export function divisaoDoDia(
  abrem: number,
  sobra: number | null,
  naFila: number,
): { hoje: number; depois: number } | null {
  if (sobra === null) return null;
  const cabe = Math.max(sobra - naFila, 0);
  return { hoje: Math.min(abrem, cabe), depois: Math.max(abrem - cabe, 0) };
}

/**
 * O que a tela sugere para cada botão de resposta: "Agora não" e parecidos
 * encerram o contato; o resto manda o link — é a ação que o envio quer.
 */
export function acaoSugerida(textoDoBotao: string): AcaoDoBotao {
  if (/agora n[aã]o|n[aã]o quero|sair|parar|sem interesse/i.test(textoDoBotao)) return { acao: 'sair' };
  return {
    acao: 'link',
    texto: 'Que bom! O cadastro leva 5 minutos e é grátis. É só tocar no botão abaixo.',
    botao: 'Criar meu perfil',
  };
}

/** As ações dos botões de resposta de um modelo, mantendo as que já foram editadas. */
export function acoesPara(
  botoes: readonly { tipo: string; texto: string }[],
  anteriores: Record<string, AcaoDoBotao>,
): Record<string, AcaoDoBotao> {
  const acoes: Record<string, AcaoDoBotao> = {};
  for (const b of botoes) {
    if (b.tipo !== 'resposta') continue;
    acoes[b.texto] = anteriores[b.texto] ?? acaoSugerida(b.texto);
  }
  return acoes;
}

/** Fração do lote já decidida (enviada, pulada ou cancelada), de 0 a 1. */
export function progresso(c: Contagem): number {
  if (c.total === 0) return 0;
  return (c.enviadas + c.puladas + c.canceladas) / c.total;
}

/** Porcentagem inteira, sem casas: "12%". */
export function porcento(parte: number, todo: number): string {
  if (todo <= 0) return '0%';
  return `${Math.round((parte / todo) * 100)}%`;
}

// ---------------------------------------------------------------------------
// A tela única da campanha (Fase 5)
// ---------------------------------------------------------------------------

/**
 * O nome que a campanha ganha sozinha: a mensagem e o dia. Quem monta uma por
 * semana não precisa inventar nome; quem quer outro, escreve por cima.
 */
export function nomeSugerido(mensagem: string | null, agora: Date = new Date()): string {
  const base = mensagem?.trim() ?? '';
  if (base === '') return '';
  const dia = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    day: '2-digit',
    month: '2-digit',
  }).format(agora);
  return `${base.slice(0, 100)} — ${dia}`;
}

/**
 * O que a Meta cobra por mensagem de modelo no Brasil, em reais: os mesmos
 * valores que a folha de criar modelo mostra. Marketing é cobrado sempre;
 * utilidade é grátis para quem está com a janela de 24 h aberta.
 */
export const PRECO_POR_MENSAGEM = { marketing: 0.34, utility: 0.035 } as const;

/** Estimativa do custo na Meta; `null` quando a categoria do modelo não diz. */
export function custoEstimado(
  categoria: string | null,
  quantidade: number,
  comJanela: number,
): number | null {
  if (categoria === 'marketing') return quantidade * PRECO_POR_MENSAGEM.marketing;
  if (categoria === 'utility') {
    return Math.max(quantidade - comJanela, 0) * PRECO_POR_MENSAGEM.utility;
  }
  return null;
}

export function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

/** Número inteiro com o ponto de milhar: "2.000". */
export function formatarNumero(valor: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(valor);
}

/**
 * Quantos filtros estão ligados dentro de "Mais filtros". O botão mostra o
 * número: filtro escondido e esquecido é público menor sem ninguém saber por quê.
 */
export function filtrosEscondidos(f: FiltroDoPublico): number {
  const listas = [f.tipos, f.etapas, f.categorias, f.cidades, f.responsaveis, f.temperaturas];
  return (
    listas.filter((l) => (l?.length ?? 0) > 0).length +
    ((f.busca ?? '').trim() !== '' ? 1 : 0) +
    (f.sem_contato_ha_dias === null || f.sem_contato_ha_dias === undefined ? 0 : 1)
  );
}

/** Como a lista chama a mensagem do disparo: os três cumprimentos são um só. */
export function rotuloDaMensagem(modelo: string | null): string {
  if (modelo === null) return 'Texto livre';
  return /cumprimento solto/i.test(modelo) ? 'Cumprimento' : modelo;
}

// ---------------------------------------------------------------------------
// O disparo numa página, com o celular ao lado (protótipo B, 12/11/2026)
// ---------------------------------------------------------------------------
// Pedido do usuário: "quero que na tela de disparo, eu consiga com mais
// clareza, cadastrar contatos, ver a mensagem clara que vai ser enviada".

/** Uma lista em partes de até `tamanho` (o banco cadastra 500 por vez). */
export function emPedacos<T>(lista: readonly T[], tamanho: number): T[][] {
  const n = Math.max(1, Math.floor(tamanho));
  const partes: T[][] = [];
  for (let i = 0; i < lista.length; i += n) partes.push(lista.slice(i, i + n));
  return partes;
}

/** "Mariana Souza" → "Mariana". */
export function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * O WhatsApp do Brasil em E.164, pela mesma regra de `app.normalize_phone_br`
 * menos a lista de DDDs da Anatel: DDI 55 e zero de operadora saem, número sem
 * DDD ganha o 84, celular antigo ganha o 9. É a conferência da TELA (dizer na
 * hora quantas linhas coladas valem); quem decide de verdade é o banco.
 */
export function telefoneDoBrasil(texto: string): string | null {
  let d = texto.replace(/\D/g, '');
  if (d === '') return null;
  if (d.startsWith('0055') && d.length >= 14) d = d.slice(4);
  else if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);
  else if (d.startsWith('0') && (d.length === 13 || d.length === 14)) d = d.slice(3);
  if (d.length === 8 || d.length === 9) d = `84${d}`;
  if (d.length === 10 && /[6-9]/.test(d.charAt(2))) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  if (d.length !== 10 && d.length !== 11) return null;
  // DDD do Brasil não tem zero em nenhum dos dois dígitos.
  if (d.charAt(0) === '0' || d.charAt(1) === '0') return null;
  if (d.length === 11 && d.charAt(2) !== '9') return null;
  if (d.length === 10 && !/[2-5]/.test(d.charAt(2))) return null;
  return `+55${d}`;
}

export type LinhaColada = { linha: number; nome: string; telefone: string; empresa: string | null };
export type LinhaRecusada = {
  linha: number;
  texto: string;
  motivo: 'sem_nome' | 'sem_whatsapp' | 'repetida' | 'acima_do_limite';
};

/** "Nome, Telefone", "nome;whatsapp;empresa": a primeira linha de muita planilha. */
const PARECE_CABECALHO = /\b(nome|contato)\b.*\b(telefone|whatsapp|celular|fone|n[uú]mero)\b/i;

/** CPF escrito como CPF: "123.456.789-09". Nunca é telefone. */
const CPF_ESCRITO = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;

/** Os dois dígitos verificadores do CPF conferem? (11 dígitos, sem pontuação.) */
export function cpfValido(digitos: string): boolean {
  if (!/^\d{11}$/.test(digitos) || /^(\d)\1{10}$/.test(digitos)) return false;
  const dv = (ate: number) => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += Number(digitos.charAt(i)) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(9) === Number(digitos.charAt(9)) && dv(10) === Number(digitos.charAt(10));
}

/** Uma coluna com 11 dígitos SEM pontuação que passa no verificador do CPF. */
function pareceCpfSolto(coluna: string): boolean {
  return /^\d{11}$/.test(coluna.trim()) && cpfValido(coluna.trim());
}

function limparNome(texto: string): string {
  return texto
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:|–—-]+|[\s,;:|–—-]+$/g, '')
    .trim();
}

function lerUmaLinha(linha: string): {
  nome: string;
  telefone: string | null;
  empresa: string | null;
} {
  const sep = linha.includes('\t') ? '\t' : linha.includes(';') ? ';' : linha.includes(',') ? ',' : null;
  if (sep) {
    // Coluna com cara de CPF não entra em nada: nem telefone, nem nome (ADR-09,
    // o CRM não guarda CPF).
    const partes = linha
      .split(sep)
      .map((p) => p.trim())
      .filter((p) => !CPF_ESCRITO.test(p));
    const telefones = partes
      .map((p, i) => ({ i, cpf: pareceCpfSolto(p), tel: telefoneDoBrasil(p) !== null }))
      .filter((c) => c.tel);
    // O telefone é a primeira coluna com cara de telefone (planilha com o número
    // na frente do nome também vale). Onze dígitos que fecham como CPF só são o
    // telefone se não houver outra coluna com cara de telefone.
    const escolhido = telefones.find((c) => !c.cpf) ?? telefones[0];
    if (escolhido) {
      const resto = partes.filter((p, j) => j !== escolhido.i && !pareceCpfSolto(p));
      // Nome, telefone e empresa: o que vier depois (e-mail, cidade…) fica de fora.
      return {
        nome: limparNome(resto[0] ?? ''),
        telefone: partes[escolhido.i] ?? null,
        empresa: limparNome(resto[1] ?? '') || null,
      };
    }
  }
  // Sem separador: "Mariana Souza 84 99999-0101".
  const semCpf = linha.replace(new RegExp(CPF_ESCRITO.source, 'g'), ' ');
  const achado = semCpf.match(/\+?\(?\d[\d\s().-]{6,}\d/);
  if (achado && telefoneDoBrasil(achado[0]) && !pareceCpfSolto(achado[0])) {
    return {
      nome: limparNome(semCpf.replace(achado[0], ' ')),
      telefone: achado[0].trim(),
      empresa: null,
    };
  }
  return { nome: limparNome(semCpf), telefone: null, empresa: null };
}

/**
 * Lê a lista colada em "Colar lista": uma pessoa por linha, "Nome, telefone" ou
 * "Nome, telefone, empresa", separada por vírgula, ponto e vírgula ou a
 * tabulação que vem de planilha. Coluna a mais é ignorada; coluna com cara de
 * CPF nunca vira telefone. Devolve o que vale e o que não vale (com o número da
 * linha, para a pessoa achar), ANTES de qualquer coisa ir ao banco. O cabeçalho
 * da planilha é pulado em silêncio; o mesmo WhatsApp duas vezes entra uma só;
 * passando de `vagas` (o que ainda cabe na lista do disparo), o resto fica de fora.
 */
export function lerListaColada(
  texto: string,
  vagas: number = Number.POSITIVE_INFINITY,
): { validas: LinhaColada[]; recusadas: LinhaRecusada[] } {
  const validas: LinhaColada[] = [];
  const recusadas: LinhaRecusada[] = [];
  const vistos = new Set<string>();
  texto.split(/\r?\n/).forEach((bruta, i) => {
    const linha = bruta.trim();
    if (linha === '') return;
    const numero = i + 1;
    if (!/\d/.test(linha) && PARECE_CABECALHO.test(linha)) return;
    const lida = lerUmaLinha(linha);
    const e164 = lida.telefone ? telefoneDoBrasil(lida.telefone) : null;
    if (!lida.telefone || !e164) {
      recusadas.push({ linha: numero, texto: linha, motivo: 'sem_whatsapp' });
    } else if (lida.nome === '') {
      recusadas.push({ linha: numero, texto: linha, motivo: 'sem_nome' });
    } else if (vistos.has(e164)) {
      recusadas.push({ linha: numero, texto: linha, motivo: 'repetida' });
    } else if (validas.length >= vagas) {
      recusadas.push({ linha: numero, texto: linha, motivo: 'acima_do_limite' });
    } else {
      vistos.add(e164);
      validas.push({ linha: numero, nome: lida.nome, telefone: lida.telefone, empresa: lida.empresa });
    }
  });
  return { validas, recusadas };
}

/** "3 pessoas prontas para entrar · 1 linha sem WhatsApp válido (linha 4)". */
export function resumoDaListaColada(
  lida: { validas: readonly unknown[]; recusadas: readonly LinhaRecusada[] },
  maximo: number = 2000,
): string {
  const n = lida.validas.length;
  const partes = [
    n === 0
      ? 'Nenhuma pessoa pronta ainda'
      : `${formatarNumero(n)} ${n === 1 ? 'pessoa pronta' : 'pessoas prontas'} para entrar`,
  ];
  const contar = (motivo: LinhaRecusada['motivo']) => lida.recusadas.filter((r) => r.motivo === motivo);
  const linhas = (rs: readonly LinhaRecusada[]) =>
    rs.length <= 3 ? ` (${rs.length === 1 ? 'linha' : 'linhas'} ${rs.map((r) => r.linha).join(', ')})` : '';
  const semWhats = contar('sem_whatsapp');
  if (semWhats.length > 0) {
    partes.push(
      `${semWhats.length} ${semWhats.length === 1 ? 'linha' : 'linhas'} sem WhatsApp válido${linhas(semWhats)}`,
    );
  }
  const semNome = contar('sem_nome');
  if (semNome.length > 0) {
    partes.push(`${semNome.length} ${semNome.length === 1 ? 'linha' : 'linhas'} sem nome${linhas(semNome)}`);
  }
  const repetidas = contar('repetida');
  if (repetidas.length > 0) {
    partes.push(
      `${repetidas.length} WhatsApp ${repetidas.length === 1 ? 'repetido' : 'repetidos'}${linhas(repetidas)}`,
    );
  }
  const acima = contar('acima_do_limite');
  if (acima.length > 0) {
    partes.push(
      `${formatarNumero(acima.length)} ${acima.length === 1 ? 'fica' : 'ficam'} de fora: a lista do disparo vai até ${formatarNumero(maximo)}`,
    );
  }
  return partes.join(' · ');
}

/**
 * O que o cadastro fez, em português: "2 novas, 1 já estava na base, 1 pediu
 * para não receber." Quem já tinha ficha e já estava na lista do disparo é
 * dito à parte, para "já estava" não parecer que entrou de novo.
 */
export function resumoDoCadastro(
  itens: readonly Pick<ItemDoCadastro, 'status' | 'organization_id'>[],
  idsNaLista: ReadonlySet<string>,
): string {
  const c = {
    novas: 0,
    naBase: 0,
    naLista: 0,
    sair: 0,
    invalido: 0,
    semNome: 0,
    repetidas: 0,
    outraFicha: 0,
    outraPessoa: 0,
    outros: 0,
  };
  for (const i of itens) {
    if (i.status === 'novo') c.novas += 1;
    else if (i.status === 'ja_estava') {
      if (i.organization_id && idsNaLista.has(i.organization_id)) c.naLista += 1;
      else c.naBase += 1;
    } else if (i.status === 'pediu_para_sair') c.sair += 1;
    else if (i.status === 'telefone_invalido') c.invalido += 1;
    else if (i.status === 'nome_obrigatorio') c.semNome += 1;
    else if (i.status === 'repetido') c.repetidas += 1;
    else if (i.status === 'telefone_de_outra_ficha') c.outraFicha += 1;
    else if (i.status === 'numero_de_outra_pessoa') c.outraPessoa += 1;
    else c.outros += 1;
  }
  const partes: string[] = [];
  const n = (x: number) => formatarNumero(x);
  if (c.novas) partes.push(`${n(c.novas)} ${c.novas === 1 ? 'nova' : 'novas'}`);
  if (c.naBase) partes.push(`${n(c.naBase)} já ${c.naBase === 1 ? 'estava' : 'estavam'} na base`);
  if (c.naLista) partes.push(`${n(c.naLista)} já ${c.naLista === 1 ? 'estava' : 'estavam'} na lista`);
  if (c.sair) partes.push(`${n(c.sair)} ${c.sair === 1 ? 'pediu' : 'pediram'} para não receber`);
  if (c.invalido) partes.push(`${n(c.invalido)} com WhatsApp inválido`);
  if (c.semNome) partes.push(`${n(c.semNome)} sem nome`);
  if (c.repetidas) partes.push(`${n(c.repetidas)} ${c.repetidas === 1 ? 'repetida' : 'repetidas'} na lista`);
  if (c.outraFicha) {
    partes.push(`${n(c.outraFicha)} ${c.outraFicha === 1 ? 'é de uma ficha' : 'são de fichas'} que você não vê`);
  }
  if (c.outraPessoa) {
    partes.push(
      `${n(c.outraPessoa)} ${c.outraPessoa === 1 ? 'é número' : 'são números'} de gente de outra ficha`,
    );
  }
  if (c.outros) partes.push(`${n(c.outros)} não ${c.outros === 1 ? 'entrou' : 'entraram'}`);
  if (partes.length === 0) return 'Ninguém entrou na lista.';
  const frase = partes.join(', ');
  return `${frase.charAt(0).toUpperCase()}${frase.slice(1)}.`;
}

/**
 * O resultado de "Adicionar contato" (uma pessoa só), dito com o nome dela.
 * `entrou` diz se o id vai para a lista; quando não vai, a frase é o erro do
 * formulário, e o que foi digitado fica lá para corrigir.
 */
export function fraseDeUmCadastro(
  item: Pick<ItemDoCadastro, 'status' | 'nome' | 'organization_id'> & { ficha?: string | null },
  jaNaLista: boolean,
): { texto: string; entrou: boolean } {
  const quem = primeiroNome(item.nome) || 'A pessoa';
  const ficha = item.ficha ? ` (“${item.ficha}”)` : '';
  switch (item.status) {
    case 'novo':
      return { texto: `${quem} entrou na lista e virou uma ficha nova em Prospectados.`, entrou: true };
    case 'ja_estava':
      return jaNaLista
        ? { texto: `${quem} já está na lista.`, entrou: true }
        : { texto: `Esse WhatsApp já tinha ficha${ficha}: entrou a ficha que já existe.`, entrou: true };
    case 'pediu_para_sair':
      return { texto: 'Esse WhatsApp pediu para não receber mensagens nossas. Não entra na lista.', entrou: false };
    case 'telefone_invalido':
      return { texto: 'Confira o WhatsApp: DDD e número, como (84) 99999-0101.', entrou: false };
    case 'nome_obrigatorio':
      return { texto: 'Falta o nome.', entrou: false };
    case 'telefone_de_outra_ficha':
      return { texto: 'Esse WhatsApp é de uma ficha que você não pode ver. Não entra na lista.', entrou: false };
    case 'numero_de_outra_pessoa':
      return {
        texto: `Esse WhatsApp é de uma pessoa da ficha${ficha || ' de outro parceiro'}, que recebe por outro número. Não entra na lista.`,
        entrou: false,
      };
    default:
      return { texto: 'Não deu para pôr essa pessoa na lista.', entrou: false };
  }
}

/**
 * Quem não tem empresa na ficha (a ficha nasceu com o nome da pessoa) e vai
 * receber uma mensagem que fala da empresa: o aviso, antes de sair "a Mariana
 * Souza pode estar na feira".
 */
export function avisoSemEmpresa(
  pessoa: { nome: string | null; empresa: string },
  usaEmpresa: boolean,
): string | null {
  if (!usaEmpresa || !pessoa.nome) return null;
  const igual = (a: string) => a.replace(/\s+/g, ' ').trim().toLowerCase();
  if (igual(pessoa.empresa) !== igual(pessoa.nome)) return null;
  return `Sem empresa: a mensagem vai dizer “${pessoa.empresa.replace(/\s+/g, ' ').trim()}” no lugar da empresa.`;
}

// ---------------------------------------------------------------------------
// A mensagem em pedaços: o que é igual para todos e o que muda por pessoa
// ---------------------------------------------------------------------------

const ROTULOS_DAS_VARIAVEIS: Record<string, string> = {
  nome: 'Nome',
  empresa: 'Empresa',
  categoria: 'Categoria',
  cidade: 'Cidade',
  origem: 'Onde achamos',
  saudacao: 'Saudação',
  atendente: 'Quem envia',
};

/** Como a tela chama uma variável: `{{nome}}` vira "Nome"; `{{nome_do_evento}}`, "Nome do evento". */
export function rotuloDaVariavel(variavel: string): string {
  const conhecido = ROTULOS_DAS_VARIAVEIS[variavel];
  if (conhecido) return conhecido;
  const solto = variavel.replace(/_+/g, ' ').trim();
  return solto ? `${solto.charAt(0).toUpperCase()}${solto.slice(1)}` : variavel;
}

export type Pedaco =
  /** Texto do modelo, igual para todo mundo. */
  | { tipo: 'texto'; texto: string }
  /** O valor que muda de pessoa para pessoa (o nome, a empresa): vai sublinhado. */
  | { tipo: 'valor'; texto: string; variavel: string }
  /** Um campo ainda sem valor, como etiqueta: "[Nome]". */
  | { tipo: 'campo'; texto: string; variavel: string };

/** O valor como a Meta aceita (`app.modelo_parametro_limpo`): sem quebra, sem espaço repetido. */
function valorLimpo(valor: string | null | undefined): string | null {
  const limpo = (valor ?? '').replace(/\s+/g, ' ').trim();
  return limpo === '' ? null : limpo;
}

/**
 * Corta o texto de um modelo nos seus pedaços. Sem `valores`, cada variável
 * vira etiqueta ("[Nome]") — é o cartão da mensagem. Com valores, a variável
 * vira o valor, marcado como "muda por pessoa" se estiver em `marcadas` (sem a
 * lista, todas estão); variável sem valor continua etiqueta.
 */
export function pedacosDaMensagem(
  corpo: string,
  valores?: Readonly<Record<string, string | null | undefined>>,
  marcadas?: readonly string[],
): Pedaco[] {
  const pedacos: Pedaco[] = [];
  const juntarTexto = (texto: string) => {
    if (texto === '') return;
    const ultimo = pedacos[pedacos.length - 1];
    if (ultimo?.tipo === 'texto') ultimo.texto += texto;
    else pedacos.push({ tipo: 'texto', texto });
  };
  let depois = 0;
  for (const m of corpo.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    const inicio = m.index ?? 0;
    juntarTexto(corpo.slice(depois, inicio));
    const variavel = m[1] ?? '';
    const valor = valores ? valorLimpo(valores[variavel]) : null;
    if (valor === null) pedacos.push({ tipo: 'campo', texto: `[${rotuloDaVariavel(variavel)}]`, variavel });
    else if (!marcadas || marcadas.includes(variavel)) pedacos.push({ tipo: 'valor', texto: valor, variavel });
    else juntarTexto(valor);
    depois = inicio + m[0].length;
  }
  juntarTexto(corpo.slice(depois));
  return pedacos;
}

/**
 * Os pedaços conferidos contra o corpo que o BANCO montou para a pessoa
 * (`envio_em_massa_previa`). Se juntar os pedaços não der exatamente aquele
 * corpo — o cumprimento trocou de período, um valor foi limpo de outro jeito —,
 * vale o corpo do banco, sem marcação: a promessa da tela é o texto exato; o
 * sublinhado é um extra.
 */
export function pedacosConferidos(pedacos: readonly Pedaco[], corpoDoBanco: string): Pedaco[] {
  const junto = pedacos.map((p) => p.texto).join('');
  if (junto === corpoDoBanco && !pedacos.some((p) => p.tipo === 'campo')) return pedacos.map((p) => ({ ...p }));
  return corpoDoBanco === '' ? [] : [{ tipo: 'texto', texto: corpoDoBanco }];
}

/**
 * O texto que a pessoa recebe NA HORA EM QUE SAI. O banco monta a prévia com a
 * saudação de agora; se a mensagem sai em outro período (amanhã de manhã, por
 * exemplo), o "{{saudacao}}" muda. A conta: confere os pedaços com a saudação
 * de agora contra o corpo do banco e, batendo, refaz com a saudação da saída.
 * Não batendo, vale o corpo do banco, como em `pedacosConferidos`.
 */
export function pedacosNaSaida(r: {
  corpo: string;
  valores: Readonly<Record<string, string | null | undefined>>;
  marcadas: readonly string[];
  corpoDoBanco: string;
  saudacaoAgora: string;
  saudacaoNaSaida: string;
}): Pedaco[] {
  const agora = pedacosDaMensagem(r.corpo, { ...r.valores, saudacao: r.saudacaoAgora }, r.marcadas);
  const conferidos = pedacosConferidos(agora, r.corpoDoBanco);
  const bateu = conferidos.length === agora.length && conferidos.every((p, i) => p.texto === agora[i]?.texto);
  if (!bateu || r.saudacaoAgora === r.saudacaoNaSaida) return conferidos;
  return pedacosDaMensagem(r.corpo, { ...r.valores, saudacao: r.saudacaoNaSaida }, r.marcadas);
}

// ---------------------------------------------------------------------------
// A hora de Natal, a hora em que o disparo começa de verdade e a frase-resumo
// ---------------------------------------------------------------------------

/** Natal é UTC-3 o ano todo (sem horário de verão desde 2019). */
const NATAL_MS = -3 * 3_600_000;

function emNatal(d: Date): { dia: string; hora: number; minuto: string } {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const v = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return { dia: `${v('day')}/${v('month')}/${v('year')}`, hora: Number(v('hour')) % 24, minuto: v('minute') };
}

/** "Bom dia" / "Boa tarde" / "Boa noite" pelo relógio de Natal, como `app.saudacao_do_momento`. */
export function saudacaoDoMomento(agora: Date = new Date()): string {
  const { hora } = emNatal(agora);
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** "14:05", no relógio de Natal: a hora que aparece no balão. */
export function horaCurta(d: Date): string {
  const { hora, minuto } = emNatal(d);
  return `${String(hora).padStart(2, '0')}:${minuto}`;
}

/** "Hoje", "Amanhã" ou "20/11": a pílula de dia da conversa no celular. */
export function diaDaConversa(d: Date, agora: Date = new Date()): string {
  const alvo = emNatal(d).dia;
  if (alvo === emNatal(agora).dia) return 'Hoje';
  if (alvo === emNatal(new Date(agora.getTime() + 86_400_000)).dia) return 'Amanhã';
  return alvo.slice(0, 5);
}

/** "hoje às 9h", "amanhã às 14h30", "em 20/11 às 9h" — sempre no relógio de Natal. */
export function quandoPorExtenso(inicio: Date, agora: Date = new Date()): string {
  const { hora, minuto } = emNatal(inicio);
  const horas = `${hora}h${minuto === '00' ? '' : minuto}`;
  const dia = diaDaConversa(inicio, agora);
  return `${dia === 'Hoje' ? 'hoje' : dia === 'Amanhã' ? 'amanhã' : `em ${dia}`} às ${horas}`;
}

/** Uma faixa de envio de `channel_windows`: dia da semana (0 = domingo) e horas decimais de Natal. */
export type FaixaDeEnvio = { dow: number; de: number; ate: number };

/**
 * A primeira hora em que o WhatsApp pode abrir conversa a partir de `instante`,
 * pela mesma regra de `app.janela_do_canal`: as faixas do dia (sem feriado) e,
 * fechada, a primeira faixa dos dias seguintes. Dentro de uma faixa, é o
 * próprio instante. `feriados` são datas "AAAA-MM-DD" de Natal. Sem abertura em
 * 31 dias, `null`.
 */
export function proximaAbertura(
  instante: Date,
  faixas: readonly FaixaDeEnvio[],
  feriados: ReadonlySet<string>,
): Date | null {
  const local = new Date(instante.getTime() + NATAL_MS);
  const hora = local.getUTCHours() + local.getUTCMinutes() / 60 + local.getUTCSeconds() / 3600;
  for (let k = 0; k <= 31; k += 1) {
    const dia = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + k));
    if (feriados.has(dia.toISOString().slice(0, 10))) continue;
    const doDia = faixas.filter((f) => f.dow === dia.getUTCDay()).sort((a, b) => a.de - b.de);
    for (const f of doDia) {
      if (k === 0 && hora >= f.ate) continue;
      if (k === 0 && hora >= f.de) return instante;
      return new Date(dia.getTime() + Math.round(f.de * 60) * 60_000 - NATAL_MS);
    }
  }
  return null;
}

/** Quando o disparo começa a sair de verdade, e por quê. */
export type ComecoDoEnvio = {
  quando: Date;
  /** `agora`; `agendado` (no horário escolhido); `abertura` (empurrado para a próxima abertura). */
  tipo: 'agora' | 'agendado' | 'abertura';
};

/**
 * A hora REAL em que a primeira mensagem sai. Fora da janela de envio (depois
 * das 17h45, fim de semana, feriado) nada sai até a próxima abertura — e lá o
 * cumprimento é "Bom dia!". Para "agora", quem diz é o banco (`janelaAberta` e
 * `abreEm`); agendado, as faixas e os feriados, a partir do horário escolhido.
 */
export function comecoDoEnvio(r: {
  agora: Date;
  /** O horário escolhido em "Agendar"; `null` é agora. */
  inicio: Date | null;
  janelaAberta: boolean | null;
  abreEm: Date | null;
  faixas: readonly FaixaDeEnvio[] | null;
  feriados: ReadonlySet<string>;
}): ComecoDoEnvio {
  if (r.inicio && r.inicio.getTime() > r.agora.getTime()) {
    const abre = r.faixas ? proximaAbertura(r.inicio, r.faixas, r.feriados) : null;
    return abre && abre.getTime() > r.inicio.getTime()
      ? { quando: abre, tipo: 'abertura' }
      : { quando: r.inicio, tipo: 'agendado' };
  }
  if (r.janelaAberta === false && r.abreEm && r.abreEm.getTime() > r.agora.getTime()) {
    return { quando: r.abreEm, tipo: 'abertura' };
  }
  if (r.janelaAberta === null && r.faixas) {
    const abre = proximaAbertura(r.agora, r.faixas, r.feriados);
    if (abre && abre.getTime() > r.agora.getTime()) return { quando: abre, tipo: 'abertura' };
  }
  return { quando: r.agora, tipo: 'agora' };
}

export const ROTULO_DA_ASSINATURA: Record<Assinatura, string> = {
  marca: `em nome da ${EMPRESA.nome}`,
  eu: 'assinada por você',
  responsavel: 'assinada pelo responsável de cada parceiro',
  revezar: 'dividida entre atendentes',
  // Não se escolhe na tela (o lote da casa é criado pelo banco), mas o mapa é total.
  komune: `sem assinatura, em nome da ${EMPRESA.nome}`,
};

/**
 * A frase grande da barra de enviar: para quantos, em nome de quem e QUANDO
 * começa de verdade. "Vai para 3 pessoas, agora, em nome da KOMUNE." Fora do
 * horário de envio: "… Começa a sair amanhã às 8h, quando abre o horário de envio."
 */
export function fraseDoResumo(r: {
  pessoas: number;
  comeco: ComecoDoEnvio;
  assinatura: Assinatura;
  agora: Date;
}): string {
  if (r.pessoas <= 0) return 'Ninguém para receber ainda. Comece em “Quem recebe”.';
  const quem = `${formatarNumero(r.pessoas)} ${r.pessoas === 1 ? 'pessoa' : 'pessoas'}`;
  const assina = ROTULO_DA_ASSINATURA[r.assinatura];
  if (r.comeco.tipo === 'agora') return `Vai para ${quem}, agora, ${assina}.`;
  const quando = quandoPorExtenso(r.comeco.quando, r.agora);
  return r.comeco.tipo === 'abertura'
    ? `Vai para ${quem}, ${assina}. Começa a sair ${quando}, quando abre o horário de envio.`
    : `Vai para ${quem}, ${assina}. Começa a sair ${quando}.`;
}

/**
 * A linha miúda debaixo da frase: custo na Meta, quanto tempo leva, quanto do
 * limite ainda cabe e o que fica para depois ou de fora. O que cabe desconta o
 * que os outros disparos já vão mandar (`naFila`): é a mesma conta do "ficam
 * para o próximo dia útil", e as duas não podem se contradizer. Se o disparo só
 * começa outro dia, o "hoje" não vale: conta o limite cheio daquele dia.
 * "≈ R$ 1,02 na Meta · leva cerca de 3 min · hoje ainda cabem 1.997 de 2.000".
 */
export function detalheDoResumo(r: {
  custo: number | null;
  duracao: string | null;
  limite: { teto: number; sobra: number; naFila: number } | null;
  /** Quantos ABREM conversa (os de janela aberta não gastam o limite). */
  abrem: number;
  comecaHoje: boolean;
  /** Os da lista que não vão receber (bloqueio ou mensagem recente). */
  deFora: number;
}): string {
  const partes: string[] = [];
  if (r.custo !== null) partes.push(r.custo === 0 ? 'grátis na Meta' : `≈ ${formatarReais(r.custo)} na Meta`);
  if (r.duracao && r.duracao !== '—') partes.push(`leva ${r.duracao}`);
  if (r.limite) {
    const divisao = divisaoDoDia(r.abrem, r.comecaHoje ? r.limite.sobra : r.limite.teto, r.limite.naFila);
    if (r.comecaHoje) {
      const cabem = Math.max(r.limite.sobra - r.limite.naFila, 0);
      partes.push(`hoje ainda cabem ${formatarNumero(cabem)} de ${formatarNumero(r.limite.teto)}`);
    }
    if (divisao && divisao.depois > 0) {
      partes.push(
        `${formatarNumero(divisao.depois)} ${divisao.depois === 1 ? 'fica' : 'ficam'} para o ${r.comecaHoje ? 'próximo dia útil' : 'dia útil seguinte'}`,
      );
    }
  }
  if (r.deFora > 0) {
    partes.push(`${formatarNumero(r.deFora)} da lista ${r.deFora === 1 ? 'fica' : 'ficam'} de fora`);
  }
  return partes.join(' · ');
}
