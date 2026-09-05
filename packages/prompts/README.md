# @komune/prompts

Os prompts versionados dos fluxos de IA do Tríade, com pseudonimização, validador de
promessas e evals que rodam sem rede.

Fonte da verdade: PRD §9.1 (ADR-05, ADR-09, ADR-10), RF-CON-19 a RF-CON-28, anexos
R08 (playbook conversacional), R13 (prospecção ativa por ligação) e R06 (LGPD).
Custos e projeções: [`docs/operacao/prompts-e-custos.md`](../../docs/operacao/prompts-e-custos.md).

## O que está protegido e o que não está

> **Este módulo não está em uso.** Hoje nenhuma parte do Tríade chama modelo nenhum:
> `apps/workers/src/workers/ai.ts` é um esqueleto que registra heartbeat e devolve zero, e
> não existe credencial da Anthropic em lugar nenhum do repositório. Tudo o que está
> escrito abaixo é sobre um guardrail que ainda não segurou uma chamada de verdade.
> **Releia esta seção inteira antes de ligar a primeira chamada real**, e trate cada
> limite como uma decisão a tomar naquele dia, não como uma nota de rodapé.

### O que está protegido

Duas camadas independentes, cada uma com a sua implementação, sobre a **projeção de
dígitos** do texto (só os algarismos, mais o índice de cada um no original):

- **O telefone que o CRM já tem no cadastro**, em qualquer arrumação — com DDD, sem DDD,
  com ou sem o nono dígito, com `+55`, com qualquer separador, com letra no meio. É
  casamento por substring dos dígitos, sem heurística nenhuma, e é o caminho que não pode
  falhar.
- **Telefone brasileiro completo** (10 a 13 dígitos, DDD válido e faixa da Anatel), venha
  ele com que formatação vier. Quarenta e cinco famílias de algarismo do Unicode (`８`,
  `𝟴`, `⑧`, `⁸`, `₈`, `⑻`, `⒏`, `٨`, `८`, `➑`) e trinta separadores intercalados dígito a
  dígito foram medidos: zero vazamentos.
- **Telefone local, sem DDD** (8 ou 9 dígitos), com hífen, com espaço, com ponto ou
  corrido — desde a 6ª versão. A janela local só corta onde houve separador; é o que a
  impede de ler telefone em `2026090512` e em `12/12/2026`.
- **Telefone repartido entre dois campos** do mesmo prompt: a auditoria roda também sobre
  a junção do texto de fora, na ordem em que o modelo o lê.
- **E-mail e @instagram**, nome, empresa e primeiro nome vindos do cadastro.
- **CNPJ, CPF e uuid**, trocados por `[[DOCUMENTO_n]]` — não porque sejam telefone, mas
  para a auditoria poder continuar burra.
- **Tipo de campo desconhecido falha fechado**: o que a travessia não souber abrir levanta
  `TipoNaoAuditavelError` e a chamada não sai.

### O que NÃO está protegido

Cada linha abaixo é um furo conhecido, medido, e deixado aberto de propósito. Nenhum é
descuido; todos são escolha, e a escolha está escrita.

