/**
 * A passada de geocodificação (RF-ROT-01).
 *
 * Trabalho de uma vez só, não laço: as perguntas acabam. A base de hoje são 21
 * perguntas (uma por bairro e uma por cidade sem bairro), e a cada nova ficha
 * com um bairro inédito entra uma pergunta a mais. Por isso o comando é
 * `workers rotas --geocodificar`, e não um serviço de pé o dia inteiro batendo
 * num serviço público de graça.
 *
 * O ritmo é o do `criarClienteDoNominatim`: uma requisição por vez, com o
 * intervalo da política. 21 perguntas levam ~23 s, e é para levar mesmo.
 */
import { gravarGeocodificacao, perguntasPendentes, type ClienteDoBanco } from './banco';

import type { ClienteDoNominatim } from './nominatim';
import type { Logger } from '../lib/log';

export type ResumoDaGeocodificacao = {
  perguntas: number;
  encontradas: number;
  vazias: number;
  falhas: number;
  fichasAtualizadas: number;
  porPrecisao: Record<string, number>;
};

export async function geocodificarPendentes(argumentos: {
  cliente: ClienteDoBanco;
  nominatim: ClienteDoNominatim;
  logger: Logger;
  limite?: number;
}): Promise<ResumoDaGeocodificacao> {
  const { cliente, nominatim, logger } = argumentos;
  const perguntas = await perguntasPendentes(cliente, argumentos.limite ?? 50);

  const resumo: ResumoDaGeocodificacao = {
    perguntas: perguntas.length,
    encontradas: 0,
    vazias: 0,
    falhas: 0,
    fichasAtualizadas: 0,
    porPrecisao: {},
  };

  for (const pergunta of perguntas) {
    try {
      const resposta = await nominatim.buscar(pergunta.consulta);
      const gravado = await gravarGeocodificacao(cliente, pergunta, resposta);

      if (resposta.encontrado) {
        resumo.encontradas += 1;
        resumo.fichasAtualizadas += gravado.aplicadas;
        const chave = gravado.precisao ?? 'sem_precisao';
        resumo.porPrecisao[chave] = (resumo.porPrecisao[chave] ?? 0) + 1;
        logger.info('lugar geocodificado', {
          consulta: pergunta.consulta,
          escopo: pergunta.escopo,
          precisao: gravado.precisao,
          raio_m: gravado.raio_m,
          fichas: gravado.aplicadas,
        });
      } else {
        resumo.vazias += 1;
        // Fica gravado como "não encontrado" de propósito: sem isso, a mesma
        // pergunta sem resposta voltaria à fila todo dia, para sempre.
        logger.warn('o OpenStreetMap não conhece este lugar', { consulta: pergunta.consulta });
      }
    } catch (erro) {
      resumo.falhas += 1;
      logger.error('a geocodificação falhou', {
        consulta: pergunta.consulta,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  return resumo;
}
