import type { ReactNode } from 'react';

import type { FunctionReturns, Temperature } from '@komune/schema';

import { EMPRESA } from '@/lib/empresa';

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
  // Os da Imova: o "relatório que vende" (09/11/2026), `relatoriosDaImova`.
  | 'visao'
  | 'imoveis'
  | 'oportunidades'
  | 'funil_equipe'
  | 'progresso_ia'
  | 'ligacoes'
  | 'atendimento'
  | 'semana'
  | 'funil'
  | 'categorias'
  | 'bairros'
  | 'pessoas'
  | 'horarios'
  | 'fontes'
  | 'base';

/**
 * Troca de aba sem sair da tela. `alvo` é o que a aba de destino abre já escolhido
 * (o código do imóvel, quando a sugestão da Visão geral é de um imóvel).
 */
export type AbrirPainel = (chave: ChavePainel, alvo?: string | null) => void;

export type DefinicaoPainel = {
  chave: ChavePainel;
  rotulo: string;
  titulo: string;
  /** O que este painel responde, em uma frase. */
  descricao: string;
};

/**
 * Em que tela de Relatórios o painel aparece. A da KOMUNE é a da captação de
 * fornecedores; a da Imova (`relatoriosDaImova`, 06/11/2026; o "relatório que vende"
 * desde 09/11/2026) é a de uma imobiliária, e os painéis feitos para a captação
 * saem da barra dela.
 */
type OndeAparece = 'captacao' | 'imobiliaria' | 'ambas';

const TODOS_OS_PAINEIS: readonly (DefinicaoPainel & { onde: OndeAparece })[] = [
  // ---- Os da Imova: o "relatório que vende" (09/11/2026), na ordem do protótipo
  // aprovado. A Visão geral abre. Substituem os cinco de 06/11 (Visão geral,
  // Clientes quentes, Anúncios, Mensagens e IA que atende). ----
  {
    chave: 'visao',
    rotulo: 'Visão geral',
    titulo: 'O período em números e onde está o dinheiro',
    descricao:
      'Os números do período contra o período anterior, o que a IA sugere para vender mais, a previsão do mês, os imóveis mais procurados, o funil, a IA e a comissão parada.',
    onde: 'imobiliaria',
  },
  {
    chave: 'imoveis',
    rotulo: 'Imóveis',
    titulo: 'Quem quer cada imóvel e o que falar',
    descricao:
      'Os imóveis no ar pelo número de leads interessados e pelo nível de interesse. Escolha um para ver quem são, o que perguntam, o que trava e o que a IA sugere.',
    onde: 'imobiliaria',
  },
  {
    chave: 'oportunidades',
    rotulo: 'Oportunidades',
    titulo: 'O dinheiro parado agora e a fila de hoje',
    descricao:
      'Os leads com chance de negócio e nenhuma ação em dia: por que estão parados, quanto valem de comissão provável, com quem estão e o que fazer com cada um.',
    onde: 'imobiliaria',
  },
  {
    chave: 'funil_equipe',
    rotulo: 'Funil e equipe',
    titulo: 'Onde o funil trava e quem converte',
    descricao:
      'O placar do mês, cada passagem do funil e o que travou, o que faz o lead marcar visita, as objeções, os canais, a equipe e as mensagens que funcionam.',
    onde: 'imobiliaria',
  },
  {
    chave: 'progresso_ia',
    rotulo: 'Progresso da IA',
    titulo: 'Como a IA está melhorando',
    descricao:
      'Desde que a IA começou, semana a semana: as notas da avaliação diária, se o cliente sai mais interessado, o que ela resolve sozinha, o que cada versão mudou e o que ainda falta.',
    onde: 'imobiliaria',
  },
  // ---- Os da captação: a KOMUNE vê todos, na ordem de sempre. Desde 09/11/2026
  // nenhum é "ambas": Atendimento, Funil e Pessoas saíram da barra da Imova, que
  // tem o Funil e equipe no lugar deles. O "ambas" continua valendo para o painel
  // que um dia servir às duas. ----
  {
    // O primeiro, e o que abre: desde o pivô de 06/10/2026 a pergunta de todo
    // dia é "o que cada pessoa que ligou fez hoje?".
    chave: 'ligacoes',
    onde: 'captacao',
    rotulo: 'Ligações do dia',
    titulo: 'O dia de quem ligou',
    descricao:
      'Quem ligou no dia e o que cada pessoa fez: ligações, quantas atenderam, tempo falado, reuniões marcadas e a lista ligação a ligação.',
  },
  {
    chave: 'atendimento',
    onde: 'captacao',
    rotulo: 'Atendimento',
    titulo: 'Como o time atende no WhatsApp',
    descricao:
      'Tempo de primeira resposta, conversas por atendente, conversão por etapa e motivos de perda.',
  },
  {
    chave: 'semana',
    onde: 'captacao',
    rotulo: 'Semana',
    titulo: 'O relatório de segunda',
    descricao:
      'O que a semana rendeu, em texto pronto para ler no celular: o número e o que ele quer dizer.',
  },
  {
    chave: 'funil',
    onde: 'captacao',
    rotulo: 'Funil',
    titulo: 'Funil por etapa e conversão',
    descricao:
      'Quantos negócios estão em cada etapa hoje e quanto da coorte do período chegou até ali.',
  },
  {
    chave: 'categorias',
    onde: 'captacao',
    rotulo: 'Categorias',
    titulo: 'Densidade por categoria',
    descricao: 'Onde ainda há alvo para bater e onde a categoria secou sem publicar.',
  },
  {
    chave: 'bairros',
    onde: 'captacao',
    rotulo: 'Bairros',
    titulo: 'Cobertura por bairro',
    descricao: 'O corte de zona que monta a rota: alvos, contato e portas por bairro.',
  },
  {
    chave: 'pessoas',
    onde: 'captacao',
    rotulo: 'Pessoas',
    titulo: 'Atividade por responsável',
    descricao: 'Portas, ligações, visitas, reuniões e o prazo das próximas ações de cada pessoa.',
  },
  {
    chave: 'horarios',
    onde: 'captacao',
    rotulo: 'Horários',
    titulo: 'Eficiência por faixa de horário',
    descricao: 'A que horas e por qual canal a porta abre. É o que decide quando ligar.',
  },
  {
    chave: 'fontes',
    onde: 'captacao',
    rotulo: 'Fontes',
    titulo: 'Aproveitamento por fonte',
    descricao:
      'De cada fonte: quantos entraram, quantos responderam, autorizaram e publicaram.',
  },
  {
    chave: 'base',
    onde: 'captacao',
    rotulo: 'Base',
    titulo: 'A base por temperatura',
    descricao: 'Como a base está dividida entre frio, morno, quente e cliente agora.',
  },
];