| Limite | Por que não foi fechado | O que atenua |
| --- | --- | --- |
| **Número ditado por extenso** — "oito quatro nove nove nove oito oito zero zero um um" | A projeção enxerga dígito. Um número por extenso não tem dígito nenhum, e reconhecê-lo exigiria um léxico de numerais em português com todas as formas ("meia", "nove nove", "noventa e nove") — heurística de linguagem, exatamente o tipo de coisa que caiu nas cinco conferências anteriores. | Áudio recebido vai para uma pessoa no MVP (RF-CON-27), e é na transcrição que a forma por extenso aparece. É regra de produto segurando, não detecção. |
| **0800 e numeração comercial sem DDD** | `0800 970 5555` tem onze dígitos e não tem DDD; aceitá-lo obrigaria a aceitar qualquer corrida de onze dígitos começando em zero, e aí entra número de pedido, protocolo e código de barras. | Não é contato de pessoa física: é linha comercial publicada. O risco de LGPD é outro, e menor. Vale o mesmo para `0300`, `4004` e `3003`. |
| **Telefone estrangeiro** | A régua é a numeração da Anatel. Um `+351 912 345 678` ou um `+1 415 555 2671` não passa por ela, e não existe régua universal barata. | Por acidente, boa parte deles cai na janela de 10 a 13 dígitos e é mascarada de forma **errada** — `+351 912 345 678` vira `+3[[TELEFONE_2]]8`. Ou seja: às vezes protege, sempre estraga o texto. O público do Tríade é Natal/RN, e telefone estrangeiro é raro. |
| **Nome de terceiro que o CRM não conhece** | "quem decide é a Ana, sócia dele" — só nomes vindos do cadastro são reconhecidos. Achar nome próprio em texto livre é NER, e NER de verdade é um modelo: mandar o texto a um modelo para descobrir o que esconder do modelo é o contrário do guardrail. | Nome solto sem sobrenome, telefone ou e-mail é PII fraca. O que identifica o caso continua sendo o `leadId`. |
| **Homoglifo de letra** — `9OO88OO11` (letra `O` no lugar do zero), `l` no lugar do `1` | Aceitar `O` como zero significa aceitar que qualquer palavra com `o` carregue dígito. `hoje`, `bom`, `ok` e `sol` passariam a ter algarismo, e a projeção — que é a base das duas camadas — inventaria número em todo texto. O remédio seria pior que a doença, e a medição no corpus mostrou isso na hora. | Não é uma grafia natural: ninguém digita o próprio telefone com letra `O`. É evasão deliberada, e evasão deliberada por quem manda a mensagem — o fornecedor não tem motivo para esconder o próprio número de nós. |
| **Numeral romano e ideográfico** — `Ⅷ`, `八`, `〇` | `Ⅷ` decompõe em `VIII` (tem letra) e `八` não tem decomposição de compatibilidade nem é dígito decimal: para o JavaScript, não existe valor numérico ali. Seriam mais duas tabelas escritas à mão, e tabela é a única parte do arquivo que envelhece. | Ninguém escreve telefone em romano nem em ideograma chinês em Natal. É borda de conferência, não caso de uso. |
| **Telefone repartido entre metadado nosso e texto de fora** | A junção corre só sobre o texto de origem externa. O metadado que o próprio Tríade escreve (`leadId`, `canal`, `duracaoSeg`, `confiancaAsr`) fica fora dela — e tem de ficar: incluí-lo barrava 1 dos 10 exemplos reais dos próprios prompts, medido. | O metadado é escrito por nós, não por quem manda mensagem. Para o furo existir, alguém de fora precisaria controlar o valor de um campo nosso — e, se controlar, o problema é bem maior que este. **Se um campo novo passar a carregar texto de fora, ele não pode entrar em `camposDoTriade`**; o eval "o que é nosso nunca é, ao mesmo tempo, texto que a regra pseudonimiza" é a trava, e ela é parcial. |
| **`Proxy` com leitura instável** | Um `Proxy` cujo `get` devolva um valor na auditoria e outro na montagem passa pelas duas. `Reflect.ownKeys` e a recusa de getters pegam o caso comum; um proxy hostil, não. | Não é alcançável pelos prompts reais: a entrada vem de um `z.object()` já validado, e zod não devolve proxy. Está registrado porque um campo novo, amanhã, pode trazer um. |
| **Dígito colado na frente de um local** — `2977776666` | O grupo tem dez dígitos, a janela local exige oito ou nove, e `29` não é DDD. Aceitar uma janela de nove dentro de um grupo de dez reabriria a corrediça, que é o que faz `2026090512` virar telefone. | Só o zero abre fronteira (`0999880011` é reconhecido), porque zero é prefixo de discagem. Qualquer outro dígito colado é um dígito a mais, e um número com um dígito a mais não é aquele número. E o número **do cadastro** é imune: `2999880011` é mascarado pelo casamento por substring. |
| **Dois locais desconhecidos colados, sem nada entre eles** — `3222 1188 4009 8888` | A passada do telefone completo roda antes e é gulosa: ela lê `3222118840` como um nacional de dez dígitos com DDD 32 e o consome, deixando `09 8888` para trás. Mexer nessa passada é mexer no que cinco conferências fecharam. | Basta uma palavra, uma vírgula ou uma barra entre os dois (`3222-1188 ou 4009-8888`) para os dois saírem mascarados, e é assim que quase todo mundo escreve. Os dois números **do cadastro** também são imunes. |
| **Local desconhecido repartido por uma palavra** — "meu zap é 97777 então 6666" | O grupo de dígitos fecha na letra, e sem isso a janela de oito atravessaria a frase inteira: `8% sobre R$ 12.000 dá R$ 960` viraria telefone, e o corpus de 40 mensagens saltaria de 5 para 10 bloqueios. | O do cadastro sai mascarado mesmo assim (o casamento por substring não olha o texto). E o número completo com DDD atravessando palavra continua sendo pego pela auditoria, que não tem fronteira nenhuma. |
| **Fixo local de oito dígitos, corrido, com forma de data** — `31012026` | Oito dígitos corridos começando em 2–9 são indistinguíveis de uma data compacta (`20260905`, `21112026`), e a data é muito mais comum. Sem recusá-la, a regra trocava datas por marcador e a auditoria barrava a chamada. | Com **qualquer** separador — `3101 2026`, `3101-2026`, `3101.2026` — ele volta a ser telefone. É a única recusa que a auditoria ganhou junto com a janela local, e ela não toca na janela de 10 a 13 dígitos. |
| **CEP escrito corrido** — `59082050` | Um CEP corrido e um fixo local corrido são a mesma coisa em dígitos. A regra o mascara como telefone. | É falso positivo, não vazamento: custa uma palavra trocada no texto que vai ao modelo, e `reidratar` devolve o CEP a quem for ler. Com hífen (`59082-050`) ele é reconhecido como CEP e fica intacto. |

