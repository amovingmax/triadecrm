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
// =============================================================================

import { iguaisEmTempoConstante } from '../_compartilhado/assinatura.ts';

/** Teto do cabeçalho `Authorization`, em caracteres. */
export const TAMANHO_MAXIMO_DO_CABECALHO = 1024;

const BASIC = /^Basic ([A-Za-z0-9+/=_-]+)$/i;

const codificador = new TextEncoder();
const decodificador = new TextDecoder();

export type MotivoDaRecusa =
  | 'cabecalho_ausente'
  | 'cabecalho_grande_demais'
  | 'esquema_invalido'
  | 'base64_invalido'
  | 'sem_segredo'
  | 'credencial_invalida';

export type ResultadoDaCredencial =
  { ok: true; chave: 'atual' | 'anterior' } | { ok: false; motivo: MotivoDaRecusa };

export type CredencialLida =
  | { ok: true; usuario: string | null; senha: string }
  | { ok: false; motivo: Exclude<MotivoDaRecusa, 'sem_segredo' | 'credencial_invalida'> };

/**
 * Decodifica o cabeçalho. `usuario` é `null` quando a credencial não tem `:`
 * (aí ela inteira é a senha).
 */
export function lerBasic(cabecalho: string | null): CredencialLida {
  if (cabecalho === null || cabecalho.length === 0)
    return { ok: false, motivo: 'cabecalho_ausente' };
  if (cabecalho.length > TAMANHO_MAXIMO_DO_CABECALHO) {
    return { ok: false, motivo: 'cabecalho_grande_demais' };
  }
  const achado = BASIC.exec(cabecalho);
  if (!achado) return { ok: false, motivo: 'esquema_invalido' };

  let binario: string;
  try {
    binario = atob(achado[1].replaceAll('-', '+').replaceAll('_', '/'));
  } catch {
    return { ok: false, motivo: 'base64_invalido' };
  }
  // `atob` devolve um byte por caractere; a credencial é UTF-8.
  const texto = decodificador.decode(Uint8Array.from(binario, (c) => c.charCodeAt(0)));

  const doisPontos = texto.indexOf(':');
  if (doisPontos < 0) return { ok: true, usuario: null, senha: texto };
  return { ok: true, usuario: texto.slice(0, doisPontos), senha: texto.slice(doisPontos + 1) };
}

async function resumo(valor: string): Promise<string> {
  const bruto = await crypto.subtle.digest('SHA-256', codificador.encode(valor));
  return Array.from(new Uint8Array(bruto))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Confere o cabeçalho contra a chave atual e, se houver, a anterior.
 * Segredo vazio não conta: sem nenhum segredo de verdade, nada passa.
 */
export async function conferirCredencial(opcoes: {
  cabecalho: string | null;
  segredo: string;
  segredoAnterior?: string | null;
  usuarioExigido?: string | null;
}): Promise<ResultadoDaCredencial> {
  const atual = opcoes.segredo;
  const anterior = opcoes.segredoAnterior ?? '';
  if (atual.length === 0 && anterior.length === 0) return { ok: false, motivo: 'sem_segredo' };

  const lida = lerBasic(opcoes.cabecalho);
  if (!lida.ok) return lida;

  const daSenha = await resumo(lida.senha);
  // Um por linha, de propósito: acertar a chave atual não pula a conferência
  // da anterior. (O que falta comparar é só o que não está configurado.)
  const bateAtual = atual.length > 0 && iguaisEmTempoConstante(daSenha, await resumo(atual));
  const bateAnterior =
    anterior.length > 0 && iguaisEmTempoConstante(daSenha, await resumo(anterior));

  const exigido = opcoes.usuarioExigido ?? '';
  const bateUsuario =
    exigido.length === 0 ||
    (lida.usuario !== null &&
      iguaisEmTempoConstante(await resumo(lida.usuario), await resumo(exigido)));

  if (!bateUsuario || !(bateAtual || bateAnterior)) {
    return { ok: false, motivo: 'credencial_invalida' };
  }
  return { ok: true, chave: bateAtual ? 'atual' : 'anterior' };
}
