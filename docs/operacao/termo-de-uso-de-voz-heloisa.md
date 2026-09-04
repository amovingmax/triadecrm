# Autorização de uso de voz — Heloísa (áudios do WhatsApp da Komune)

> ## ⚠️ LEIA ANTES: isto é um RASCUNHO
>
> **Este documento é uma minuta de trabalho, escrita para o Dennis revisar. Não é parecer jurídico e não substitui advogado.**
>
> O anexo em que ele se baseia diz de si mesmo: "não é parecer jurídico; os pontos marcados com **[validar com advogado]** devem ser confirmados antes do lançamento" [R06, cabeçalho]. Continuam precisando de advogado, entre outros: a classificação da gravação de voz como dado biométrico sensível e a forma do consentimento [R06 seção 5.1 e seção E, item 2]; a fragilidade do consentimento de empregado pelo desequilíbrio de poder na relação de trabalho [R06 seção 5.1]; e o enquadramento do uso de IA/voz como "tecnologia inovadora" na Resolução CD/ANPD 2/2022 [R06 seção 1, "Pequeno porte", e seção E, item 4].
>
> Enquanto este termo não estiver assinado, **não se grava nada**: a biblioteca de áudios só pode ser gravada depois de assinado o termo de licença de uso de voz [PRD RF-CON-29; R06 Apêndice B.4, item IA-01].

---

## 1. Quem assina

**KOMUNE LTDA**, CNPJ **[⚠️ confirmar — Dennis]**, endereço **[⚠️ confirmar — Dennis]**, aqui chamada **Komune**, e **Heloísa [nome completo, ⚠️ confirmar — Dennis]**, aqui chamada **Heloísa**.

**[⚠️ Precisa de confirmação humana — Dennis, com o advogado]** Qual é o instrumento correto: aditivo ao contrato de trabalho da Heloísa ou termo autônomo? O anexo recomenda "termo aditivo ao contrato, específico" [R06 seção 5.1], mas o vínculo dela (CLT, PJ, outro) não consta em nenhum anexo.

## 2. O que a Heloísa está autorizando

Que a Komune use **a voz dela, gravada por ela mesma**, em mensagens de áudio enviadas pelo WhatsApp da empresa.

São duas modalidades, e só estas duas:

1. **Biblioteca de clipes pré-gravados** — de 25 a 40 áudios curtos (20 a 30 segundos, nunca mais de 40), gravados por ela em ambiente silencioso, organizados por segmento, etapa e intenção (apresentação, taxa de 8%, sem mensalidade, pedido de autorização do pré-cadastro, convite de reunião, confirmação, lembrete, cobrança de cadastro, objeções, despedida), com metadados e regra de não repetição [PRD RF-CON-29; R04 seção 6, item 2].
2. **Áudios gravados ao vivo por ela**, pelo próprio celular, no meio da conversa [R04 seção 6, item 1; PRD RF-CON-30].

**Não está autorizado** nada de voz clonada, sintética ou gerada por IA. A decisão fechada do projeto é usar só áudio real (ADR-09) [R06 seção 0, item 11; PRD RF-CON-26: "todo áudio enviado é de voz humana real (gravado pela Heloísa; o robô apenas o escolhe na biblioteca)"]. Se um dia isso mudar, é preciso um adendo separado — ver a seção 9 deste rascunho.

## 3. Para que serve (finalidade)

Só para **prospecção comercial e atendimento da Komune por WhatsApp**: convidar fornecedores, produtores e cerimonialistas para a plataforma, explicar como funciona, marcar reunião e acompanhar o cadastro [R06 Apêndice C.8].

O anexo também lista "materiais internos" entre as finalidades possíveis [R06 Apêndice C.8]. **[⚠️ Precisa de confirmação humana — Dennis]**: manter ou tirar? Se manter, definir o que conta como material interno (treinamento da equipe? demonstração para investidor?).

**Fica vedado** usar esses áudios em outros produtos, repassar a terceiros, ou usar em conteúdo que não corresponda a falas aprovadas por ela [R06 Apêndice C.8]. Qualquer uso fora disso exige novo aceite dela [R06 seção 5.1].

## 4. Limites de uso que a Komune se compromete a respeitar

