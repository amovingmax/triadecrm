/**
 * As duas larguras de conteúdo do CRM, e a regra de ancoragem.
 *
 * ---------------------------------------------------------------------------
 * O DEFEITO QUE ESTE ARQUIVO EXISTE PARA MATAR
 * ---------------------------------------------------------------------------
 * Antes de 09/09/2026 havia QUATRO larguras e DUAS ancoragens, decididas tela a
 * tela: seis telas em `max-w-4xl` centralizado, Metas em `max-w-2xl`
 * centralizado, Importar em `max-w-2xl` à esquerda, e seis sem teto nenhum,
 * coladas na borda. O efeito é o que o Matheus descreveu como "site
 * incoerente", na forma mais literal possível: **o título pula de lado a cada
 * troca de tela**. Numa janela de 1440px, ir de Parceiros para o Meu dia
 * empurrava o título 168px para a direita; ir para Registrar, mais ainda. Em
 * `/ligar`, tabular uma ligação encolhia a tela inteira no instante do recibo —
 * trinta vezes por manhã.
 *
 * ---------------------------------------------------------------------------
 * A REGRA: A BORDA ESQUERDA NÃO SE MEXE
 * ---------------------------------------------------------------------------
 * Nenhuma tela se centraliza. Todas começam no mesmo x, e o que muda é onde
 * elas TERMINAM. Uma coluna de leitura simplesmente acaba antes; a área vazia
 * fica à direita, onde não atrapalha, em vez de virar deslocamento.
 *
 * Isso desfaz de propósito uma mudança de 08/09, quando centralizei as telas
 * para responder à queixa de "espaço sobrando à direita". As duas queixas
 * existem e são reais, mas não têm o mesmo peso: espaço à direita de uma coluna
 * de texto é normal e ninguém repara; o título mudando de lugar entre duas telas
 * é o que faz o produto parecer desmontado.
 *
 * O centro continua existindo num lugar só — a casca (`app-shell`), que
 * centraliza a COLUNA INTEIRA acima de 1440px, para nenhuma tabela se esticar
 * por um monitor ultrawide. Abaixo disso ele não faz nada, e por isso não
 * desloca nada.
 *
 * ---------------------------------------------------------------------------
 * DUAS LARGURAS, E O CRITÉRIO É A PERGUNTA DA TELA
 * ---------------------------------------------------------------------------
 * `LEITURA`   uma coisa de cada vez, lida de cima para baixo: a fila do dia, um
 *             registro, um lote de ligação, a ficha de um parceiro, as réguas de
 *             cadência. Texto acima de ~90 caracteres por linha custa o retorno do
 *             olho, e é o que o teto evita.
 *
 * `TRABALHO`  uma superfície que precisa de espaço: tabela de parceiros, quadro
 *             do funil, inbox de duas colunas, fila do Radar, relatórios, admin,
 *             agenda, e a importação (o passo do mapa é uma tabela de quantas
 *             colunas o arquivo tiver). Aqui o teto é o da casca.
 *
 * Se você está criando uma tela e não sabe qual usar: se ela tem tabela ou
 * quadro, é TRABALHO; se ela é uma lista ou um formulário, é LEITURA. Não
 * invente uma terceira — a terceira é como as quatro nasceram.
 */

/** Coluna de leitura: lista, formulário, fila. Ancorada à esquerda. */
export const LEITURA = 'w-full max-w-4xl';

/**
 * Superfície de trabalho: tabela, quadro, inbox. Sem teto próprio — quem limita
 * é a casca.
 *
 * Existe como constante, e não como "não pôr classe nenhuma", para a escolha
 * ficar declarada no código: uma tela sem classe é ambígua entre "é de trabalho"
 * e "esqueceram de decidir".
 */
export const TRABALHO = 'w-full';
