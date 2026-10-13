-- =====================================================================
-- O roteiro fica mais humano (captacao_v1, versão 4)
--
-- Pedido de 13/10/2026: "O que precisamos melhorar são os scripts das falas
-- para as pessoas, deixando mais natural e humano."
--
-- O QUE MUDA: só as FALAS. A árvore é a da v3 (20260915100000) nó por nó — os
-- mesmos ids, as mesmas saídas e rótulos, as mesmas variantes —, então os
-- relatórios de "em qual frase a pessoa desliga" (v_call_script_steps) seguem
-- comparáveis entre as duas versões.
--
-- Como as frases foram reescritas:
--   * jeito de falar, não de ler: frases curtas, "tá", "pra", "né", "viu?",
--     "rapidinho", "lembrei de vocês" — o português falado de Natal;
--   * acolher antes de responder: "Entendo", "Claro", "Ah, que bom!", "Poxa,
--     liguei em hora ruim, né?";
--   * a abertura se apresenta como gente daqui ("sou da Komune, aqui de Natal");
--   * o fim de quem pede para sair diz o que acontece ("ninguém da Komune vai te
--     ligar nem escrever de novo") em vez de explicar a lista de bloqueio.
--
-- O QUE NÃO MUDA, de propósito (e os testes de roteiro-publicado.test.ts
-- continuam valendo contra ESTE arquivo):
--   * a origem do contato e o "tiro da lista" logo depois da abertura (R06);
--   * ao fornecedor, "de graça" e "não tem mensalidade", sem percentual;
--   * ao produtor, os 5% depois da entrega, e "quem paga é o fornecedor";
--   * nenhuma promessa de exclusividade, posição, volume ou de apagar contato;
--   * nada de gênero presumido ("obrigado/a", "com ele"), nem artigo colado em
--     [empresa], nem "casamento" sozinho.
--
-- A v3 sai de publicação e FICA na tabela: o lote congela script_id e versão
-- na montagem, e os lotes montados com ela continuam lendo a árvore dela.
--
-- RF-CON-18, RF-FUN-12 · R13 §3.2
-- =====================================================================

update public.call_scripts set is_published = false
 where slug = 'captacao_v1' and is_published and versao <> 4;

insert into public.call_scripts (slug, nome, versao, arvore, is_published)
values ('captacao_v1', 'Ligação — fornecedor, produtor e ativação (v4)', 4, $roteiro$[
  {
    "id": "abertura",
    "tipo": "pergunta",
    "variante": "captacao",
    "texto": "[saudacao], tudo bem? Meu nome é [eu], sou da Komune, aqui de Natal. Falo com [interlocutor]?",
    "saidas": [
      {
        "rotulo": "Sou eu",
        "destino": "permissao"
      },
      {
        "rotulo": "Não é comigo",
        "destino": "pedir_decisor"
      },
      {
        "rotulo": "Não posso falar agora",
        "destino": "obj_sem_tempo"
      },
      {
        "rotulo": "Tô dirigindo / no meio de um evento",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Aqui não é [empresa]",
        "destino": "fim_engano"
      },
      {
        "rotulo": "Somos, mas não trabalhamos com evento",
        "destino": "fim_nao_e_evento"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "Fale no seu ritmo, sorrindo: o roteiro é guia, não texto decorado. Pode trocar uma palavra por outra sua, desde que o sentido fique. Confirmar com quem está falando antes de qualquer outra coisa. Sem nome na ficha, a pergunta vira \"quem cuida dos eventos aí\"."
  },
  {
    "id": "permissao",
    "tipo": "pergunta",
    "variante": "captacao",
    "texto": "Que bom falar com você, [nome]! Vou ser rapidinho. Peguei o contato de vocês [origem] e queria te contar uma novidade aqui da cidade. Se não fizer sentido pra você, é só me falar que eu tiro da lista, tá? Posso te tomar um minutinho?",
    "saidas": [
      {
        "rotulo": "Pode falar",
        "destino": "forn_quem_somos"
      },
      {
        "rotulo": "Pode falar",
        "destino": "prod_quem_somos"
      },
      {
        "rotulo": "Agora não dá",
        "destino": "obj_sem_tempo"
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
        "rotulo": "Tira da lista, não quero",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "Pedir permissão aumenta a escuta. A origem do contato e o jeito de sair da lista são obrigação de LGPD (R06): as duas meias frases não saem."
  },
  {
    "id": "forn_quem_somos",
    "tipo": "fala",
    "variante": "fornecedor",
    "texto": "Bom, a Komune é um aplicativo daqui de Natal pra quem tá organizando um evento — aniversário, casamento, formatura, festa de empresa. A pessoa monta o evento no app e já contrata os fornecedores da cidade por ali mesmo.",
    "saidas": [
      {
        "rotulo": "Seguir",
        "destino": "forn_motivo"
      }
    ]
  },
  {
    "id": "forn_motivo",
    "tipo": "fala",
    "variante": "fornecedor",
    "texto": "A gente tá chamando os primeiros fornecedores parceiros, e [area] é uma das coisas que o pessoal mais procura. Por isso lembrei de vocês.",
    "saidas": [
      {
        "rotulo": "Seguir",
        "destino": "forn_valor"
      }
    ]
  },
  {
    "id": "forn_valor",
    "tipo": "fala",
    "variante": "fornecedor",
    "texto": "E o melhor: estar na Komune é de graça. Não tem mensalidade, não tem taxa de adesão, nada fixo — vocês só pagam quando fecham um serviço por lá. E quem entra agora já fica lá dentro quando o pessoal da cidade começar a procurar.",
    "saidas": [
      {
        "rotulo": "Seguir",
        "destino": "forn_fechamento"
      },
      {
        "rotulo": "Quanto é a taxa?",
        "destino": "obj_taxa"
      }
    ],
    "nota": "Ênfase na gratuidade de estar na plataforma. O número da taxa não se diz na ligação: quem mostra a conta é a apresentação."
  },
  {
    "id": "forn_fechamento",
    "tipo": "pergunta",
    "variante": "fornecedor",
    "texto": "O que eu queria mesmo era marcar uns 20 minutinhos pra te mostrar a plataforma por dentro e como funciona o cadastro. Pra você fica melhor [opcao1] ou [opcao2]? Pode ser por vídeo ou eu passo aí, como você preferir.",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Manda no WhatsApp",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Quanto é a taxa?",
        "destino": "obj_taxa"
      },
      {
        "rotulo": "Não sou eu quem decide",
        "destino": "obj_nao_decide"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "obj_sem_interesse"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      }
    ],
    "nota": "Sempre duas opções concretas, nunca \"podemos marcar?\". Toque no horário que a pessoa escolheu antes de seguir."
  },
  {
    "id": "obj_taxa",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "Custo fixo não tem nenhum: estar na Komune é de graça, e só tem custo quando vocês fecham negócio por lá. Na conversa de 20 minutos eu te mostro a conta direitinho. Fica bom [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Mas quanto é?",
        "destino": "forn_taxa_insiste"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Manda no WhatsApp",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "obj_sem_interesse"
      }
    ],
    "nota": "Não diga o percentual. O foco é a reunião, com ênfase no que é de graça."
  },
  {
    "id": "forn_taxa_insiste",
    "tipo": "pergunta",
    "variante": "fornecedor",
    "texto": "É uma porcentagem só do serviço que vocês fecharem pela Komune. Antes disso, não sai nada do bolso de vocês. A conta certinha eu te mostro na apresentação, com calma: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Manda no WhatsApp",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "obj_sem_interesse"
      }
    ],
    "nota": "Resposta para quem insiste pela segunda vez. Honesta sem dizer o número; se insistir de novo, combine a apresentação e não argumente mais."
  },
  {
    "id": "obj_concorrente",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "Conheço, sim, e não tô pedindo pra você sair de lá, viu? A diferença tá na conta: lá você paga pra aparecer, fechando ou não. Na Komune, estar lá é de graça, e só tem custo quando fecha. Dá pra ficar nos dois. Te mostro a diferença rapidinho: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "De lá já chega cliente bom",
        "destino": "forn_valor"
      },
      {
        "rotulo": "Por enquanto não",
        "destino": "fim_agora_nao"
      }
    ],
    "nota": "Nunca ataque o concorrente: complemente (R08 §1, intenção 4)."
  },
  {
    "id": "obj_nao_preciso",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "Ah, que bom! Esse é o melhor problema que tem. E é justamente quem já é referência aqui na cidade que a gente quer entre os primeiros parceiros. Estar na Komune não custa nada, e vocês só aceitam o pedido que quiserem. Vale eu te mostrar em 20 minutinhos?",
    "saidas": [
      {
        "rotulo": "Faz, vamos marcar",
        "destino": "forn_fechamento"
      },
      {
        "rotulo": "Me procura mais pra frente",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não, valeu",
        "destino": "fim_sem_interesse"
      }
    ],
    "nota": "Concorde, não insista que a pessoa precisa (R08 §2.0)."
  },
  {
    "id": "obj_mais_um_app",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "Entendo, ninguém quer mais uma coisa pra cuidar. Mas vocês não precisam mudar o jeito de trabalhar: o pedido já chega com a data e o número de pessoas, e o cadastro a gente faz junto com você. Assim fica mais tranquilo?",
    "saidas": [
      {
        "rotulo": "Assim tudo bem, me mostra",
        "destino": "forn_fechamento"
      },
      {
        "rotulo": "E quanto custa isso?",
        "destino": "obj_taxa"
      },
      {
        "rotulo": "Mesmo assim, não quero",
        "destino": "fim_agora_nao"
      }
    ],
    "nota": "Só prometa o que a FAQ cobre: busca, vitrine com avaliação e o pedido chegando com data e número de pessoas."
  },
  {
    "id": "obj_meu_preco",
    "tipo": "objecao",
    "variante": "fornecedor",
    "texto": "O preço continua sendo de vocês. A Komune não tabela e não pede desconto. E o cliente vê o trabalho, as fotos e as avaliações antes de pedir. Era isso que te preocupava?",
    "saidas": [
      {
        "rotulo": "Era, e assim tá certo",
        "destino": "forn_fechamento"
      },
      {
        "rotulo": "E vocês ficam com quanto?",
        "destino": "obj_taxa"
      },
      {
        "rotulo": "Mesmo assim, não",
        "destino": "fim_sem_interesse"
      }
    ],
    "nota": "Nunca prometa que o fornecedor vai vender mais caro nem que o cliente paga mais (R08 §5.4)."
  },
  {
    "id": "prod_quem_somos",
    "tipo": "fala",
    "variante": "produtor",
    "texto": "A Komune é um aplicativo daqui de Natal pra quem organiza evento. Você monta o evento no app e contrata os fornecedores da cidade por ali, já vendo preço e avaliação, tudo num lugar só.",
    "saidas": [
      {
        "rotulo": "Seguir",
        "destino": "prod_motivo"
      }
    ]
  },
  {
    "id": "prod_motivo",
    "tipo": "fala",
    "variante": "produtor",
    "texto": "A gente tá escolhendo os primeiros organizadores parceiros, e quem organiza evento como vocês é quem mais aproveita. Por isso lembrei de vocês.",
    "saidas": [
      {
        "rotulo": "Seguir",
        "destino": "prod_valor"
      }
    ]
  },
  {
    "id": "prod_valor",
    "tipo": "fala",
    "variante": "produtor",
    "texto": "E o principal: pra você não tem custo nenhum. Pelo contrário: você ainda recebe 5% de tudo que contratar de fornecedor pela Komune, depois que o serviço é entregue.",
    "saidas": [
      {
        "rotulo": "Seguir",
        "destino": "prod_fechamento"
      },
      {
        "rotulo": "Como assim eu recebo?",
        "destino": "obj_pegadinha"
      }
    ],
    "nota": "Os 5% são do organizador que contratou pela plataforma, pagos depois da entrega confirmada. Não prometa prazo de repasse: isso é do financeiro."
  },
  {
    "id": "prod_fechamento",
    "tipo": "pergunta",
    "variante": "produtor",
    "texto": "Queria marcar uns 20 minutinhos pra te mostrar um evento montado por dentro e como funcionam esses 5%. Pra você fica melhor [opcao1] ou [opcao2]? Pode ser por vídeo ou eu passo aí.",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Como assim eu recebo?",
        "destino": "obj_pegadinha"
      },
      {
        "rotulo": "Manda no WhatsApp",
        "destino": "obj_whatsapp"
      },
      {
        "rotulo": "Não sou eu quem decide",
        "destino": "obj_nao_decide"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "obj_sem_interesse"
      },
      {
        "rotulo": "Não me ligue mais",
        "destino": "fim_optout"
      }
    ],
    "nota": "Sempre duas opções concretas. Toque no horário que a pessoa escolheu antes de seguir."
  },
  {
    "id": "obj_pegadinha",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Sem pegadinha, pode perguntar à vontade. Quem paga é o fornecedor, e só quando fecha pela Komune. Uma parte disso volta pra quem organizou e contratou: 5%, depois que o serviço é entregue. Te mostro na prática: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Isso é comissão por fora?",
        "destino": "obj_por_fora"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "obj_sem_interesse"
      }
    ],
    "nota": "Não diga quanto o fornecedor paga. O que se diz ao organizador é o que ele recebe."
  },
  {
    "id": "obj_por_fora",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Não, nada por fora: o repasse é feito pela própria plataforma, com comprovante, depois da entrega. Fica tudo registrado, certinho. Quer que eu te mostre como aparece?",
    "saidas": [
      {
        "rotulo": "Faz, vamos marcar",
        "destino": "prod_fechamento"
      },
      {
        "rotulo": "Vou pensar",
        "destino": "obj_vou_pensar"
      },
      {
        "rotulo": "Mesmo assim, não quero",
        "destino": "fim_sem_interesse"
      }
    ]
  },
  {
    "id": "obj_ja_tenho",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "E eles continuam sendo seus! Dá até pra trazer eles pra Komune: aí você contrata os mesmos de sempre e ainda recebe os 5%. Vale eu te mostrar como fica?",
    "saidas": [
      {
        "rotulo": "Vale, vamos marcar",
        "destino": "prod_fechamento"
      },
      {
        "rotulo": "Me procura mais pra frente",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não, valeu",
        "destino": "fim_sem_interesse"
      }
    ]
  },
  {
    "id": "obj_honorario",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Seu honorário continua o mesmo, cobrado do seu jeito. A Komune não entra no seu contrato com o cliente, não. Era isso que você queria saber?",
    "saidas": [
      {
        "rotulo": "Era isso, pode seguir",
        "destino": "prod_fechamento"
      },
      {
        "rotulo": "E eu recebo como?",
        "destino": "obj_pegadinha"
      },
      {
        "rotulo": "Mesmo assim, não",
        "destino": "fim_sem_interesse"
      }
    ]
  },
  {
    "id": "obj_mais_um_app_prod",
    "tipo": "objecao",
    "variante": "produtor",
    "texto": "Entendo. Mas não é mais um app pra alimentar: é onde para de se perder o que você já faz no WhatsApp e na planilha. E você continua fechando por fora com quem quiser. Quer ver com um evento seu?",
    "saidas": [
      {
        "rotulo": "Quero ver, vamos marcar",
        "destino": "prod_fechamento"
      },
      {
        "rotulo": "Meu jeito de hoje funciona",
        "destino": "obj_ja_tenho"
      },
      {
        "rotulo": "Mesmo assim, não quero",
        "destino": "fim_agora_nao"
      }
    ]
  },
  {
    "id": "obj_whatsapp",
    "tipo": "objecao",
    "variante": "captacao",
    "texto": "Mando, sim, agora mesmo. Só que o material sozinho não mostra a plataforma funcionando, sabe? Em 20 minutinhos numa chamada eu te mostro na prática: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Manda que eu vejo com calma",
        "destino": "fim_material"
      },
      {
        "rotulo": "Tá, e como funciona?",
        "destino": "forn_quem_somos"
      },
      {
        "rotulo": "Tá, e como funciona?",
        "destino": "prod_quem_somos"
      }
    ],
    "nota": "Se insistir, mande o resumo pelo botão do recibo e grave como material enviado."
  },
  {
    "id": "obj_sem_interesse",
    "tipo": "objecao",
    "variante": "captacao",
    "texto": "Tudo bem, sem problema nenhum. Agradeço seu tempo. Posso só te mandar um material pelo WhatsApp, pra você dar uma olhada com calma? Se um dia fizer sentido, a porta tá aberta.",
    "saidas": [
      {
        "rotulo": "Pode mandar",
        "destino": "fim_agora_nao_material"
      },
      {
        "rotulo": "Não precisa",
        "destino": "fim_sem_interesse"
      },
      {
        "rotulo": "Não me procure mais",
        "destino": "fim_optout"
      }
    ]
  },
  {
    "id": "obj_vou_pensar",
    "tipo": "objecao",
    "variante": "captacao",
    "texto": "Claro, faz sentido pensar. Só pra eu não te encher à toa: o que pesa mais pra você decidir? Me conta que eu te mostro exatamente isso na apresentação: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "É o custo",
        "destino": "obj_taxa"
      },
      {
        "rotulo": "É o custo",
        "destino": "obj_pegadinha"
      },
      {
        "rotulo": "Me liga semana que vem",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não tenho interesse",
        "destino": "obj_sem_interesse"
      }
    ],
    "nota": "Proibido \"fico no aguardo\" (R08 §2.0). Sem dia marcado, isto não é um sim: é um não devagar."
  },
  {
    "id": "obj_origem",
    "tipo": "objecao",
    "variante": "captacao",
    "texto": "Peguei o contato de vocês [origem]. A gente usa só pra convidar quem trabalha com evento aqui de Natal. Se você preferir não receber mais ligação, eu registro agora mesmo: o número vai pra uma lista de bloqueio, e é ela que impede a gente de procurar vocês de novo. Prefere que eu registre, ou posso te contar rapidinho por que liguei?",
    "saidas": [
      {
        "rotulo": "Pode contar, mas seja rápido",
        "destino": "forn_quem_somos"
      },
      {
        "rotulo": "Pode contar, mas seja rápido",
        "destino": "prod_quem_somos"
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
    "nota": "Transparência de origem é exigência do legítimo interesse (R06). Nunca diga que apaga o contato: o número vai para a suppression_list e fica lá justamente para ninguém voltar a ligar."
  },
  {
    "id": "ativ_abertura_perfil",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "[saudacao], tudo bem? Aqui é [eu], da Komune. Falo com [interlocutor]? É coisa rápida, sobre o perfil de vocês lá na Komune.",
    "saidas": [
      {
        "rotulo": "Sou eu, pode falar",
        "destino": "ativ_perfil"
      },
      {
        "rotulo": "Não é comigo",
        "destino": "pedir_decisor"
      },
      {
        "rotulo": "Não posso falar agora",
        "destino": "obj_sem_tempo"
      },
      {
        "rotulo": "Não quero mais contato",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "A etapa do funil escolheu esta abertura. É parceiro, não desconhecido: não precisa dizer de onde veio o contato."
  },
  {
    "id": "ativ_abertura_pedido",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "[saudacao], tudo bem? Aqui é [eu], da Komune. Falo com [interlocutor]? É coisa rápida, sobre o perfil de vocês lá na Komune.",
    "saidas": [
      {
        "rotulo": "Sou eu, pode falar",
        "destino": "ativ_pedido"
      },
      {
        "rotulo": "Não é comigo",
        "destino": "pedir_decisor"
      },
      {
        "rotulo": "Não posso falar agora",
        "destino": "obj_sem_tempo"
      },
      {
        "rotulo": "Não quero mais contato",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "A etapa do funil escolheu esta abertura. É parceiro, não desconhecido: não precisa dizer de onde veio o contato."
  },
  {
    "id": "ativ_abertura_respondido",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "[saudacao], tudo bem? Aqui é [eu], da Komune. Falo com [interlocutor]? É coisa rápida, sobre o perfil de vocês lá na Komune.",
    "saidas": [
      {
        "rotulo": "Sou eu, pode falar",
        "destino": "ativ_respondido"
      },
      {
        "rotulo": "Não é comigo",
        "destino": "pedir_decisor"
      },
      {
        "rotulo": "Não posso falar agora",
        "destino": "obj_sem_tempo"
      },
      {
        "rotulo": "Não quero mais contato",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "A etapa do funil escolheu esta abertura. É parceiro, não desconhecido: não precisa dizer de onde veio o contato."
  },
  {
    "id": "ativ_abertura_reativar",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "[saudacao], tudo bem? Aqui é [eu], da Komune. Falo com [interlocutor]? É coisa rápida, sobre o perfil de vocês lá na Komune.",
    "saidas": [
      {
        "rotulo": "Sou eu, pode falar",
        "destino": "ativ_reativar"
      },
      {
        "rotulo": "Não é comigo",
        "destino": "pedir_decisor"
      },
      {
        "rotulo": "Não posso falar agora",
        "destino": "obj_sem_tempo"
      },
      {
        "rotulo": "Não quero mais contato",
        "destino": "fim_optout"
      },
      {
        "rotulo": "Desligou no meio",
        "destino": "fim_desligou"
      }
    ],
    "nota": "A etapa do funil escolheu esta abertura. É parceiro, não desconhecido: não precisa dizer de onde veio o contato."
  },
  {
    "id": "ativ_retoma",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "É coisa rápida, sobre o perfil de vocês lá na Komune. Pode falar agora?",
    "saidas": [
      {
        "rotulo": "Pode falar: completar o perfil",
        "destino": "ativ_perfil"
      },
      {
        "rotulo": "Pode falar: pedido esperando",
        "destino": "ativ_pedido"
      },
      {
        "rotulo": "Pode falar: pedido já respondido",
        "destino": "ativ_respondido"
      },
      {
        "rotulo": "Pode falar: faz tempo sem movimento",
        "destino": "ativ_reativar"
      },
      {
        "rotulo": "Agora não dá",
        "destino": "combinar_retorno"
      }
    ],
    "nota": "Quem atendeu passou a ligação para outra pessoa: toque no motivo que está na etapa do negócio, no topo da tela."
  },
  {
    "id": "ativ_perfil",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Que bom ter [empresa] com a gente! Liguei porque perfil com fotos dos trabalhos, preços e a conta de recebimento pronta é o que faz o cliente pedir orçamento. Já deu pra colocar tudo isso aí?",
    "saidas": [
      {
        "rotulo": "Falta coisa",
        "destino": "ativ_sessao"
      },
      {
        "rotulo": "Travei numa parte",
        "destino": "ativ_sessao"
      },
      {
        "rotulo": "Já está tudo",
        "destino": "fim_perfil_pronto"
      }
    ]
  },
  {
    "id": "ativ_sessao",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Isso a gente resolve rapidinho. Que tal terminar junto, uns 15 minutos por vídeo? Fica melhor [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Faço sozinho, valeu",
        "destino": "fim_resolvido"
      },
      {
        "rotulo": "Me liga depois",
        "destino": "combinar_retorno"
      }
    ]
  },
  {
    "id": "fim_perfil_pronto",
    "tipo": "fim",
    "variante": "ativacao",
    "texto": "Perfeito! Então é só ficar de olho: quando chegar pedido, ele aparece no painel de vocês na Komune. Qualquer dúvida, me chama no WhatsApp, tá?",
    "saidas": [],
    "desfecho": "lig_interessado",
    "nota": "Resolvido na ligação. Nenhuma promessa de que vai chegar pedido."
  },
  {
    "id": "ativ_pedido",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Liguei porque chegou um pedido de orçamento pra vocês pela Komune, e ele ainda tá esperando resposta. Pedido parado esfria rápido, né? Consegue responder hoje? Se ficou alguma dúvida de como fazer, te mostro agora.",
    "saidas": [
      {
        "rotulo": "Respondo hoje",
        "destino": "fim_resposta_combinada"
      },
      {
        "rotulo": "Tive dúvida de como responder",
        "destino": "ativ_duvida"
      },
      {
        "rotulo": "Não vou atender esse pedido",
        "destino": "ativ_motivo_pedido"
      }
    ]
  },
  {
    "id": "ativ_respondido",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Vi que vocês já responderam o pedido, que ótimo! E aí, o cliente deu retorno? Se precisar de uma força pra fechar, tô aqui.",
    "saidas": [
      {
        "rotulo": "Fechou!",
        "destino": "fim_fechou"
      },
      {
        "rotulo": "Ainda esperando o cliente",
        "destino": "fim_resposta_combinada"
      },
      {
        "rotulo": "Preciso de ajuda pra fechar",
        "destino": "ativ_duvida"
      },
      {
        "rotulo": "Não fechou",
        "destino": "ativ_motivo_pedido"
      }
    ]
  },
  {
    "id": "ativ_duvida",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Te mostro agora mesmo, em uns 10 minutinhos, ou a gente marca: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Mostrei agora, resolvido",
        "destino": "fim_resolvido"
      },
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      }
    ]
  },
  {
    "id": "ativ_motivo_pedido",
    "tipo": "captura",
    "variante": "ativacao",
    "texto": "Entendi. Posso perguntar o motivo? Ajuda muito a gente a melhorar.",
    "saidas": [
      {
        "rotulo": "Preço",
        "destino": "fim_resolvido",
        "valor": "preço"
      },
      {
        "rotulo": "Data ocupada",
        "destino": "fim_resolvido",
        "valor": "data ocupada"
      },
      {
        "rotulo": "Não é o tipo de evento",
        "destino": "fim_resolvido",
        "valor": "tipo de evento"
      },
      {
        "rotulo": "Outro, já anotei",
        "destino": "fim_resolvido"
      }
    ],
    "campo": "motivo_do_pedido"
  },
  {
    "id": "fim_resposta_combinada",
    "tipo": "fim",
    "variante": "ativacao",
    "texto": "Ótimo! Quanto antes responder, melhor, que pedido parado esfria. Depois te procuro pra saber como foi. Agradeço seu tempo, [nome]!",
    "saidas": [],
    "desfecho": "lig_interessado"
  },
  {
    "id": "fim_fechou",
    "tipo": "fim",
    "variante": "ativacao",
    "texto": "Que notícia boa! Parabéns pela contratação. Qualquer coisa na entrega, é só me chamar no WhatsApp. Agradeço seu tempo, [nome]!",
    "saidas": [],
    "desfecho": "lig_interessado",
    "nota": "Depois de gravar, mova o negócio para 1ª contratação."
  },
  {
    "id": "ativ_reativar",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Faz um tempinho que não vejo movimento no perfil de [empresa] na Komune, e queria entender: aconteceu alguma coisa? Tem algo que a gente possa melhorar pra vocês?",
    "saidas": [
      {
        "rotulo": "Ficou difícil usar",
        "destino": "ativ_travou"
      },
      {
        "rotulo": "Não chegou pedido",
        "destino": "ativ_revisar"
      },
      {
        "rotulo": "Tô sem tempo agora",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Não quero mais usar",
        "destino": "ativ_motivo_saida"
      }
    ],
    "nota": "Só oferece ajuda. Nenhuma fala promete que vai chegar pedido ou que o perfil vai aparecer mais."
  },
  {
    "id": "ativ_travou",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Me conta onde travou. Se quiser, eu reviso o perfil junto com você em 15 minutos: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Agora não",
        "destino": "fim_agora_nao"
      }
    ]
  },
  {
    "id": "ativ_revisar",
    "tipo": "pergunta",
    "variante": "ativacao",
    "texto": "Entendi. Que tal a gente revisar o perfil junto e ver o que tá faltando? [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Agora não",
        "destino": "fim_agora_nao"
      }
    ]
  },
  {
    "id": "ativ_motivo_saida",
    "tipo": "captura",
    "variante": "ativacao",
    "texto": "Tudo bem, agradeço por ter testado. Posso só saber o motivo? É pra gente melhorar.",
    "saidas": [
      {
        "rotulo": "Não chegou pedido",
        "destino": "fim_sem_interesse",
        "valor": "não chegou pedido"
      },
      {
        "rotulo": "Difícil de usar",
        "destino": "fim_sem_interesse",
        "valor": "difícil de usar"
      },
      {
        "rotulo": "O custo",
        "destino": "fim_sem_interesse",
        "valor": "custo"
      },
      {
        "rotulo": "Outro, já anotei",
        "destino": "fim_sem_interesse"
      },
      {
        "rotulo": "Não quero mais contato",
        "destino": "fim_optout"
      }
    ],
    "campo": "motivo_da_saida",
    "nota": "Grava como perdido, com o motivo. Só vira não contatar se a pessoa pedir para não ser mais procurada."
  },
  {
    "id": "fim_resolvido",
    "tipo": "fim",
    "variante": "ativacao",
    "texto": "Combinado! Qualquer dúvida no caminho, me chama no WhatsApp. Agradeço seu tempo, [nome]!",
    "saidas": [],
    "desfecho": "lig_interessado"
  },
  {
    "id": "ativ_obj_whatsapp",
    "tipo": "objecao",
    "variante": "ativacao",
    "texto": "Mando, sim, com o passo a passo. E se travar em alguma parte, a gente resolve junto em 15 minutinhos: [opcao1] ou [opcao2]?",
    "saidas": [
      {
        "rotulo": "Escolheu um dos dois horários",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Quer outro dia",
        "destino": "agendar_outro_dia"
      },
      {
        "rotulo": "Só manda, eu faço",
        "destino": "fim_resolvido"
      }
    ]
  },
  {
    "id": "pedir_decisor",
    "tipo": "pergunta",
    "variante": "ambas",
    "texto": "Ah, sem problema! Quem cuida das parcerias aí em [empresa]? Consigo falar com essa pessoa agora?",
    "saidas": [
      {
        "rotulo": "Vou te passar agora",
        "destino": "permissao"
      },
      {
        "rotulo": "Vou te passar agora",
        "destino": "ativ_retoma"
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
    "nota": "Nunca \"com ele\" nem \"o nome dele\": quem decide pode ser qualquer pessoa."
  },
  {
    "id": "obj_nao_decide",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Entendi! E quem seria a melhor pessoa pra conversar sobre isso? Consegue me passar o contato, ou o melhor horário pra eu encontrar essa pessoa aí?",
    "saidas": [
      {
        "rotulo": "Passou o nome e o horário",
        "destino": "anotar_decisor"
      },
      {
        "rotulo": "Vai passar a ligação agora",
        "destino": "permissao"
      },
      {
        "rotulo": "Vai passar a ligação agora",
        "destino": "ativ_retoma"
      },
      {
        "rotulo": "Só por e-mail",
        "destino": "anotar_email"
      },
      {
        "rotulo": "Não passa o contato",
        "destino": "fim_agora_nao"
      }
    ]
  },
  {
    "id": "anotar_decisor",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Tudo bem. Qual o nome de quem decide, e qual o melhor horário pra eu ligar?",
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
    "campo": "decisor",
    "nota": "Grava como retorno agendado, com o nome e o horário do decisor na nota."
  },
  {
    "id": "anotar_email",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Pode ser por e-mail, claro. Qual é o endereço certinho? Eu mando assim que a gente desligar, com o meu nome e o site da Komune.",
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
    "campo": "email_do_decisor"
  },
  {
    "id": "combinar_retorno",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Sem problema, a gente fala outra hora. Qual o melhor dia e horário pra eu te ligar? Já deixo anotado aqui, e te ligo sem falta.",
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
        "rotulo": "Manda no WhatsApp que eu vejo",
        "destino": "ativ_obj_whatsapp"
      },
      {
        "rotulo": "Melhor não me ligar mais",
        "destino": "fim_optout"
      }
    ],
    "campo": "retorno_combinado",
    "nota": "Sem data combinada, a frase fica \"te ligo sem falta\" — por isso nenhuma preposição antes de dia e hora."
  },
  {
    "id": "agendar_outro_dia",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Claro! Qual dia e horário ficam bons pra você?",
    "saidas": [
      {
        "rotulo": "Marcado",
        "destino": "confirmar_whatsapp"
      },
      {
        "rotulo": "Prefere que eu ligue depois",
        "destino": "combinar_retorno"
      },
      {
        "rotulo": "Pensando melhor, não quero",
        "destino": "fim_sem_interesse"
      }
    ],
    "campo": "reuniao_combinada",
    "nota": "Anote o combinado. O dia, a hora e o formato você confirma na folha, ao gravar Reunião marcada."
  },
  {
    "id": "confirmar_whatsapp",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Fechado! Te mando a confirmação no WhatsApp. É nesse número mesmo?",
    "saidas": [
      {
        "rotulo": "É esse",
        "destino": "fim_reuniao",
        "valor": "mesmo número da ligação"
      },
      {
        "rotulo": "É outro, anota aí",
        "destino": "fim_reuniao"
      },
      {
        "rotulo": "Não uso WhatsApp",
        "destino": "confirmar_por_email"
      }
    ],
    "campo": "whatsapp_de_trabalho"
  },
  {
    "id": "confirmar_por_email",
    "tipo": "captura",
    "variante": "ambas",
    "texto": "Então mando por e-mail. Qual o endereço certinho? Te mando a confirmação ainda hoje, com dia, horário e como vai ser.",
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
    "campo": "email_de_confirmacao"
  },
  {
    "id": "obj_sem_tempo",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Poxa, liguei em hora ruim, né? É menos de um minuto: eu te digo do que se trata e, se não servir, você me fala pra parar. Pode ser?",
    "saidas": [
      {
        "rotulo": "Pode, fala rápido",
        "destino": "forn_quem_somos"
      },
      {
        "rotulo": "Pode, fala rápido",
        "destino": "prod_quem_somos"
      },
      {
        "rotulo": "Pode, fala rápido",
        "destino": "ativ_retoma"
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
    "id": "obj_golpe",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Faz muito bem em perguntar, viu? Meu nome é [eu], sou da Komune, aqui de Natal. O site é komune.app.br, e no Instagram é arroba komune ponto natal. Pode conferir agora, que eu espero. E um detalhe: eu não peço CPF nem dado bancário por telefone. Posso seguir?",
    "saidas": [
      {
        "rotulo": "Agora entendi, pode falar",
        "destino": "forn_quem_somos"
      },
      {
        "rotulo": "Agora entendi, pode falar",
        "destino": "prod_quem_somos"
      },
      {
        "rotulo": "Agora entendi, pode falar",
        "destino": "ativ_retoma"
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
    "nota": "A prova é verificável na hora: nome de quem liga, komune.app.br e @komune.natal. Se insistir, pare de vender."
  },
  {
    "id": "obj_hostil",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Você tem razão, e me desculpa pelo incômodo. Vou parar agora e registrar isso, pra ninguém te procurar de novo. Prefere que eu tire o contato de vocês de vez, ou só não ligue por um tempo?",
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
    "nota": "Prioridade absoluta (R08 §1, intenção 14): desculpa, para a cadência, e só. Não retome o pitch."
  },
  {
    "id": "obj_financeiro",
    "tipo": "objecao",
    "variante": "ambas",
    "texto": "Essa eu prefiro não responder de cabeça, pra não te passar nada errado. Prazo de repasse, cancelamento, nota fiscal e exigência de CNPJ eu confirmo com o financeiro e te mando por escrito ainda hoje. Pode ser nesse mesmo número?",
    "saidas": [
      {
        "rotulo": "Pode, manda por escrito",
        "destino": "fim_material"
      },
      {
        "rotulo": "Pode, manda por escrito",
        "destino": "fim_resolvido"
      },
      {
        "rotulo": "Tá, pode continuar",
        "destino": "forn_valor"
      },
      {
        "rotulo": "Tá, pode continuar",
        "destino": "prod_valor"
      },
      {
        "rotulo": "Tá, pode continuar",
        "destino": "ativ_retoma"
      },
      {
        "rotulo": "Sem isso eu não sigo",
        "destino": "fim_agora_nao"
      }
    ],
    "nota": "Dúvida financeira sem resposta na FAQ: \"vou confirmar com o financeiro\" (CLAUDE.md)."
  },
  {
    "id": "fim_reuniao",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Fechado, então nos falamos [dia] [hora]! Te mando a confirmação agora no WhatsApp. Agradeço seu tempo, [nome]!",
    "saidas": [],
    "desfecho": "lig_reuniao_marcada",
    "nota": "Depois de gravar, o recibo traz o botão da confirmação no WhatsApp, já preenchido."
  },
  {
    "id": "fim_material",
    "tipo": "fim",
    "variante": "captacao",
    "texto": "Mando agora mesmo. Dá uma olhada com calma, e qualquer coisa me chama por lá. Agradeço seu tempo, [nome]!",
    "saidas": [],
    "desfecho": "lig_interessado",
    "nota": "Material enviado. Mande o resumo pelo botão do recibo, e o retorno fica agendado."
  },
  {
    "id": "fim_agora_nao_material",
    "tipo": "fim",
    "variante": "captacao",
    "texto": "Mando agora. Agradeço seu tempo, e se um dia fizer sentido, a porta tá aberta!",
    "saidas": [],
    "desfecho": "lig_agora_nao",
    "nota": "Sem interesse agora, com material enviado: vai para nutrição. Mande o resumo pelo botão do recibo."
  },
  {
    "id": "fim_retorna",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Então te ligo [dia] [hora]. Já anotei aqui, e não te procuro antes disso. Valeu pelo tempo!",
    "saidas": [],
    "desfecho": "lig_atendeu_retorna",
    "nota": "Retorno agendado ou decisor mapeado. Com data na mão."
  },
  {
    "id": "fim_agora_nao",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Tranquilo, não vou insistir. Guardo o contato e só volto a falar se tiver alguma novidade que valha a pena. Valeu pelo tempo!",
    "saidas": [],
    "desfecho": "lig_agora_nao",
    "nota": "\"Agora não\" volta em 30 dias, em nutrição."
  },
  {
    "id": "fim_sem_interesse",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Entendi, sem problema. Não vou insistir. Se um dia mudar de ideia, a porta tá aberta. Valeu pelo tempo, e bom trabalho aí!",
    "saidas": [],
    "desfecho": "lig_sem_interesse",
    "nota": "Perdido, com 90 dias de espera: por isso o nó não promete \"nunca mais te ligo\". Quem pedir para não ser procurado vai para o opt-out."
  },
  {
    "id": "fim_optout",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Pode deixar: já registro aqui, e ninguém da Komune vai te ligar nem escrever de novo. Desculpa o incômodo!",
    "saidas": [],
    "desfecho": "lig_sem_interesse",
    "nota": "Opt-out imediato (RF-CON-18). ANTES de tabular, marque a supressão: sem ela o desfecho sozinho é Perdido com 90 dias de espera, e a promessa desta frase vira mentira."
  },
  {
    "id": "fim_nao_e_evento",
    "tipo": "fim",
    "variante": "captacao",
    "texto": "Ah, então a minha lista errou: trouxe vocês como quem trabalha com evento. Já corrijo aqui. Desculpa o incômodo, e valeu pelo tempo!",
    "saidas": [],
    "desfecho": "lig_sem_interesse",
    "nota": "O número está certo, a categoria da coleta é que estava errada. Tire a organização da base de evento antes de fechar."
  },
  {
    "id": "fim_engano",
    "tipo": "fim",
    "variante": "captacao",
    "texto": "Ah, desculpa, foi engano meu. Não incomodo mais. [saudacao]!",
    "saidas": [],
    "resultadoTecnico": "numero_invalido",
    "nota": "Atendeu, mas não houve conversa comercial: fecha pelo eixo técnico."
  },
  {
    "id": "fim_desligou",
    "tipo": "fim",
    "variante": "ambas",
    "texto": "Caiu, ou desligaram no meio — não tem de quem se despedir. Fecha por aqui: o retorno fica marcado, e o caminho da conversa fica gravado.",
    "saidas": [],
    "resultadoTecnico": "queda_de_linha",
    "nota": "Fecha pelo eixo TÉCNICO: ninguém recusou nada, a linha caiu."
  }
]$roteiro$::jsonb, true)
on conflict (slug, versao) do update
  set nome = excluded.nome, arvore = excluded.arvore, is_published = true;
