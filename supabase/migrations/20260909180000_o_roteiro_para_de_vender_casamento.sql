-- ===========================================================================
-- O roteiro de ligação para de vender casamento, e passa a dizer o preço
-- (RF-CON-12, RF-CON-23/24; R08 §1 e §2; R13 §3.2 e §5; R06)
-- ===========================================================================
--
-- A QUEIXA, LITERAL: "os scripts de conversas em Ligar estão com muito erro de
-- português, e muito incoerentes com o que a Komune é de fato. Fomos textar
-- focando em nicho de casamento, sendo que casamento é apenas uma subcategoria
-- de produtor."
--
-- A auditoria confirmou as duas coisas e achou uma terceira, pior.
--
-- ---------------------------------------------------------------------------
-- 1. DOIS CANAIS CONTANDO DUAS HISTÓRIAS DA MESMA EMPRESA
-- ---------------------------------------------------------------------------
-- O WhatsApp tem SEIS aberturas, uma por segmento (AEB, INF, PRE, ESP, CER,
-- FOR), e nenhuma delas lidera com casamento: todas dizem "um app de eventos da
-- cidade". A de formatura fala de baile; a de infraestrutura, de estrutura e som.
--
-- O telefone tinha duas variantes e a de fornecedor abria assim:
--
--     "a Komune é onde quem está organizando CASAMENTO e festa em Natal
--      procura fornecedor"
--
-- Casamento não é categoria: das 19 do CRM, ZERO citam casamento, e cinco citam
-- explicitamente outra ocasião (buffet adulto/CORPORATIVO, buffet INFANTIL,
-- tendas/estruturas/PALCOS, empresas de FORMATURA, produtoras CORPORATIVAS e de
-- SHOWS). O gancho descartava, na primeira frase, o churrasqueiro, o locador de
-- gerador, a recreadora, a empresa de formatura e a produtora de show.
--
-- A origem do viés é rastreável: a espinha dorsal do Radar é o Casamentos.com.br.
-- A FONTE ser de casamento não autoriza o DISCURSO ser de casamento — o portal é
-- onde os telefones estão, não é o que a Komune vende.
--
-- ---------------------------------------------------------------------------
-- 2. O ROTEIRO ESCONDIA O PREÇO QUE O RAFAEL MANDOU DIZER
-- ---------------------------------------------------------------------------
-- Este é o achado mais grave, e não estava na queixa. O `obj_preco` respondia
-- "quanto custa?" com "o número exato eu te mando por escrito, do jeito que o
-- financeiro passou" — usando o validador de promessas para não responder o que
-- JÁ está na base de conhecimento aprovada.
--
-- O R08 §1 (intenção 3) manda o contrário, com todas as letras: "Responde a taxa
-- exata (8%, sem mensalidade; com cerimonialista 3% + 5%) sem enrolar. Nunca
-- esconder a taxa até a reunião — parece pegadinha." E a decisão da reunião de
-- 03/09 está registrada: "esquece a promoção; vai dizer o custo que a gente
-- cobra: 8%".
--
-- Pior: `obj_preco` era `variante: ambas`, e o bloco lateral mostra as objeções
-- para as duas. O cerimonialista que perguntasse "quanto custa?" ouvia que ia
-- PAGAR comissão — quando ele não paga, RECEBE 5% no contrato. Era o único
-- argumento que vira a conversa com esse segmento, e ele não existia em nó
-- nenhum da árvore.
--
-- ---------------------------------------------------------------------------
-- 3. VENDIA QUATRO RECURSOS QUE NÃO EXISTEM
-- ---------------------------------------------------------------------------
-- "orçamento e contrato no mesmo painel", "manda o orçamento pra todos de uma
-- vez", "o histórico de quem já entregou bem", "você vê quem está disponível
-- naquela data". A FAQ aprovada cobre busca por categoria, tipo, data e faixa de
-- preço, vitrine com avaliação, e o pedido chegando com data e número de
-- pessoas. Mais nada. Os quatro saíram.
--
-- E `prod_explica` invertia quem faz o quê: dizia que o produtor "manda o
-- orçamento", quando quem manda orçamento é o fornecedor. Um cerimonialista
-- percebe isso na hora e conclui, com razão, que quem liga não entende do
-- negócio dele.
--
-- ---------------------------------------------------------------------------
-- 4. PORTUGUÊS: 115 ACHADOS, EM CINCO FAMÍLIAS
-- ---------------------------------------------------------------------------
-- a) ARTIGO COLADO EM [empresa], em sete lugares ("dos eventos do", "aí no",
--    "vê o", "Quantos eventos o"). Nos 67 nomes reais da base, pelo menos 30
--    quebram: "do Agência Rocas", "o Bodega da Terra", "aí no Vivier Recepções",
--    "do Eliana Festas & Eventos". Quase metade das ligações começava com erro de
--    concordância na primeira frase. Agora é "vocês" ou "aí em [empresa]".
--
-- b) GÊNERO PRESUMIDO, dos dois lados. "Consigo falar com ele", "qual é o nome
--    dele", "espere ele confirmar" — num mercado em que a decisora costuma ser
--    mulher. E cinco fechamentos com "Obrigado", lidos em voz alta pela Heloísa e
--    pela Bárbara, que são quem mais liga. Nenhum sobrou.
--
-- c) MULETA: 31 dos 37 nós abriam com "Ótimo/Perfeito/Certo/Entendi/Claro". Numa
--    ligação de 6 a 10 nós, isso é dito seis a dez vezes em três minutos — é
--    exatamente o que faz um vendedor soar máquina.
--
-- d) MARCADOR QUEBRANDO A SINTAXE. `obj_origem` dizia "Claro: peguei [origem]", e
--    nove das onze origens deixavam o verbo sem objeto ("peguei no
--    Casamentos.com"). `combinar_retorno` virava "eu ligo, por volta das." sem
--    hora. `agendar_reuniao` renderizava minúscula depois de ponto final.
--
-- e) "EVENTO DE NATAL", em três nós, que ao telefone é a festa de dezembro.
--
-- ---------------------------------------------------------------------------
-- 5. O MÊS ERRADO, NA CIDADE EM QUE SE ESTÁ LIGANDO
-- ---------------------------------------------------------------------------
-- `forn_sem_demanda` dizia "e nos meses fracos, junho e julho". Em Natal, junho é
-- São João e julho é férias: ALTA temporada para buffet, som, estrutura,
-- decoração e brinquedo. A baixa que a própria casa escreveu é janeiro e
-- fevereiro (R08 §2.0, e em mais dois lugares). Dizer a um fornecedor daqui que
-- junho é mês fraco entrega, numa frase, que quem liga não é da cidade.
--
-- ---------------------------------------------------------------------------
-- 6. O QUE FALTAVA E ENTROU
-- ---------------------------------------------------------------------------
-- SAÍDAS: "já sou parceiro" (as pessoas se cadastram sozinhas no site); "somos
-- essa empresa sim, mas não trabalhamos com evento" (que caía em NÚMERO ERRADO,
-- mentindo sobre a linha — o número estava certo, a categoria da coleta é que
-- errou); "não sou de Natal"; "estou dirigindo" indo direto ao retorno, sem
-- pitch; a secretária que não passa e aceita e-mail; e o desligamento no meio,
-- que fecha pelo eixo técnico e é o que faz `caminho_script` responder a pergunta
-- do R13 §3.2: em qual frase as pessoas desligam.
--
-- OPT-OUT NO PONTO EM QUE A RECUSA ACONTECE. Existia em três nós laterais e não
-- existia na proposta recusada, que é onde a pessoa de fato diz não.
--
-- OBJEÇÕES: entram sete que o R08 já tinha escrito e a árvore não tinha —
-- comissão/8% é muito, "o app tem gente?", "vou ver e te falo" (e o R08 proíbe
-- responder "fico no aguardo": pergunta de clareza e data combinada na hora),
-- "vocês tabelam meu preço?", "não gosto de comissão por fora" (a do
-- cerimonialista, que vira o melhor argumento do segmento), "isso é golpe?" (com
-- prova verificável na hora, porque ao telefone não há link para clicar) e o
-- cliente hostil, que tem prioridade absoluta: desculpa, para, e opt-out.
--
-- E o bloco lateral deixou de ser todo `ambas`: cada objeção declara a variante,
-- e as que mudam de resposta têm gêmeas.
--
-- ---------------------------------------------------------------------------
-- 7. POR QUE VERSÃO 2, E NÃO UM UPDATE NA v1
-- ---------------------------------------------------------------------------
-- `call_batch.script_id` congela o roteiro na montagem, e o índice único parcial
-- `call_scripts (slug) where is_published` garante uma versão publicada por slug.
-- É o desenho da migração 20260904001300, escrito para isto: publicar a v2 no
-- meio da tarde não muda o lote que já está de pé. Quem está ligando agora
-- termina o turno com a v1; o próximo lote nasce com a v2.
--
-- A v1 fica no banco, despublicada. Roteiro é comparável (R13 §7.7), e apagar a
-- versão anterior apagaria a base de comparação.
--
-- ---------------------------------------------------------------------------
-- 8. O QUE NÃO FOI VERIFICADO POR TERCEIRO
-- ---------------------------------------------------------------------------
-- A reescrita passou por 5 redatores e 15 verificadores adversariais, em três
-- lentes (voz alta, promessa/LGPD, esquema). DEZ verificadores morreram no limite
-- de gasto da conta: os ramos `produtor` e `objeções` ficaram sem revisão
-- independente, e `tronco` e `fins` ficaram só com a lente de voz alta.
--
-- O que sobrou foi conferido à mão contra o R08 e a árvore validada por script
-- (60 nós, 253 saídas: destinos, rótulos de até 48 caracteres, eixo único no
-- fim, alcançabilidade por variante e o comportamento de cada marcador quando
-- vem vazio). Ainda assim: ANTES de a Heloísa ler isso para um estranho, alguém
-- precisa ler os 60 nós em voz alta. É venda, e a régua final é o ouvido.
-- ===========================================================================

