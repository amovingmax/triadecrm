// =============================================================================
// TRIADE — a credencial do Grupo OLX (`Authorization: Basic`)
//
// O Grupo OLX não assina o corpo: manda, em cada lead, o cabeçalho
//
//   Authorization: Basic base64("<usuario>:<SECRET_KEY>")
//
// A documentação mostra o usuário `vivareal`; a SECRET_KEY é uma por CRM, dada
// na homologação (não identifica o anunciante). No validador oficial de
// endpoint quem digita o token é a pessoa que testa.
//
// Este módulo é puro: recebe o cabeçalho e os valores esperados e responde se
// confere. Ler segredo, responder HTTP e registrar log são do `index.ts`.
//
// COMO CONFERE, E POR QUÊ
// -----------------------------------------------------------------------------
//   1. cabeçalho de até 1 KB — o Basic legítimo tem algumas dezenas de bytes, e
//      decodificar o que vier sem teto seria trabalho de graça para quem sonda;
//   2. formato `Basic <base64>` (o esquema não diferencia maiúsculas, RFC 7235;
//      aceita também o base64 de URL, com `-` e `_`, e sem o `=` do fim);
//   3. a senha é tudo depois do PRIMEIRO `:` — a SECRET_KEY pode ter `:` dentro,
//      o usuário não (RFC 7617). Sem `:` nenhum, a credencial inteira é a senha;
//   4. compara o SHA-256 da senha com o SHA-256 de cada segredo aceito, em
//      tempo constante. Comparar os resumos, e não os textos, faz os dois lados
//      terem sempre 64 caracteres: o tempo não conta nem o comprimento da chave.
//      Os dois segredos (o atual e o anterior, na troca de chave) são sempre
//      conferidos, sem atalho, para que acertar um não seja mais rápido.
//   5. o usuário só é exigido quando configurado, e do mesmo jeito.
//
// A CHAVE DE TESTE (10/11/2026)
// -----------------------------------------------------------------------------
// Na homologação, o suporte do Grupo OLX testa o endpoint com a chave PÚBLICA
// da página de segurança, não com a nossa. Ela entra como um terceiro segredo,
// opcional (`segredoTeste`), conferido do mesmo jeito e no mesmo tempo que os
// outros dois. Quem acerta a chave de teste recebe `chave: 'teste'`, e o
// `index.ts` responde 200 SEM GRAVAR: uma chave que qualquer um lê na internet
// não pode criar lead no CRM. Se por engano a de teste for igual à atual, vale
// `teste` — na dúvida, não grava.
//
// O QUE O VALIDADOR OFICIAL MANDA (medido em 10/11/2026)
// -----------------------------------------------------------------------------
// O validador de endpoint põe `Basic ` na frente do que a pessoa digita em
// "Token", sem codificar nada. Digitado o base64 da documentação, chega o
// cabeçalho certo; digitada a chave crua, chega `Basic 594F…`; digitado o
// cabeçalho inteiro, chega `Basic Basic dml2…`. Para a homologação não depender
// de qual dos três o suporte digita, os dois últimos também são lidos:
//   - um `Basic ` repetido é ignorado;
//   - o texto depois de `Basic ` também é conferido CRU, como senha sem
//     usuário (formato `chave_crua`), além de decodificado.
// Nenhum dos dois abre a porta sem a chave: a senha continua tendo de ser um
// dos segredos configurados, e as duas leituras são sempre conferidas, sem
// atalho.
// =============================================================================

import { iguaisEmTempoConstante } from '../_compartilhado/assinatura.ts';

/** Teto do cabeçalho `Authorization`, em caracteres. */
export const TAMANHO_MAXIMO_DO_CABECALHO = 1024;

/** `Basic <token>`; um segundo `Basic ` (o validador dobra o prefixo) é ignorado. */
const BASIC = /^Basic (?:Basic )?([A-Za-z0-9+/=_-]+)$/i;

const codificador = new TextEncoder();
const decodificador = new TextDecoder();

export type MotivoDaRecusa =
  | 'cabecalho_ausente'
  | 'cabecalho_grande_demais'
  | 'esquema_invalido'
  | 'base64_invalido'
  | 'sem_segredo'
  | 'credencial_invalida';

/**
 * Como a credencial veio, para o log e para a resposta do teste. Nunca leva o
 * usuário nem a senha: só a forma — base64 com usuário antes do `:`, base64
 * sem usuário, ou a chave crua depois de `Basic `.
 */
export type FormatoDaCredencial = 'usuario_e_senha' | 'so_senha' | 'chave_crua';

export type ResultadoDaCredencial =
  | { ok: true; chave: 'atual' | 'anterior' | 'teste'; formato: FormatoDaCredencial }
  | { ok: false; motivo: MotivoDaRecusa };

export type CredencialLida =
  | { ok: true; usuario: string | null; senha: string }
  | { ok: false; motivo: Exclude<MotivoDaRecusa, 'sem_segredo' | 'credencial_invalida'> };

type TokenLido =
  | { ok: true; token: string }
  | { ok: false; motivo: 'cabecalho_ausente' | 'cabecalho_grande_demais' | 'esquema_invalido' };