/** Os painéis de uma tela de Relatórios, na ordem da barra. */
export function paineisDaEmpresa(relatoriosDaImova: boolean): readonly DefinicaoPainel[] {
  const desta: OndeAparece = relatoriosDaImova ? 'imobiliaria' : 'captacao';
  return TODOS_OS_PAINEIS.filter((p) => p.onde === 'ambas' || p.onde === desta).map((p) => ({
    chave: p.chave,
    rotulo: p.rotulo,
    titulo: p.titulo,
    descricao: p.descricao,
  }));
}

/** Os painéis DESTA empresa. Na KOMUNE, os mesmos de sempre, na mesma ordem. */
export const PAINEIS: readonly DefinicaoPainel[] = paineisDaEmpresa(
  EMPRESA.modulos.relatoriosDaImova,
);

/**
 * O painel pedido na URL, se ele existe nesta empresa; senão o primeiro da barra
 * (Ligações do dia na KOMUNE, Visão geral na Imova). Um link da KOMUNE com
 * `?painel=bairros` aberto na Imova cai na Visão geral, e não numa tela vazia.
 */
export function painelDaUrl(
  valor: string | string[] | undefined,
  paineis: readonly DefinicaoPainel[] = PAINEIS,
): ChavePainel {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  const achado = paineis.find((p) => p.chave === bruto);
  return achado?.chave ?? paineis[0]?.chave ?? 'ligacoes';
}

/**
 * O painel da semana não obedece à barra de período: ele é recortado pela SEMANA
 * civil, e tem seletor próprio. Mostrar a barra de 7/30 dias ali seria oferecer um
 * controle que não muda nada na tela.
 */
export function painelUsaPeriodo(chave: ChavePainel): boolean {
  // "Ligações do dia" é recortado por UM dia, com passo próprio, pela mesma razão.
  // "Oportunidades" é o retrato de AGORA (o dinheiro parado hoje não tem período), e
  // "Progresso da IA" conta desde que a IA começou.
  return (
    chave !== 'semana' && chave !== 'ligacoes' && chave !== 'oportunidades' && chave !== 'progresso_ia'
  );
}