begin;

-- A v2 nasce publicada; a v1 sai de cena no mesmo comando, porque o índice único
-- parcial não admite duas publicadas ao mesmo tempo. `is_published = false`
-- primeiro, senão o insert colide com a v1 antes de ela ser rebaixada.
update public.call_scripts
   set is_published = false
 where slug = 'captacao_v1'
   and versao = 1
   and is_published;

insert into public.call_scripts (slug, nome, versao, arvore, is_published)
values ('captacao_v1', 'Captação por ligação — v2', 2, $roteiro$
[
  {
    "id": "abertura",
    "tipo": "pergunta",
    "variante": "ambas",
    "texto": "[saudacao]! Quem fala é [eu], da Komune — a gente é um app de eventos aqui de Natal. Peguei o contato de vocês [origem]. Liguei porque a gente está montando a rede de quem faz evento na cidade. Se não fizer sentido, me diz que eu tiro vocês da lista. Falo com quem cuida dos eventos aí em [empresa]?",
    "saidas": [
      {
        "rotulo": "Sou eu, pode falar",
        "destino": "gancho_fornecedor"
      },
      {
        "rotulo": "Sou eu, pode falar",
        "destino": "gancho_produtor"
      },
      {
        "rotulo": "Não é comigo",
        "destino": "pedir_decisor"
      },
      {
        "rotulo": "Tô dirigindo / no meio de um evento",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não posso falar agora",
        "destino": "obj_sem_tempo"
      },
      {
        "rotulo": "Manda no WhatsApp",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "De onde tirou meu número?",
        "destino": "obj_origem"
      },
      {
        "rotulo": "Quem é você? Isso é golpe?",
        "destino": "obj_golpe"
      },
      {
        "rotulo": "Somos sim, mas não trabalhamos com evento",
        "destino": "fim_nao_e_evento"
      },
      {
        "rotulo": "Aqui não é [empresa]",
        "destino": "fim_engano"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "Os quatro do R06, uma frase cada: quem somos, de onde veio o contato, por que liguei, como sair. Nenhuma delas pode ser pulada. Quem está dirigindo ou montando evento vai direto para o retorno — sem pitch, sem explicar nada."
  },
  {
    "id": "agendar_reuniao",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Me dá 20 minutos: pode ser por vídeo de manhã, ou eu passo aí à tarde. Eu marco aqui e já te confirmo por escrito. Que dia fica melhor pra você?",
    "saidas": [
      {
        "rotulo": "Serve, pode marcar",
        "destino": "confirmar_contato"
      },
      {
        "rotulo": "Nesse dia não dá",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Prefiro só por WhatsApp",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Pensando melhor, não quero",
        "destino": "fim_sem_interesse"
      }
    ],
    "campo": "reuniao_combinada",
    "nota": "Ofereça sempre os dois formatos, vídeo de manhã ou visita à tarde (R08 §2.0). Sem data escolhida a frase corre igual: \"Marco aqui e já te confirmo por escrito\"."
  },
  {
    "id": "anotar_cidade",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Sem problema. Vocês atendem em que cidade? Vou anotar aqui: por enquanto a Komune é só em Natal, e se abrir aí eu te aviso.",
    "saidas": [
      {
        "rotulo": "Mossoró",
        "valor": "Mossoró",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "João Pessoa",
        "valor": "João Pessoa",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "Outra cidade, já anotei",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Natal eu atendo, se compensar",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Natal eu atendo, se compensar",
        "destino": "prod_explica"
      }
    ],
    "campo": "cidade_de_atuacao",
    "nota": "A saída de continuação é gêmea, uma por variante: sem isso o cerimonialista de fora de Natal caía no roteiro do fornecedor e ouvia que ia PAGAR 8%, quando ele recebe 5%."
  },
  {
    "id": "anotar_decisor",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Tudo bem. Qual é o nome de quem decide, e o melhor horário pra eu ligar?",
    "saidas": [
      {
        "rotulo": "Anota aí: nome e horário",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Só por e-mail mesmo",
        "destino": "anotar_email"
      },
      {
        "rotulo": "Prefiro não passar",
        "destino": "fim_agora_nao"
      }
    ],
    "campo": "decisor"
  },
  {
    "id": "anotar_email",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Pode ser por e-mail, sim. Qual é o endereço certo? Eu mando assim que a gente desligar, com o meu nome e o site da Komune.",
    "saidas": [
      {
        "rotulo": "Anota aí, é esse",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não precisa mandar nada",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "Melhor não me procurar mais",
        "destino": "fim_optout"
      }
    ],
    "campo": "email_do_decisor",
    "nota": "Só para o caminho de quem atende e não passa a ligação. Reunião já combinada vai por `confirmar_por_email`, que é outro nó: fechar como reunião marcada sem reunião combinada suja a única métrica que o D8 usa para decidir reversão."
  },
  {
    "id": "combinar_retorno",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "A gente fala em outra hora, então. Qual é o melhor dia e horário pra te procurar? Já anotei aqui, e te ligo sem falta.",
    "saidas": [
      {
        "rotulo": "Combinado",
        "destino": "fim_retorna"
      },
      {
        "rotulo": "Manda no WhatsApp que eu vejo",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Melhor não me ligar mais",
        "destino": "fim_optout"
      }
    ],
    "campo": "retorno_combinado",
    "nota": "Sem data combinada, [dia] e [hora] somem e a frase fica \"te ligo sem falta\" — por isso nenhuma preposição antes deles."
  },
  {
    "id": "confirmar_contato",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Só pra eu não errar: esse número aqui é o WhatsApp que vocês usam pro trabalho?",
    "saidas": [
      {
        "rotulo": "É esse mesmo",
        "destino": "enviar_whatsapp",
        "valor": "mesmo número da ligação"
      },
      {
        "rotulo": "É outro número, anota aí",
        "destino": "enviar_whatsapp"
      },
      {
        "rotulo": "Não uso WhatsApp pro trabalho",
        "destino": "confirmar_por_email"
      }
    ],
    "campo": "whatsapp_de_trabalho"
  },
  {
    "id": "confirmar_por_email",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Mando por e-mail, então. Qual é o endereço certo? Eu te mando a confirmação com dia, hora e o formato, ainda hoje.",
    "saidas": [
      {
        "rotulo": "Anota aí, é esse",
        "destino": "fim_reuniao"
      },
      {
        "rotulo": "Deixa que eu te chamo",
        "destino": "fim_reuniao"
      }
    ],
    "campo": "email_de_confirmacao",
    "nota": "Gêmeo de `enviar_whatsapp` para quem não usa WhatsApp no trabalho. A reunião JÁ está combinada quando se chega aqui — as duas saídas fecham como reunião marcada, e é verdade."
  },
  {
    "id": "enviar_whatsapp",
    "tipo": "acao",
    "variante": "ambas",
    "texto": "Mande a confirmação agora, com dia, hora e o formato: link do vídeo ou endereço da visita. Espere a resposta antes de desligar.",
    "saidas": [
      {
        "rotulo": "Recebi aqui, tá certo",
        "destino": "fim_reuniao"
      },
      {
        "rotulo": "Depois eu vejo e confirmo",
        "destino": "fim_reuniao"
      }
    ],
    "nota": "Confirmar na hora é o que derruba no-show (R08 §4.1). Sem confirmação na hora a reunião fica marcada do mesmo jeito — quem cobra é o lembrete de 24 h antes."
  },
  {
    "id": "pedir_decisor",
    "tipo": "pergunta",
    "variante": "ambas",
    "texto": "Sem problema. Quem é que cuida dos eventos aí em [empresa]? Consigo falar com essa pessoa agora?",
    "saidas": [
      {
        "rotulo": "Vou te passar agora",
        "destino": "gancho_fornecedor"
      },
      {
        "rotulo": "Vou te passar agora",
        "destino": "gancho_produtor"
      },
      {
        "rotulo": "Agora essa pessoa não está",
        "destino": "anotar_decisor"
      },
      {
        "rotulo": "Não passo. Manda por e-mail",
        "destino": "anotar_email"
      },
      {
        "rotulo": "Não passo esse contato",
        "destino": "fim_agora_nao"
      }
    ],
    "nota": "Nunca \"com ele\" nem \"o nome dele\": quem decide pode ser qualquer pessoa. Quem atende e não passa, mas aceita e-mail, é ganho — não recusa."
  },
  {
    "id": "forn_explica",
    "tipo": "captura",
    "variante": "fornecedor",
    "texto": "A Komune é um app de eventos aqui de Natal: o cliente busca por data, tipo de evento e faixa de preço, e fala direto com você. Quantos eventos vocês fazem por mês hoje?",
    "saidas": [
      {
        "rotulo": "Uns dois ou três por mês",
        "valor": "2_3_por_mes",
        "destino": "forn_qualifica"
      },
      {
        "rotulo": "Uns quatro a oito por mês",
        "valor": "4_8_por_mes",
        "destino": "forn_qualifica"
      },
      {
        "rotulo": "Mais de dez por mês",
        "valor": "10_ou_mais_por_mes",
        "destino": "forn_qualifica"
      },
      {
        "rotulo": "Depende muito da época",
        "valor": "sazonal",
        "destino": "forn_qualifica"
      },
      {
        "rotulo": "Prefiro não falar disso",
        "valor": "nao_quis_dizer",
        "destino": "forn_proposta"
      }
    ],
    "campo": "eventos_por_mes",
    "nota": "46 → 24 palavras (~10 s), que é o que cabe na promessa de 40 segundos do obj_sem_tempo. Só recurso que existe na FAQ §7.5/§7.6: busca por tipo de evento, data e faixa de preço. Fora: orçamento em massa, contrato, calendário de disponibilidade, histórico de entrega."
  },
  {
    "id": "forn_indicacao",
    "tipo": "pergunta",
    "variante": "fornecedor",
    "texto": "Indicação e Instagram são o melhor que existe pra quem já ouviu falar de vocês. Só que isso some no mês em que o boca a boca dá uma parada. Na Komune, quem está procurando acha vocês sem depender de alguém lembrar. Isso te serve?",
    "saidas": [
      {
        "rotulo": "Faz sentido",
        "destino": "forn_qualifica"
      },
      {
        "rotulo": "Já tentei site desses, não deu",
        "destino": "obj_concorrente"
      },
      {
        "rotulo": "Não quero mais um app",
        "destino": "obj_mais_um_app"
      },
      {
        "rotulo": "Quem já está usando aí?",
        "destino": "obj_quem_ja_usa"
      },
      {
        "rotulo": "E quanto vocês cobram?",
        "destino": "obj_preco"
      },
      {
        "rotulo": "Não, não é o meu caso",
        "destino": "forn_sem_demanda"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      }
    ],
    "nota": "Redação do R08 §2.0 (\"indicação é o melhor canal; a Komune é isso em escala\"), sem menosprezar o boca a boca. Usa \"vocês\" no lugar de [empresa] — artigo colado em nome próprio quebra em ~30 dos 67 nomes da base."
  },
  {
    "id": "forn_ja_anuncia",
    "tipo": "pergunta",
    "variante": "fornecedor",
    "texto": "Entendi. Nesses portais você paga pela posição, feche ou não, e o telefone do cliente só vem no plano pago. De lá chega pedido de verdade, ou mais curioso perguntando preço?",
    "saidas": [
      {
        "rotulo": "Mais curioso que cliente",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Chega pedido, funciona bem",
        "destino": "obj_concorrente"
      },
      {
        "rotulo": "Pago e não fecha nada",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Não meço isso",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Não tenho interesse nisso",
        "destino": "fim_sem_interesse"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      }
    ],
    "nota": "Único nó do ramo que abre com muleta de reconhecimento, e a forma escolhida para todo o roteiro é \"Entendi\" (nunca \"Entendo\"/\"Entendido\"). O contraste com o portal é factual (paga por posição; telefone só no plano pago) — não é ataque, é a diferença."
  },
  {
    "id": "forn_proposta",
    "tipo": "pergunta",
    "variante": "fornecedor",
    "texto": "Então é o seguinte: não tem mensalidade nem fidelidade. A Komune fica com 8% do evento que fechar por lá — não fechou, você não paga. Me dá 20 minutos pra te mostrar funcionando?",
    "saidas": [
      {
        "rotulo": "Topo, vamos marcar",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Me manda por escrito antes",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "8% é muito",
        "destino": "obj_comissao"
      },
      {
        "rotulo": "Depois eu vejo",
        "destino": "forn_vou_ver"
      },
      {
        "rotulo": "Gostei, mas preciso pensar",
        "destino": "forn_vou_ver"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "fim_sem_interesse"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "É aqui que a recusa acontece de verdade, então é aqui que o opt-out precisa existir (RF-CON-18). Saiu \"entrar na lista não custa nada\" (encosta em \"grátis\") e entrou \"não tem mensalidade nem fidelidade\" + os 8%. Saiu também a promessa de mostrar \"como vocês apareceriam pra quem está procurando agora\", que sugere posição na vitrine."
  },
  {
    "id": "forn_qualifica",
    "tipo": "captura",
    "variante": "fornecedor",
    "texto": "Anotei. E o que pesa mais pra vocês hoje: mais pedido chegando, ou pedido melhor — já com a data e o número de pessoas?",
    "saidas": [
      {
        "rotulo": "Mais pedido chegando",
        "valor": "volume",
        "destino": "forn_proposta"
      },
      {
        "rotulo": "Pedido melhor, mais certo",
        "valor": "qualidade",
        "destino": "forn_proposta"
      },
      {
        "rotulo": "Os dois, na verdade",
        "valor": "volume_e_qualidade",
        "destino": "forn_proposta"
      },
      {
        "rotulo": "Prefiro não falar disso",
        "valor": "nao_quis_dizer",
        "destino": "forn_proposta"
      },
      {
        "rotulo": "Nenhum dos dois agora",
        "valor": "nenhum",
        "destino": "forn_sem_demanda"
      }
    ],
    "campo": "prioridade_do_dono",
    "nota": "Todo rótulo que É a resposta carrega `valor` — era aqui que o campo nascia vazio em toda ligação. \"Data e número de pessoas\" é a redação exata da FAQ §7.6 (o que o pedido traz), no lugar de \"orçamento já certo\"."
  },
  {
    "id": "forn_sem_demanda",
    "tipo": "pergunta",
    "variante": "fornecedor",
    "texto": "É o melhor problema de se ter, e é justamente quem já é referência na cidade que a gente quer. E nos meses mais parados, janeiro e fevereiro — vale eu te procurar antes deles?",
    "saidas": [
      {
        "rotulo": "Aí sim, me procura",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Me explica rápido o que é",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Não precisa não, valeu",
        "destino": "fim_sem_interesse"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      }
    ],
    "nota": "Concorde, não insista que a pessoa precisa (R08 §2.0). A baixa é janeiro e fevereiro, mais a quarta e a quinta vazias — nunca junho e julho, que aqui é São João e férias."
  },
  {
    "id": "forn_vou_ver",
    "tipo": "captura",
    "variante": "fornecedor",
    "texto": "Pode ser. Só pra eu não te encher à toa: o que pesa mais — a taxa, o app ser novo, ou o tempo de cadastrar?",
    "saidas": [
      {
        "rotulo": "A taxa",
        "valor": "taxa",
        "destino": "obj_preco"
      },
      {
        "rotulo": "O app ainda é novo",
        "valor": "app_novo",
        "destino": "obj_quem_ja_usa"
      },
      {
        "rotulo": "O tempo de cadastrar",
        "valor": "esforco_cadastro",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não é nada disso, só preciso pensar",
        "valor": "nao_quis_dizer",
        "destino": "combinar_retorno"
      }
    ],
    "campo": "motivo_da_duvida",
    "nota": "NÓ NOVO. \"Vou ver e te falo\" não pode terminar em \"fico no aguardo\": o R08 manda pergunta de clareza + data de retorno. Todas as saídas ou respondem a dúvida ou caem em combinar_retorno, que é onde a data é marcada. De quebra, o motivo vira campo e alimenta o relatório de motivo de perda."
  },
  {
    "id": "gancho_fornecedor",
    "tipo": "pergunta",
    "variante": "fornecedor",
    "texto": "A Komune é um app de eventos aqui de Natal. Quem vai fazer festa, formatura, casamento ou evento de empresa entra e acha fornecedor da cidade. Estou montando essa lista agora, e vocês entram na categoria [categoria]. Hoje, de onde vêm os seus clientes?",
    "saidas": [
      {
        "rotulo": "Indicação, boca a boca, Instagram",
        "destino": "forn_indicacao"
      },
      {
        "rotulo": "Já anuncio num site desses",
        "destino": "forn_ja_anuncia"
      },
      {
        "rotulo": "Tô com a agenda cheia",
        "destino": "forn_sem_demanda"
      },
      {
        "rotulo": "Como assim? Explica melhor",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Quanto vocês cobram?",
        "destino": "obj_preco"
      },
      {
        "rotulo": "Já sou parceiro, já me cadastrei",
        "destino": "fim_ja_e_parceiro"
      },
      {
        "rotulo": "Não atendo em Natal",
        "destino": "anotar_cidade"
      },
      {
        "rotulo": "A gente não trabalha com evento",
        "destino": "fim_sem_interesse"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "Gancho de DEMANDA (R13 §5): 44 palavras, termina em pergunta aberta sobre o negócio dele. Sem vocativo no começo — [nome] vem vazio em dois terços da base. [categoria] é aposto de 'categoria': vazio, a frase fecha em 'entram na categoria.' e continua correndo."
  },
  {
    "id": "gancho_produtor",
    "tipo": "pergunta",
    "variante": "produtor",
    "texto": "A Komune é um app de eventos aqui de Natal: os fornecedores da cidade num lugar só, com preço e avaliação na tela. Estou ligando pra quem organiza evento. Como você monta a lista hoje?",
    "saidas": [
      {
        "rotulo": "Planilha e WhatsApp",
        "destino": "prod_planilha"
      },
      {
        "rotulo": "Tenho os meus de sempre",
        "destino": "prod_ja_tem"
      },
      {
        "rotulo": "Cada evento é um corre",
        "destino": "prod_dor"
      },
      {
        "rotulo": "Eu faço assessoria, não produzo",
        "destino": "prod_cerimonial"
      },
      {
        "rotulo": "Explica melhor",
        "destino": "prod_explica"
      },
      {
        "rotulo": "Quanto vou pagar?",
        "destino": "obj_preco_prod"
      },
      {
        "rotulo": "Estou montando um evento agora",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Já sou parceiro de vocês",
        "destino": "fim_ja_e_parceiro"
      },
      {
        "rotulo": "Não sou de Natal",
        "destino": "anotar_cidade"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "Gancho de CONTROLE (R13 §5): 36 palavras, ~14 s, termina em pergunta. Não liste categorias de fornecedor — quem está do outro lado contrata fornecedor a semana inteira. Se [categoria] for cerimonialista ou assessoria, vá direto para prod_cerimonial: os 5% são a única coisa que vira essa conversa."
  },
  {
    "id": "prod_cerimonial",
    "tipo": "pergunta",
    "variante": "produtor",
    "texto": "Então a conversa muda: cerimonialista na Komune não paga — recebe. O fornecedor paga 8% do que fechar por lá, e isso se reparte: 3% pra Komune e 5% pra você, no contrato. Seu honorário com o cliente continua igual. Hoje, quando você indica um fornecedor, volta alguma coisa pra você?",
    "saidas": [
      {
        "rotulo": "Volta, mas é por fora mesmo",
        "destino": "obj_comissao_por_fora"
      },
      {
        "rotulo": "Não trabalho com comissão",
        "destino": "obj_comissao_por_fora"
      },
      {
        "rotulo": "E os 5% caem como?",
        "destino": "obj_preco_prod"
      },
      {
        "rotulo": "Interessante, me explica o resto",
        "destino": "prod_explica"
      },
      {
        "rotulo": "O app tem fornecedor de verdade?",
        "destino": "obj_tem_gente_prod"
      },
      {
        "rotulo": "Quero ver funcionando",
        "destino": "prod_proposta"
      }
    ],
    "nota": "R08 §2.5: cerimonialista não é fornecedor, é sócio do evento — não paga, recebe. Diga os 5% antes de qualquer outra coisa; sem eles a conversa é a do fornecedor, e ela está errada aqui."
  },
  {
    "id": "prod_dor",
    "tipo": "pergunta",
    "variante": "produtor",
    "texto": "Pois é. O que a Komune faz é isso: os fornecedores da cidade num lugar só, por categoria, com faixa de preço e avaliação. Você chama de dentro do app, e o pedido já vai com a data e o número de pessoas. Isso resolve alguma coisa pra você?",
    "saidas": [
      {
        "rotulo": "Resolve, sim",
        "destino": "prod_qualifica"
      },
      {
        "rotulo": "Não quero mais um app",
        "destino": "obj_mais_um_app_prod"
      },
      {
        "rotulo": "Tem fornecedor aí de verdade?",
        "destino": "obj_tem_gente_prod"
      },
      {
        "rotulo": "Explica melhor",
        "destino": "prod_explica"
      }
    ],
    "nota": "Cortados daqui, porque não existem: agenda de disponibilidade por data, contrato no painel e histórico de quem entregou bem. O que existe é busca por categoria, data e faixa de preço, avaliação na vitrine, e o pedido chegando com data e número de pessoas."
  },
  {
    "id": "prod_explica",
    "tipo": "captura",
    "variante": "produtor",
    "texto": "É simples: você acha o fornecedor por categoria, data e faixa de preço, e manda o pedido. A data e o número de pessoas já vão preenchidos, e quem responde com o preço é o fornecedor. A gente está montando a rede daqui de Natal, começando pela sua categoria, [categoria]. Quantos eventos vocês fazem por ano?",
    "saidas": [
      {
        "rotulo": "Faço evento o ano todo",
        "destino": "prod_qualifica",
        "valor": "ano_todo"
      },
      {
        "rotulo": "Uns poucos por ano",
        "destino": "prod_qualifica",
        "valor": "poucos"
      },
      {
        "rotulo": "Depende muito da época",
        "destino": "prod_qualifica",
        "valor": "sazonal"
      },
      {
        "rotulo": "Prefiro não dizer",
        "destino": "prod_proposta"
      }
    ],
    "campo": "eventos_por_ano",
    "nota": "Quem manda o PEDIDO é o produtor; quem manda orçamento é o fornecedor. Não existe disparo de orçamento para vários fornecedores de uma vez — nunca prometa isso. [categoria] pode vir vazio: precisa de valor padrão (“quem organiza evento”)."
  },
  {
    "id": "prod_ja_tem",
    "tipo": "pergunta",
    "variante": "produtor",
    "texto": "E eles continuam seus — dá pra trazer eles junto, e você segue negociando por fora com quem quiser. Só que, quando o cliente pede o que os seus não fazem, onde você procura?",
    "saidas": [
      {
        "rotulo": "Me viro no Google e no Instagram",
        "destino": "prod_dor"
      },
      {
        "rotulo": "Peço indicação",
        "destino": "prod_dor"
      },
      {
        "rotulo": "Nunca precisei",
        "destino": "prod_proposta"
      },
      {
        "rotulo": "Eles não vão querer pagar 8%",
        "destino": "prod_oito"
      },
      {
        "rotulo": "Quantos fornecedores vocês têm?",
        "destino": "obj_tem_gente_prod"
      }
    ],
    "nota": "Não menospreze os fornecedores dele: a saída é trazer os dele junto. Ele continua livre para negociar fora do app (R08 §2.6)."
  },
  {
    "id": "prod_planilha",
    "tipo": "pergunta",
    "variante": "produtor",
    "texto": "Todo mundo me diz isso. E quando um fornecedor some na semana do evento, quanto tempo você perde procurando outro?",
    "saidas": [
      {
        "rotulo": "Perco o dia inteiro",
        "destino": "prod_dor"
      },
      {
        "rotulo": "Já perdi evento assim",
        "destino": "prod_dor"
      },
      {
        "rotulo": "Isso quase não acontece",
        "destino": "prod_ja_tem"
      },
      {
        "rotulo": "Explica o que muda",
        "destino": "prod_explica"
      }
    ]
  },
  {
    "id": "prod_proposta",
    "tipo": "pergunta",
    "variante": "produtor",
    "texto": "Então é o seguinte: me dá 20 minutos e eu te mostro um evento montado por dentro, do seu lado. Pra você não tem mensalidade nem fidelidade. Topa marcar?",
    "saidas": [
      {
        "rotulo": "Topo, vamos marcar",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Me manda por escrito antes",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Depois eu vejo",
        "destino": "obj_vou_pensar"
      },
      {
        "rotulo": "Gostei, mas preciso pensar",
        "destino": "obj_vou_pensar"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "fim_sem_interesse"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "É aqui que a recusa acontece de verdade, por isso a saída de opt-out fica neste nó. Não prometa “uma oportunidade real em 30 dias”: depende do termo do Fundador, que ainda não está assinado."
  },
  {
    "id": "prod_qualifica",
    "tipo": "captura",
    "variante": "produtor",
    "texto": "Entendi. E qual é o maior aperto hoje: achar fornecedor novo, fornecedor que não responde, ou juntar preço e proposta num lugar só?",
    "saidas": [
      {
        "rotulo": "Achar fornecedor novo",
        "destino": "prod_proposta",
        "valor": "achar_fornecedor"
      },
      {
        "rotulo": "Fornecedor que não responde",
        "destino": "prod_proposta",
        "valor": "fornecedor_some"
      },
      {
        "rotulo": "Juntar preço e proposta",
        "destino": "prod_proposta",
        "valor": "orcamento_espalhado"
      },
      {
        "rotulo": "Nada disso me aperta",
        "destino": "prod_proposta",
        "valor": "nenhum"
      }
    ],
    "campo": "maior_aperto",
    "nota": "Cada saída carrega o próprio valor: sem isso o campo nasce vazio em toda ligação."
  },
  {
    "id": "fim_agora_nao",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Tranquilo. Não vou insistir agora — guardo o contato e só volto a falar se eu tiver alguma coisa nova pra contar. Valeu pelo tempo!",
    "saidas": [],
    "desfecho": "lig_agora_nao",
    "nota": "\"Agora não\" volta em 30 dias, em nutrição, e o toque seguinte precisa de motivo novo (R08 §3.1) — é só isso que o texto promete, porque é só isso que o sistema cumpre. Se a pessoa deu data ou gancho (\"me liga depois do Carnaval\"), o nó certo é o de retorno combinado, não este."
  },
  {
    "id": "fim_desligou",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Caiu, ou desligaram no meio — não tem de quem se despedir. Fecha por aqui: o retorno fica marcado, e o caminho da conversa fica gravado.",
    "saidas": [],
    "resultadoTecnico": "queda_de_linha",
    "nota": "Fecha pelo eixo TÉCNICO: ninguém recusou nada, a linha caiu. Está oferecido nos seis pontos em que se desliga de verdade, e é isso que faz `caminho_script` responder a pergunta do R13 §3.2 — em qual frase as pessoas desligam."
  },
  {
    "id": "fim_engano",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Desculpa, então — foi engano meu. Não incomodo mais. [saudacao]!",
    "saidas": [],
    "resultadoTecnico": "numero_invalido",
    "nota": "Atendeu, mas não houve conversa comercial: fecha pelo eixo técnico, não por uma recusa que ninguém fez. [saudacao] é recalculada na hora do fim, então às 19h a despedida é \"Boa noite\" — a mesma que a abertura usou, e não o \"bom dia\" fixo de antes. Aqui \"não incomodo mais\" é verdade: número errado é nunca mais (R13 §2.1)."
  },
  {
    "id": "fim_interessado",
    "tipo": "fim",
    "variante": "fornecedor",
    "texto": "Te mando agora no WhatsApp como funciona: não tem mensalidade, e são 8% só sobre o evento que fechar pela Komune. Aí a gente marca os 20 minutos. Valeu pelo tempo!",
    "saidas": [],
    "desfecho": "lig_interessado",
    "nota": "Interessado é quente e a próxima ação é marcar a apresentação. O nó vale para as duas variantes, por isso diz \"sem mensalidade\" (verdade para fornecedor e cerimonialista) e não diz 8% — quem organiza recebe 5%, não paga. O WhatsApp aqui é apoio da ligação (R13 §1), não canal novo."
  },
  {
    "id": "fim_interessado_prod",
    "tipo": "fim",
    "variante": "produtor",
    "texto": "Te mando agora no WhatsApp como funciona: você não paga mensalidade nenhuma. Quando você organiza, a Komune fica com 3% e você recebe 5%, no contrato. Aí a gente marca os 20 minutos. Valeu pelo tempo!",
    "saidas": [],
    "desfecho": "lig_interessado",
    "nota": "Gêmeo de produtor, porque a resposta é o inverso: quem organiza não paga, recebe. Um fecho único calaria o 8% para não mentir com o produtor — e calar o preço é o defeito que este roteiro existe para consertar."
  },
  {
    "id": "fim_ja_e_parceiro",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Então vocês já se cadastraram sozinhos — melhor ainda. Vou ver aqui o que falta pra publicar e te chamo no WhatsApp. Valeu pelo tempo!",
    "saidas": [],
    "desfecho": "lig_interessado",
    "nota": "As pessoas se cadastram sozinhas no site, e a coleta não sabe disso. Confira na base antes de tratar como parceiro: \"já me cadastrei\" também é jeito de encerrar ligação. Cadastro incompleto vira onboarding (R08 §4.3), não nova apresentação — o catálogo não tem chip para \"já é parceiro\" (teto de 8 desfechos), e lig_interessado é o que mantém o lead quente e em conversa."
  },
  {
    "id": "fim_nao_e_evento",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Ah, então foi a minha lista que errou: trouxe vocês como quem trabalha com evento. Corrijo aqui agora. Desculpa, e valeu pelo tempo!",
    "saidas": [],
    "desfecho": "lig_sem_interesse",
    "nota": "\"Somos essa empresa sim, mas não trabalhamos com evento\": o número está certo, a categoria da coleta é que estava errada — por isso NÃO é número inválido. A culpa fica na lista, não na pessoa. Antes de fechar, tire a organização da base de evento; senão ela volta na próxima coleta e a ligação se repete."
  },
  {
    "id": "fim_optout",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Desculpa o incômodo. Não apago o contato: marco como bloqueado, e é isso que impede a Komune de ligar ou escrever de novo.",
    "saidas": [],
    "desfecho": "lig_sem_interesse",
    "nota": "Opt-out imediato (RF-CON-18), e vale para os dois canais (R13 §6). ANTES de tabular, marque a supressão: sem ela o desfecho sozinho é Perdido com 90 dias de espera, e a promessa desta frase vira mentira em 90 dias. Pedido de exclusão de dados não se resolve ao telefone — anote e encaminhe ao canal de privacidade."
  },
  {
    "id": "fim_retorna",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Então eu te ligo [dia] [hora]. Anotei aqui, e não vou te procurar antes disso. Valeu pelo tempo!",
    "saidas": [],
    "desfecho": "lig_atendeu_retorna",
    "nota": "Este é o nó COM data na mão: retorno combinado espera 2 dias e fica morno (R13 §2.1). Sem data, o nó é o de \"agora não\"."
  },
  {
    "id": "fim_reuniao",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Nos falamos [dia] [hora], então. Já te mandei a confirmação no WhatsApp — qualquer coisa, me chama por lá. Valeu pelo tempo!",
    "saidas": [],
    "desfecho": "lig_reuniao_marcada",
    "nota": "Confirmar na hora é o que derruba no-show (R08 §4.1). Se [dia] e [hora] saírem vazios a frase se segura sozinha — mas aí não há reunião marcada: volte e combine a data."
  },
  {
    "id": "fim_sem_interesse",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Entendi. Não vou insistir, então. Se um dia mudar, a porta fica aberta aqui. Valeu pelo tempo, e bom trabalho aí!",
    "saidas": [],
    "desfecho": "lig_sem_interesse",
    "nota": "Redação do R08 GEN-SYS-NAO-FIRME, sem gênero e sem agradecer a franqueza — agradecer a sinceridade depois de um não sobe o tom. Perdido, com 90 dias de espera (R13 §2.1): por isso o nó não promete \"nunca mais te ligo\". Se a pessoa pedir para não ser mais procurada, o nó é o de opt-out, e aí não tem volta."
  },
  {
    "id": "obj_comissao",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "Entendo. Não é comissão sobre o que vocês já vendem: é só sobre o evento que chegar pela Komune e fechar. Não chegou, não paga. Num portal você paga pra aparecer, feche ou não, e o telefone do cliente só vem no plano pago. Aqui é depois, e só se fechar. Assim ainda pesa?",
    "saidas": [
      {
        "rotulo": "Assim muda de figura",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Mesmo assim não trabalho com isso",
        "destino": "fim_sem_interesse"
      },
      {
        "rotulo": "E vocês tabelam meu preço?",
        "destino": "obj_meu_preco"
      },
      {
        "rotulo": "Me liga mais pra frente",
        "destino": "combinar_retorno"
      }
    ],
    "nota": "Não defenda a taxa nem compare com iFood (R08 §2.0). Objeção de comissão pela segunda vez na mesma ligação: pare de argumentar e combine retorno."
  },
  {
    "id": "obj_comissao_por_fora",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Entendo, e é por isso que a gente fez diferente. Não é BV por baixo dos panos: os 5% estão no contrato, o fornecedor sabe e o seu cliente pode ver. Quem não quiser receber, reverte em desconto pro cliente. Aqui a transparência é o argumento, não o problema. Isso te serve melhor do que o jeito de hoje?",
    "saidas": [
      {
        "rotulo": "Assim eu topo, me mostra",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "E quanto o fornecedor paga?",
        "destino": "obj_preco_prod"
      },
      {
        "rotulo": "Não quero receber comissão nenhuma",
        "destino": "prod_proposta"
      },
      {
        "rotulo": "Tá, e como funciona na prática?",
        "destino": "prod_explica"
      },
      {
        "rotulo": "Ajuda, assim eu falo aberto",
        "destino": "prod_proposta"
      },
      {
        "rotulo": "Mesmo assim não quero receber",
        "destino": "prod_explica"
      },
      {
        "rotulo": "E o fornecedor topa pagar isso?",
        "destino": "prod_oito"
      },
      {
        "rotulo": "Vou ver e te falo",
        "destino": "obj_vou_pensar"
      }
    ],
    "nota": "Não cite o percentual do BV de mercado nem compare com ele. O argumento é o contrato à luz do dia, nunca o valor."
  },
  {
    "id": "obj_concorrente",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "Conheço, e não vim pedir pra você sair de lá. Só que lá você paga pela posição, feche ou não, e o telefone do cliente costuma vir só no plano pago. Aqui você paga quando fecha. E a gente é daqui de Natal: formatura, corporativo e aniversário também. Dá pra ter os dois. Vale eu te mostrar a diferença?",
    "saidas": [
      {
        "rotulo": "Vale, me mostra",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "De lá já chega cliente bom",
        "destino": "forn_proposta"
      },
      {
        "rotulo": "Já gastei com site e não deu nada",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Por enquanto não",
        "destino": "fim_agora_nao"
      }
    ],
    "nota": "Nunca ataque o concorrente: complemente (R08 §1, intenção 4). O contraste é a conta — posição paga contra pagar quando fecha."
  },
  {
    "id": "obj_concorrente_prod",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Conheço. Aquilo é vitrine, pra cliente te achar, e continua servindo. A Komune é a outra ponta: montar o evento, falar com fornecedor e receber a sua parte no mesmo lugar. Uma coisa não tira a outra. Vale 20 minutos pra você ver a diferença?",
    "saidas": [
      {
        "rotulo": "Vale, me mostra",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Já tenho meus fornecedores",
        "destino": "obj_nao_preciso_prod"
      },
      {
        "rotulo": "E eu recebo o quê mesmo?",
        "destino": "obj_preco_prod"
      },
      {
        "rotulo": "Por enquanto não",
        "destino": "fim_agora_nao"
      }
    ]
  },
  {
    "id": "obj_financeiro",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Essa eu não vou responder de cabeça, pra não falar besteira. Prazo de repasse, cancelamento, nota fiscal e exigência de CNPJ eu confirmo com o financeiro e te mando por escrito hoje. O que já está fechado eu te falo na hora: sem mensalidade, e a Komune só ganha quando um evento fecha por lá. Pode ser nesse mesmo número?",
    "saidas": [
      {
        "rotulo": "Pode, manda por escrito",
        "destino": "fim_interessado"
      },
      {
        "rotulo": "Pode, manda por escrito",
        "destino": "fim_interessado_prod"
      },
      {
        "rotulo": "Tá, e quanto custa afinal?",
        "destino": "obj_preco"
      },
      {
        "rotulo": "Tá, e eu recebo quanto?",
        "destino": "obj_preco_prod"
      },
      {
        "rotulo": "Tá, pode continuar",
        "destino": "forn_proposta"
      },
      {
        "rotulo": "Tá, pode continuar",
        "destino": "prod_proposta"
      },
      {
        "rotulo": "Sem isso eu não sigo",
        "destino": "fim_agora_nao"
      }
    ],
    "nota": "Só o que NÃO está na FAQ cai aqui: prazo de repasse, cancelamento, nota fiscal, CNPJ. A taxa está na FAQ e se diz na hora — usar este nó para não responder 8% é usar o validador ao contrário."
  },
  {
    "id": "obj_golpe",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Faz bem em perguntar. Meu nome é [eu], sou da Komune, aqui de Natal. O site é komune.app.br, e no Instagram é arroba komune ponto natal. Pode conferir agora que eu espero. Peguei o contato de vocês [origem]. E eu não peço CPF nem dado bancário por telefone. Quer que eu te mande no WhatsApp, agora, o aviso de privacidade?",
    "saidas": [
      {
        "rotulo": "Manda que eu confiro",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Agora entendi, pode falar",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Agora entendi, pode falar",
        "destino": "prod_explica"
      },
      {
        "rotulo": "Confere e me liga outra hora",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      }
    ],
    "nota": "Numa ligação não existe link pra clicar: a prova é verificável na hora — nome de quem liga, komune.app.br, @komune.natal e a origem do contato. Se insistir, é humano: pare de vender e ofereça o aviso de privacidade."
  },
  {
    "id": "obj_hostil",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Você tem razão, e eu peço desculpa. Vou parar agora e registrar isso, pra ninguém te procurar de novo. Prefere que eu tire o contato de vocês de vez, ou que eu só não ligue mais por um tempo?",
    "saidas": [
      {
        "rotulo": "Tira de vez, não me ligue mais",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Só não me liga tão cedo",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "Prioridade absoluta (R08 §1, intenção 14): desculpa, para a cadência, e só. Não retome o pitch, não pergunte o motivo, não ofereça reunião. Se houver xingamento, agradeça e encerre."
  },
  {
    "id": "obj_mais_um_app",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "Você não precisa instalar nada nem mudar o seu jeito de trabalhar. O pedido chega no seu WhatsApp, como já chega hoje, só que com a data e o número de pessoas já escritos. E o cadastro a gente faz junto com você. Assim ainda é mais um app?",
    "saidas": [
      {
        "rotulo": "Assim tudo bem, me mostra",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Mesmo assim, não quero",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "E quanto custa isso?",
        "destino": "obj_preco"
      },
      {
        "rotulo": "Tá, e como chega cliente pra mim?",
        "destino": "forn_explica"
      }
    ],
    "nota": "Só prometa o que a FAQ cobre: busca, vitrine com avaliação e o pedido chegando com data e número de pessoas. Nada de contrato, agenda ou orçamento em massa."
  },
  {
    "id": "obj_mais_um_app_prod",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Não é mais um app pra alimentar. É onde para de se perder o que você já faz no WhatsApp e na planilha. E você continua fechando por fora com quem quiser: só entra na conta o que passar pela Komune. Quer ver com um evento seu?",
    "saidas": [
      {
        "rotulo": "Quero ver, vamos marcar",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Meu jeito de hoje funciona",
        "destino": "obj_nao_preciso_prod"
      },
      {
        "rotulo": "Mesmo assim, não quero",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "Tá, e como funciona na prática?",
        "destino": "prod_explica"
      },
      {
        "rotulo": "Num evento eu testo",
        "destino": "prod_proposta"
      },
      {
        "rotulo": "Mesmo assim, não",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "prod_explica"
      }
    ]
  },
  {
    "id": "obj_meu_preco",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "O preço é de vocês. A Komune não tabela e não pede desconto. E ninguém briga por preço lá: o cliente vê o trabalho, as fotos e as avaliações antes. Dá pra cadastrar pacotes diferentes. No Pix a gente absorve a taxa, e no cartão o cliente vê o valor total na vitrine. Era isso que te preocupava?",
    "saidas": [
      {
        "rotulo": "Era, e assim tá certo",
        "destino": "forn_proposta"
      },
      {
        "rotulo": "E vocês ficam com quanto?",
        "destino": "obj_preco"
      },
      {
        "rotulo": "Quero ver isso na tela",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Mesmo assim, não",
        "destino": "fim_sem_interesse"
      }
    ],
    "nota": "Nunca prometa que o fornecedor vai vender mais caro nem que o cliente paga mais (R08 §5.4)."
  },
  {
    "id": "obj_meu_preco_prod",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Seu honorário continua o mesmo, cobrado do seu jeito. A Komune não entra no seu contrato com o cliente e não tabela ninguém. Os 5% são por fora disso, sobre o que os fornecedores fecharem pela plataforma nos eventos que você organiza. Era isso que você queria saber?",
    "saidas": [
      {
        "rotulo": "Era isso, tá bom",
        "destino": "prod_proposta"
      },
      {
        "rotulo": "E o fornecedor paga quanto?",
        "destino": "obj_preco_prod"
      },
      {
        "rotulo": "Quero ver isso na tela",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Mesmo assim, não",
        "destino": "fim_sem_interesse"
      }
    ]
  },
  {
    "id": "obj_nao_preciso",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "Que bom, é o melhor problema de se ter. E é quem já está cheio que a gente quer como fundador, não quem está começando. Só que agenda cheia hoje não é agenda cheia em janeiro. Dá pra deixar o perfil pronto agora, sem mensalidade, e você aceita só o pedido que quiser. Faz sentido?",
    "saidas": [
      {
        "rotulo": "Faz sentido, me mostra",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Me procura em janeiro",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "E quanto custa isso?",
        "destino": "obj_preco"
      },
      {
        "rotulo": "Não, valeu",
        "destino": "fim_sem_interesse"
      }
    ],
    "nota": "Concorde, não insista que a pessoa precisa (R08 §2.0). Quem está lotado é justamente quem a gente quer como fundador."
  },
  {
    "id": "obj_nao_preciso_prod",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "E eles continuam sendo seus. Dá até pra trazer os seus junto, como fundadores. A Komune não troca ninguém: ela junta evento, fornecedor e pagamento num lugar só, e ainda te paga por organizar por lá. Isso te ajudaria em alguma coisa?",
    "saidas": [
      {
        "rotulo": "Ajudaria, vamos ver",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Me procura mais pra frente",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "E eu recebo quanto?",
        "destino": "obj_preco_prod"
      },
      {
        "rotulo": "Não, valeu",
        "destino": "fim_sem_interesse"
      }
    ]
  },
  {
    "id": "obj_origem",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Peguei o contato de vocês [origem]. A gente usa isso só pra convidar quem trabalha com evento aqui de Natal. Se você não quiser mais receber ligação, eu registro agora. O número entra numa lista de bloqueio, e é ela que impede a gente de te procurar de novo. Quer que eu registre, ou dá pra eu contar por que liguei?",
    "saidas": [
      {
        "rotulo": "Pode contar, mas seja rápido",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Pode contar, mas seja rápido",
        "destino": "prod_explica"
      },
      {
        "rotulo": "Não quero mais receber ligação",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Me liga outra hora",
        "destino": "combinar_retorno"
      }
    ],
    "nota": "Transparência de origem é exigência do legítimo interesse (R06; R13 §5). Nunca diga que apaga o contato: o número vai para a suppression_list e continua lá justamente para ninguém voltar a ligar. Pedido de parar é opt-out imediato, e vale para ligação e WhatsApp."
  },
  {
    "id": "obj_preco",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "Direto ao ponto: não tem mensalidade, adesão nem fidelidade. Vocês pagam 8% só sobre o evento que fechar pela Komune. Não fechou, você não paga. E o preço continua sendo de vocês. Faz sentido eu te mostrar como isso aparece na tela?",
    "saidas": [
      {
        "rotulo": "Faz, me mostra",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "8% é muito",
        "destino": "obj_comissao"
      },
      {
        "rotulo": "Vou ter que baixar meu preço?",
        "destino": "obj_meu_preco"
      },
      {
        "rotulo": "E quando cai o dinheiro?",
        "destino": "obj_financeiro"
      },
      {
        "rotulo": "Tá, e como chega cliente pra mim?",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Assim tudo bem",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Já entendi, vamos marcar",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Mesmo assim, não trabalho assim",
        "destino": "obj_comissao"
      }
    ],
    "nota": "A taxa se diz na hora. Esconder até a reunião parece pegadinha (R08 §1, intenção 3). 8% é FAQ aprovada, não é dúvida de financeiro."
  },
  {
    "id": "obj_preco_prod",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Aí é o contrário: você não paga nada. Quem paga é o fornecedor, 8% do que fechar pela Komune. E desses oito, cinco vão pra você. Três ficam com a gente. Está no contrato, e cai automático quando o evento fecha. Quer ver isso montado num evento seu?",
    "saidas": [
      {
        "rotulo": "Quero ver isso funcionando",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Não gosto de comissão por fora",
        "destino": "obj_comissao_por_fora"
      },
      {
        "rotulo": "E o meu honorário, muda?",
        "destino": "obj_meu_preco_prod"
      },
      {
        "rotulo": "Quando cai esse dinheiro?",
        "destino": "obj_financeiro"
      },
      {
        "rotulo": "Tá, e como funciona na prática?",
        "destino": "prod_explica"
      },
      {
        "rotulo": "Isso serve, quero ver",
        "destino": "prod_proposta"
      },
      {
        "rotulo": "Sou cerimonialista, como fica?",
        "destino": "prod_cerimonial"
      },
      {
        "rotulo": "Meus fornecedores não pagam 8%",
        "destino": "prod_oito"
      }
    ],
    "nota": "Cerimonialista e produtor RECEBEM. Nunca ofereça a versão do fornecedor a quem organiza — é o defeito que este nó existe para corrigir."
  },
  {
    "id": "obj_quem_ja_usa",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Vou te dar o número real: dois fornecedores publicados hoje. A gente está montando agora. É por isso que existe o programa Fundador: destaque rotativo na vitrine, selo e o cadastro feito junto com você. E os eventos que a Komune produz aqui em Natal contratam fornecedor pelo app. Quer ver como fica?",
    "saidas": [
      {
        "rotulo": "Quero ver como fica",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Dois? Então é muito cedo",
        "destino": "obj_tem_gente"
      },
      {
        "rotulo": "Dois? Então é muito cedo",
        "destino": "obj_tem_gente_prod"
      },
      {
        "rotulo": "Me chama quando tiver mais gente",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Me manda por escrito",
        "destino": "fim_interessado"
      },
      {
        "rotulo": "Me manda por escrito",
        "destino": "fim_interessado_prod"
      }
    ],
    "nota": "Proibido: exclusividade (\"um por segmento\") e posição na vitrine (\"quem entra agora aparece primeiro\"). O que existe é destaque rotativo, 10 por vez. Nome de fundador só com autoriza_citar_nome = true; sem autorização, fale da categoria do evento, nunca do nome."
  },
  {
    "id": "obj_sem_tempo",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Liguei em hora ruim, eu sei. São 40 segundos: eu digo o que é e, se não servir, você me manda parar. Posso?",
    "saidas": [
      {
        "rotulo": "Pode, fala rápido",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Pode, fala rápido",
        "destino": "prod_explica"
      },
      {
        "rotulo": "Me liga outra hora",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      }
    ]
  },
  {
    "id": "obj_tem_gente",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "Vou ser transparente: são quase 15 mil contas criadas, e elas vieram dos ingressos dos eventos que a própria Komune produz aqui em Natal. Instalação do app, umas 400. A vitrine de fornecedor está nascendo agora. E os nossos eventos contratam fornecedor por lá. Quer ver de perto antes de decidir?",
    "saidas": [
      {
        "rotulo": "Quero ver de perto",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "E quem já está lá dentro?",
        "destino": "obj_quem_ja_usa"
      },
      {
        "rotulo": "Me chama quando crescer",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "É novo demais pra mim",
        "destino": "fim_agora_nao"
      }
    ],
    "nota": "Nunca \"15 mil usuários\" seco: o número anda junto com a origem. Nada de prometer volume de pedidos nem a oportunidade em 30 dias — o termo do Fundador não está assinado."
  },
  {
    "id": "obj_tem_gente_prod",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Vou ser transparente: são quase 15 mil contas criadas, vindas dos ingressos dos eventos que a Komune produz aqui em Natal. Umas 400 instalações. Só que pra você isso pesa pouco: o cliente é seu, você já tem. O que muda é montar o evento num lugar só e receber a sua parte. Isso vale 20 minutos?",
    "saidas": [
      {
        "rotulo": "Vale, vamos marcar",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "E quem já está lá dentro?",
        "destino": "obj_quem_ja_usa"
      },
      {
        "rotulo": "Me chama quando crescer",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "É novo demais pra mim",
        "destino": "fim_agora_nao"
      },
      {
        "rotulo": "Então é cedo pra mim",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Quero dar uma olhada",
        "destino": "prod_proposta"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "prod_explica"
      }
    ]
  },
  {
    "id": "obj_vou_pensar",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Tranquilo. Só pra eu não te encher à toa: o que pesa mais pra decidir? É a taxa, o app ainda ser novo, ou o tempo de cadastrar? Me diz que eu te mando só isso, e a gente já marca o dia da minha ligação. Qual dia é bom pra você?",
    "saidas": [
      {
        "rotulo": "É a taxa",
        "destino": "obj_preco"
      },
      {
        "rotulo": "É a taxa",
        "destino": "obj_preco_prod"
      },
      {
        "rotulo": "É o app ainda ser novo",
        "destino": "obj_tem_gente"
      },
      {
        "rotulo": "É o app ainda ser novo",
        "destino": "obj_tem_gente_prod"
      },
      {
        "rotulo": "Pode me ligar semana que vem",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Então marca logo a conversa",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Não precisa, não tenho interesse",
        "destino": "fim_sem_interesse"
      },
      {
        "rotulo": "É o dinheiro que pesa",
        "destino": "obj_preco_prod"
      }
    ],
    "nota": "Proibido responder \"fico no aguardo\" (R08 §2.0): pergunta de clareza e data combinada na hora. Sem dia marcado, isto não é um sim — é um não devagar."
  },
  {
    "id": "obj_whatsapp",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Mando sim, agora mesmo: quem a gente é, o site e o custo por escrito. Só que o que vale mesmo é ver a tela, e isso não cabe em mensagem. Me dá 20 minutos e, se não servir, você me diz que eu paro de te procurar. Que dia é melhor?",
    "saidas": [
      {
        "rotulo": "Tudo bem, vamos marcar",
        "destino": "agendar_reuniao"
      },
      {
        "rotulo": "Manda que eu vejo com calma",
        "destino": "fim_interessado"
      },
      {
        "rotulo": "Manda que eu vejo com calma",
        "destino": "fim_interessado_prod"
      },
      {
        "rotulo": "Tá, e como chega cliente pra mim?",
        "destino": "forn_explica"
      },
      {
        "rotulo": "Tá, e como funciona na prática?",
        "destino": "prod_explica"
      }
    ],
    "nota": "Mandar é promessa: mande de verdade ainda na ligação. O WhatsApp aqui é apoio da ligação (R13 §1), não a saída dela."
  },
  {
    "id": "prod_oito",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Ele não paga pra aparecer, e não tem mensalidade: paga quando o evento fecha por lá, e o preço quem põe é ele. Não fechou, não paga. Vale eu mostrar isso pra eles junto com você?",
    "saidas": [
      {
        "rotulo": "Faz sentido, pode mostrar",
        "destino": "prod_proposta"
      },
      {
        "rotulo": "Continuo achando caro",
        "destino": "obj_vou_pensar"
      },
      {
        "rotulo": "Volta pro assunto",
        "destino": "prod_explica"
      }
    ],
    "nota": "Nunca prometa exclusividade, posição na vitrine nem volume de pedido. O preço é do fornecedor: a Komune não tabela nem negocia por ele."
  }
]
$roteiro$::jsonb, true)
on conflict (slug, versao) do update
  set nome         = excluded.nome,
      arvore       = excluded.arvore,
      is_published = excluded.is_published;

commit;