- Nunca áudio no primeiro contato, e nunca sem a pessoa ter respondido antes [R06 Apêndice B.2, item WA-13; PRD RF-CON-30].
- Todo áudio vai acompanhado de um resumo em texto [R06 seção 3, e Apêndice B.2, item WA-13].
- Um áudio por conversa, no máximo dois na jornada; nunca dois áudios seguidos; nunca o mesmo áudio repetido para o mesmo contato [PRD RF-CON-30 e RF-CON-24].
- A Heloísa tem o direito de **ouvir e aprovar** a biblioteca inteira antes de ela entrar no ar [R06 Apêndice C.8].
- O robô nunca diz "acabei de gravar esse áudio" e nunca afirma ser humano se perguntado [R04 seção 6, "Consentimento e ética"; PRD RF-CON-26].
- Cada mensagem de voz fica registrada com a origem do áudio (`audio_source`: ao vivo ou biblioteca) [R04 seção 6; PRD RF-CON-31].

## 5. Onde os áudios ficam guardados

Em **bucket privado `audios`** no Supabase, em arquivo ogg/opus, com acesso só por URL assinada de curta duração [R05, DDL da tabela `audio_assets`, e R05 seção de stack: "Storage (buckets privados, URLs assinadas)"]. Os discos são cifrados em repouso e o projeto fica na região de São Paulo [R05, tabela de segurança; PRD seção 10.1 — "dados em região São Paulo"].

Os áudios que já foram **enviados** ficam também no histórico das conversas de WhatsApp, que é apagado 12 meses depois da última mensagem [R06 Apêndice D, linha "Conversas de WhatsApp (prospecção)"].

## 6. Por quanto tempo vale

Enquanto durar o vínculo da Heloísa com a Komune, **mais 30 dias** para uso de áudios já gravados [R06 Apêndice C.8; R06 Apêndice D, linha "Áudios reais da funcionária"].

## 7. Se a Heloísa sair da empresa

O número de WhatsApp e a conta são da empresa; o nome de exibição passa a outra pessoa e **os áudios com a voz dela deixam de ser enviados em até 30 dias** [PRD RF-CON-01; R06 seção 5.1: "uso cessa em até 30 dias; áudios já enviados não precisam ser apagados, mas não se geram novos"].

Os áudios já enviados permanecem no histórico das conversas até a regra de retenção de conversas (12 meses) [R06 Apêndice D].

**[⚠️ Precisa de confirmação humana — Dennis, com Matheus]** Os arquivos-mestre da biblioteca no bucket são **apagados** ou apenas **desativados** ao fim dos 30 dias? O anexo só manda "parar uso" e não decide isso [R06 Apêndice D, linha "Áudios reais da funcionária"].

## 8. Revogar: a qualquer momento, e sem retaliação

A Heloísa pode revogar esta autorização **quando quiser, por escrito, sem precisar justificar e sem sofrer nenhuma retaliação** [R06 seção 5.1 e Apêndice C.8].

Na prática, o que acontece quando ela revoga:

- A Komune **para de enviar** áudios com a voz dela. O efeito é para a frente (prospectivo): vale para os envios seguintes, não desfaz os anteriores [R06 Apêndice C.8].
- Os áudios **já enviados** continuam no histórico das conversas de quem os recebeu, até a regra dos 12 meses [R06 seção 5.1 e Apêndice D]. Não há como recolher mensagem já entregue.
- A Komune volta a operar só com texto até gravar uma nova biblioteca com outra pessoa.
- Vale o mesmo prazo de encerramento de uso: até 30 dias [R06 Apêndice D].

## 9. Contrapartida

**[⚠️ Precisa de confirmação humana — Rafael decide, Dennis formaliza]** O anexo exige que o termo diga uma das duas coisas: **valor mensal** pago pela cessão de uso, **ou registro expresso de que o uso é gratuito** [R06 seção 5.1 e Apêndice C.8]. Nenhum anexo traz o valor nem a decisão. Esta minuta não inventa: o campo fica em branco de propósito.

## 10. Dúvidas e exercício de direitos

Encarregado(a) de dados da Komune: **[⚠️ confirmar — Rafael decide entre Dennis e Luiz]**, e-mail `privacidade@komune.app` [R06 seção 6 e Apêndice C.5; PRD seção 13, item 5 — a decisão ainda está aberta; o PRD já registra Dennis como `encarregado LGPD` na tabela de papéis].