/** O texto depois de `Basic ` (ou de `Basic Basic `), sem decodificar. */
function lerToken(cabecalho: string | null): TokenLido {
  if (cabecalho === null || cabecalho.length === 0)
    return { ok: false, motivo: 'cabecalho_ausente' };
  if (cabecalho.length > TAMANHO_MAXIMO_DO_CABECALHO) {
    return { ok: false, motivo: 'cabecalho_grande_demais' };
  }
  const achado = BASIC.exec(cabecalho);
  if (!achado) return { ok: false, motivo: 'esquema_invalido' };
  return { ok: true, token: achado[1] };
}

/** O token em base64 decodificado e partido no primeiro `:`; `null` se não é base64. */
function decodificar(token: string): { usuario: string | null; senha: string } | null {
  let binario: string;
  try {
    binario = atob(token.replaceAll('-', '+').replaceAll('_', '/'));
  } catch {
    return null;
  }
  // `atob` devolve um byte por caractere; a credencial é UTF-8.
  const texto = decodificador.decode(Uint8Array.from(binario, (c) => c.charCodeAt(0)));

  const doisPontos = texto.indexOf(':');
  if (doisPontos < 0) return { usuario: null, senha: texto };
  return { usuario: texto.slice(0, doisPontos), senha: texto.slice(doisPontos + 1) };
}

/**
 * Decodifica o cabeçalho. `usuario` é `null` quando a credencial não tem `:`
 * (aí ela inteira é a senha).
 */
export function lerBasic(cabecalho: string | null): CredencialLida {
  const lido = lerToken(cabecalho);
  if (!lido.ok) return lido;
  const credencial = decodificar(lido.token);
  if (credencial === null) return { ok: false, motivo: 'base64_invalido' };
  return { ok: true, ...credencial };
}

async function resumo(valor: string): Promise<string> {
  const bruto = await crypto.subtle.digest('SHA-256', codificador.encode(valor));
  return Array.from(new Uint8Array(bruto))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type Candidata = { usuario: string | null; senha: string; formato: FormatoDaCredencial };
type Conferida = { chave: 'atual' | 'anterior' | 'teste'; formato: FormatoDaCredencial } | null;

/**
 * Confere o cabeçalho contra a chave atual e, se houver, a anterior e a de
 * teste. Segredo vazio não conta: sem nenhum segredo de verdade, nada passa.
 */
export async function conferirCredencial(opcoes: {
  cabecalho: string | null;
  segredo: string;
  segredoAnterior?: string | null;
  segredoTeste?: string | null;
  usuarioExigido?: string | null;
}): Promise<ResultadoDaCredencial> {
  const atual = opcoes.segredo;
  const anterior = opcoes.segredoAnterior ?? '';
  const teste = opcoes.segredoTeste ?? '';
  if (atual.length === 0 && anterior.length === 0 && teste.length === 0) {
    return { ok: false, motivo: 'sem_segredo' };
  }

  const lido = lerToken(opcoes.cabecalho);
  if (!lido.ok) return lido;

  // Duas leituras do mesmo token: decodificado (o certo, pela RFC 7617) e cru
  // (o validador oficial com a chave digitada). A decodificada vem primeiro.
  const decodificada = decodificar(lido.token);
  const candidatas: Candidata[] = [];
  if (decodificada !== null) {
    candidatas.push({
      ...decodificada,
      formato: decodificada.usuario === null ? 'so_senha' : 'usuario_e_senha',
    });
  }
  candidatas.push({ usuario: null, senha: lido.token, formato: 'chave_crua' });

  const [resumoAtual, resumoAnterior, resumoTeste] = await Promise.all([
    resumo(atual),
    resumo(anterior),
    resumo(teste),
  ]);
  const exigido = opcoes.usuarioExigido ?? '';
  const resumoExigido = await resumo(exigido);

  let achada: Conferida = null;
  for (const c of candidatas) {
    const daSenha = await resumo(c.senha);
    // Um por linha, de propósito: acertar uma chave não pula a conferência das
    // outras, nem a da outra leitura. (O que falta comparar é só o que não
    // está configurado.)
    const bateAtual = atual.length > 0 && iguaisEmTempoConstante(daSenha, resumoAtual);
    const bateAnterior = anterior.length > 0 && iguaisEmTempoConstante(daSenha, resumoAnterior);
    const bateTeste = teste.length > 0 && iguaisEmTempoConstante(daSenha, resumoTeste);
    const bateUsuario =
      exigido.length === 0 ||
      (c.usuario !== null && iguaisEmTempoConstante(await resumo(c.usuario), resumoExigido));

    if (achada === null && bateUsuario && (bateAtual || bateAnterior || bateTeste)) {
      // A de teste vence: se ela coincidir com outra, a chamada não grava.
      achada = {
        chave: bateTeste ? 'teste' : bateAtual ? 'atual' : 'anterior',
        formato: c.formato,
      };
    }
  }

  if (achada === null) {
    // Sem base64 válido e sem a chave crua conferindo, o motivo do log é o base64.
    return { ok: false, motivo: decodificada === null ? 'base64_invalido' : 'credencial_invalida' };
  }
  return { ok: true, ...achada };
}
