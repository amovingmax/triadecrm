import type { ReactNode } from 'react';

import type { FunctionReturns, Temperature } from '@komune/schema';

/**
 * Os tipos da tela de Relatórios (RF-REL-01: toda métrica é uma consulta com dono).
 *
 * Nenhuma linha é digitada à mão: cada uma é o retorno de uma função do banco,
 * lido de `packages/schema` (gerado por `pnpm db:types`). Quando a migração mudar
 * uma coluna, o typecheck quebra aqui, e não no navegador da Heloísa.
 */

export type LinhaFunil = FunctionReturns<'relatorio_funil'>[number];
export type LinhaCategoria = FunctionReturns<'relatorio_por_categoria'>[number];
export type LinhaBairro = FunctionReturns<'relatorio_por_bairro'>[number];
export type LinhaPessoa = FunctionReturns<'relatorio_por_responsavel'>[number];
export type LinhaHorario = FunctionReturns<'relatorio_por_horario'>[number];
export type LinhaFonte = FunctionReturns<'relatorio_por_fonte'>[number];

/** Uma temperatura da escala e quantas organizações estão nela hoje. */
export type FatiaTermica = { temperatura: Temperature; organizacoes: number };

/**
 * Uma coluna de tabela densa. A MESMA definição desenha a célula e escreve a linha
 * do CSV: exportar "o que está na tela" só é verdade se a tela e o arquivo saírem da
 * mesma fonte. `celula` é opcional e serve para o que tem desenho (barra térmica,
 * etiqueta); quando falta, a tabela usa `texto`.
 */
export type Coluna<L> = {
  chave: string;
  rotulo: string;
  /** Frase de apoio no cabeçalho (`title`) — a definição do número, em português. */
  ajuda?: string;
  /** Números vão para a direita e para a IBM Plex Mono; texto fica à esquerda. */
  numero?: boolean;
  /** Texto puro: é o que vai para o CSV e o que a célula mostra quando não há `celula`. */
  texto: (linha: L) => string;
  /** Desenho da célula quando ela é mais que o texto. */
  celula?: (linha: L) => ReactNode;
  /** Deixa a coluna grudada à esquerda no celular (a identidade da linha). */
  fixa?: boolean;
  /**
   * Coluna que só existe no arquivo. Serve para o dado que a tabela já mostra de
   * outro jeito (a cidade, que vira faixa de grupo) e que a planilha precisa ter em
   * toda linha para poder ser filtrada.
   */
  soNoCsv?: boolean;
  /**
   * Classe extra na coluna inteira (cabeçalho e células). Serve para esconder no
   * celular a coluna que é folga de leitura e não número: `hidden md:table-cell`
   * tira a coluna da tela estreita sem tirá-la do CSV.
   */
  classe?: string;
};

/** Os painéis da tela, na ordem da barra. */
export type ChavePainel =
  | 'semana'
  | 'funil'
  | 'categorias'
  | 'bairros'
  | 'pessoas'
  | 'horarios'
  | 'fontes'
  | 'base';

export type DefinicaoPainel = {
  chave: ChavePainel;
  rotulo: string;
  titulo: string;
  /** O que este painel responde, em uma frase. */
  descricao: string;
};

export const PAINEIS: readonly DefinicaoPainel[] = [
  {
    chave: 'semana',
    rotulo: 'Semana',
    titulo: 'O relatório de segunda',
    descricao:
      'O que a semana rendeu, em texto pronto para ler no celular: o número e o que ele quer dizer.',
  },
  {
    chave: 'funil',
    rotulo: 'Funil',
    titulo: 'Funil por etapa e conversão',
    descricao:
      'Quantos negócios estão em cada etapa hoje e quanto da coorte do período chegou até ali.',
  },
  {
    chave: 'categorias',
    rotulo: 'Categorias',
    titulo: 'Densidade por categoria',
    descricao: 'Onde ainda há alvo para bater e onde a categoria secou sem publicar.',
  },
  {
    chave: 'bairros',
    rotulo: 'Bairros',
    titulo: 'Cobertura por bairro',
    descricao: 'O corte de zona que monta a rota: alvos, contato e portas por bairro.',
  },
  {
    chave: 'pessoas',
    rotulo: 'Pessoas',
    titulo: 'Atividade por responsável',
    descricao: 'Portas, ligações, visitas, reuniões e o prazo das próximas ações de cada pessoa.',
  },
  {
    chave: 'horarios',
    rotulo: 'Horários',
    titulo: 'Eficiência por faixa de horário',
    descricao: 'A que horas e por qual canal a porta abre. É o que decide quando ligar.',
  },
  {
    chave: 'fontes',
    rotulo: 'Fontes',
    titulo: 'Aproveitamento por fonte',
    descricao:
      'De cada fonte: quantos entraram, quantos responderam, autorizaram e publicaram.',
  },
  {
    chave: 'base',
    rotulo: 'Base',
    titulo: 'A base por temperatura',
    descricao: 'Como a base está dividida entre frio, morno, quente e cliente agora.',
  },
];

export function painelDaUrl(valor: string | string[] | undefined): ChavePainel {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  const achado = PAINEIS.find((p) => p.chave === bruto);
  return achado?.chave ?? 'semana';
}

/**
 * O painel da semana não obedece à barra de período: ele é recortado pela SEMANA
 * civil, e tem seletor próprio. Mostrar a barra de 7/30 dias ali seria oferecer um
 * controle que não muda nada na tela.
 */
export function painelUsaPeriodo(chave: ChavePainel): boolean {
  return chave !== 'semana';
}