### O que barra chamada legítima, em número

Medido no corpus de 40 mensagens reais de fornecedor de evento em Natal, **nenhuma com
telefone**, e nos 10 exemplos reais dos próprios prompts:

| | 40 mensagens de fornecedor | 10 exemplos dos prompts |
| --- | --- | --- |
| chamadas barradas | 5 (12,5%) | 0 |
| texto estragado pela regra | 0 | 0 |

As cinco são sempre o mesmo padrão: data com hora colada, ou uma sequência de anos e
quantidades que soma dez dígitos começando por duas casas que por acaso são DDD. O
conserto, quando incomodar, é a **regra substituir mais** — nunca a auditoria perdoar
mais. Estes números estão trancados em teste (`evals/pseudonimizacao.eval.test.ts`): se
subirem, o eval fica vermelho e alguém decide de novo.

## O que este pacote garante

1. **Versão é imutável.** Cada prompt é um objeto congelado com id, versão, modelo alvo,
   schema de entrada (zod), schema de saída (zod) e o texto. Publicar uma v2 não muda a v1:
   `obterPrompt('resumo-ligacao', 1)` continua devolvendo o v1, com os schemas do v1.
2. **Nenhum prompt recebe telefone.** `prepararChamada` é o único caminho entre um prompt e
   a API, e ele confere a mensagem já montada antes de devolvê-la. A detecção não reconhece
   formatação: o texto vira uma **projeção de dígitos** (só os algarismos, mais o índice de
   cada um no original) e é sobre ela que se procura — `84 99988 - 0011`, `(84)99988.0011`,
   `84/99988/0011` e `8 4 9 9 9 8 8 0 0 1 1` são o mesmo objeto. O telefone que o CRM já tem
   no cadastro é procurado como substring dessa projeção, sem exceção nenhuma. A formatação
   só entra depois de o candidato ter sido achado, e só para **recusar** (CEP, data, valor,
   trecho que atravessa palavra). A conferência final é uma segunda implementação
   (`nucleo/auditoria-pii.ts`), que não importa nada da regra: projeta os dígitos por conta
   própria, não desconta CEP nem CNPJ nem dígito verificador, e aceita um critério de
   telefone estritamente mais frouxo. Auditar com a mesma regex não é auditar.

   Duas coisas mudaram na 4ª versão. A projeção passou a perguntar, **ponto de código por
   ponto de código**, "qual algarismo isto representa?" — o que cobre algarismo circulado
   (`⑧`), sobrescrito (`⁸`), subscrito (`₈`), entre parênteses (`⑻`) e com ponto (`⒏`), que
   não são "dígito decimal" para o Unicode e por isso escapavam. E a auditoria deixou de
   ver a mensagem inteira: ela recebe **apenas os trechos de origem não confiável**, já
   pseudonimizados (a transcrição, a anotação, o que o lead escreveu), e sobre eles corre
   **sem fronteira nenhuma — nem de letra**. Era a fronteira de letra que deixava
   `ddd 84 numero 988776655` passar; ela só existia porque o prompt de sistema, que não
   tem PII nenhuma, estava sendo auditado junto. A separação é por varredura, não por
   declaração: campo novo no schema é auditado por padrão, nunca esquecido por padrão.

   A 5ª versão fechou as duas frestas que sobraram, as duas na fronteira entre campos.
   **Tipo desconhecido falha fechado:** a varredura sabia abrir string, número, lista e
   objeto simples, e para `Map`, `Set`, `Date` ou instância de classe o campo sumia da
   auditoria sem erro nenhum — a dimensão *campo* estava trancada, a dimensão *tipo* não.
   Agora o que ela não souber percorrer levanta `TipoNaoAuditavelError` com o caminho do
   campo, e a chamada não sai. **Telefone repartido entre dois campos:** a auditoria
   também roda sobre a **junção** — os trechos colados um no outro, sem fronteira —, e a
   junção corre só sobre o que veio de uma pessoa de fora. O metadado que o próprio Tríade
   escreveu (`leadId`, `canal`, `duracaoSeg`, `confiancaAsr`, flags) é declarado em
   `camposDoTriade` e fica fora dela; era ele que, somado às capturas, barrava exemplo
   legítimo. As duas classificações falham fechado: campo que ninguém declarou é de fora,
   tipo que ninguém ensinou a abrir levanta erro.

   A 6ª versão fechou o furo mais comum de todos, e o mais bobo: o telefone **local, sem
   DDD**. Até aqui ele só era reconhecido pela grafia com hífen (`99988-0011`), e quem
   escrevesse `99988 0011` ou `999880011` — o jeito de passar o próprio número dentro da
   cidade — mandava o número inteiro para a Anthropic, sem a regra ver e sem a auditoria
   ver. Agora é janela sobre os dígitos, nas duas camadas, com uma diferença medida antes
   de ser decidida: **a janela local só corta onde houve um separador**. Oito dígitos é
   entropia curta demais para uma corrediça — solta, ela lê telefone em `2026090512`, em
   `59082-050` e em `12/12/2026`, e levaria o corpus de 40 mensagens reais de 5 para 10
   bloqueios e os 10 exemplos dos próprios prompts de 0 para 3. Com o corte no separador,
   os três números ficaram onde estavam: 5, 0 e 0.