## 11. Assinaturas

Natal/RN, ____ de __________ de ______.

Heloísa: ______________________  ·  Komune (representante legal): ______________________

**[⚠️ Precisa de confirmação humana — Dennis, com o advogado]** Forma de assinatura (eletrônica com carimbo de tempo? duas testemunhas?), foro e lei aplicável não constam de nenhum anexo.

---

## O que muda se um dia usarmos voz clonada

Só para o Dennis ver o tamanho da diferença. Hoje a voz clonada está fora do MVP e aparece no PRD como opção de v2, "opcional" [PRD RF-CON-31].

| | Áudio real (o que estamos fazendo) | Voz clonada / sintética |
|---|---|---|
| Tipo de autorização | Consentimento simples + licença de uso [R06 seção 0, item 11] | **Consentimento específico e destacado**, em adendo separado, porque o modelo derivado da voz pode ser tratado como dado biométrico sensível (LGPD art. 11, I) — **[validar com advogado]** [R06 seção 5.1 e Apêndice C.8] |
| Aviso ao fornecedor | Nada a declarar [R06 seção 5.1, "Regra recomendada", item 3] | Obrigatório dizer no texto: "áudio gerado por IA com a voz da Heloísa, autorizado por ela" [R06 seção 5.1 e Apêndice C.7] |
| Guarda | Bucket privado no Supabase [R05] | Modelo de voz **em cofre, com acesso nomeado**, nunca em provedor sem contrato [R06 seção 5.1 e Apêndice B.4, item IA-03] |
| Saída da funcionária | Para de usar em 30 dias [R06 Apêndice D] | **Job automático** que desativa o TTS na saída, e **destruição imediata** do modelo na revogação ou no desligamento — sem os 30 dias [R06 Apêndice B.4 item IA-03 e Apêndice D, linha "Modelo de voz sintética"] |
| Fornecedor externo | Nenhum | DPA com o provedor de TTS, sem retenção para treinamento, transferência internacional por cláusulas-padrão (Res. ANPD 19/2024) [R06 seção 5.2]. A ElevenLabs ainda exige uma **declaração de consentimento gravada** pela dona da voz [R04 seção 6] |
| Aprovação dela | Ouvir e aprovar a biblioteca [R06 Apêndice C.8] | Ouvir e aprovar a biblioteca **e o script do TTS** [R06 Apêndice C.8] |
| Risco novo | — | Deepfake se o modelo vazar [R06 seção 5.1]; risco R8 do mapa de riscos, com dono Rafael/Dennis [R06 Apêndice A] |
| Enquadramento na ANPD | — | Pode ser lido como "tecnologia inovadora" e comprometer a condição de pequeno porte (dispensas da Res. 2/2022) — **[validar com advogado]** [R06 seção 1] |
| Custo | R$ 0 — "biblioteca pré-gravada custa R$ 0" [R04 seção 6] | ≈ US$ 30–32/mês (≈ R$ 170) para 300 áudios de 30 s na ElevenLabs Creator [R04 seção 6] |

Resumindo: o áudio real resolve, segundo o anexo, "90% do objetivo ('quebrar a barreira de tecnologia') com risco mínimo — são a voz dela de fato" [R06 seção 5.1]. A voz clonada acrescenta um consentimento de dado sensível, um dever de transparência, um cofre, um contrato com fornecedor externo, um job de destruição e ≈ R$ 170/mês. É por isso que a decisão atual é a mais barata — em dinheiro e em risco.

---

*Rascunho gerado a partir de docs/anexos/R06-lgpd-compliance.md (seções 0, 1, 5.1, 5.2, 6, Apêndices A, B.4, C.7, C.8, D e E), docs/anexos/R04-whatsapp-automacao.md (seção 6), docs/anexos/R05-arquitetura-tecnica.md (DDL e segurança) e do PRD (RF-CON-01, RF-CON-24, RF-CON-26, RF-CON-29, RF-CON-30, RF-CON-31, seções 10.1, 11.2 e 13). No calendário do PRD, o envio deste modelo pelo Dennis está no Dia 0 [PRD seção 11.2].*