3. **Nada sai do modelo sem validação.** O JSON volta pelo schema da própria versão; o
   rascunho que uma pessoa vai ler passa antes pelo validador de promessas.
4. **Nada disso precisa de rede para ser testado.**

## Os quatro prompts, na ordem do R13

Com o primeiro contato virando ligação, o que a IA precisa fazer primeiro deixou de ser
"redigir mensagem fria".

| Prompt                    | Modelo    | O que faz                                                                                                                                   |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `transcricao-audio@v1`    | Haiku 4.5 | Limpa a transcrição do áudio recebido e diz se dá para confiar. Quem transcreve é o faster-whisper local (RF-CON-27); áudio não vira token. |
| `resumo-ligacao@v1`       | Sonnet 5  | Resume a ligação a partir do caminho no roteiro, das capturas e da anotação. Sem gravação.                                                  |
| `followup-ligacao@v1`     | Sonnet 5  | Redige o rascunho do WhatsApp de depois da ligação. Sempre rascunho (ADR-05).                                                               |
| `classificar-intencao@v1` | Haiku 4.5 | Classifica a mensagem recebida em uma das 25 intenções do R08.                                                                              |

## Como se usa

```ts
import { prepararChamada, promptVigente, reidratar, validarPromessas } from '@komune/prompts';

const prompt = promptVigente('followup-ligacao');
const chamada = prepararChamada(prompt, entrada, {
  leadId: organizacao.id,
  nome: contato.nome,
  empresa: organizacao.nome,
  telefones: [contato.phone_e164],
});

// chamada.sistema (cacheável) · chamada.mensagem (já pseudonimizada) · chamada.maxTokens
// chamada.modelo e chamada.promptVersion vão para ai_runs.

const rascunho = chamada.interpretar(jsonDoModelo);
const veredito = validarPromessas({ texto: rascunho.mensagem, claims: rascunho.claims });
if (veredito.situacao === 'aprovado') {
  mostrarParaAprovacao(reidratar(veredito.texto, chamada.mapa));
}
```

`reidratar` é chamado **na hora de a pessoa ler**, campo a campo, e não automaticamente:
devolver o nome real a um texto que vai voltar para o modelo seria desfazer o guardrail.

## Estrutura

```
src/
  nucleo/
    versionamento.ts        PromptVersionado, definirPrompt, selecionar
    chamada.ts              prepararChamada (o único caminho até a API) e esquemaDeSaida
    pseudonimizacao.ts      a regra: marcadores [[TIPO_n]], mapa e reidratação
    telefone-br.ts          o que é telefone brasileiro (DDD, faixas, formas do conhecido)
    auditoria-pii.ts        a auditoria: verificarSemPii, outra implementação de propósito
    base-conhecimento.ts    a FAQ aprovada (R08 §7) e a lista do que nunca prometer (§5.4)
    validador-promessas.ts  RF-CON-24, determinístico
    custos.ts               preços, projeção do mês e alerta de 80%
    tokens.ts               estimativa de tokens (a contagem real vem do usage)
  prompts/<fluxo>/v1.ts     uma versão por arquivo; v2 nasce ao lado, nunca por cima
  catalogo.ts               id → versão → prompt, e qual versão está vigente
evals/                      os testes; `executar.ts` traz o mecanismo de caso conhecido
```

## Publicar uma v2

1. `src/prompts/<fluxo>/v2.ts`, com os próprios schemas. **Não edite o v1.**
2. Acrescente `2: <prompt>` na linha do id em `CATALOGO`.
3. Rode os evals. Um caso conhecido que ficar **vermelho** é boa notícia: aquele caso passou
   a acertar; apague o bloco `conhecido` dele e ele vira régua.
4. Só então mude `VIGENTES` — é esse commit que é o deploy do prompt.

Trocar `VIGENTES` e acrescentar a versão são passos separados de propósito: é o que faz a
volta atrás ser uma linha.

## Evals

`pnpm -C packages/prompts test` — sem rede, sem credencial da Anthropic, e nunca vai ter.

A saída do modelo entra como **fixture**: o que se mede é o código determinístico em volta
(pseudonimização, validador, decisão de intenção, roteamento, custo) e o contrato de cada
versão. Um caso pode ser marcado como **conhecido** — a resposta certa em `esperado`, a que a
versão atual dá em `conhecido.obtido` —, e aí o teste afirma as duas coisas, para que o dia
em que o comportamento melhorar seja um dia de teste vermelho, não de eval calado.
