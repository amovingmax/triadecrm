# O app na App Store (distribuição não listada)

**Decisão do usuário (11/11/2026):** o app do iPhone sai na App Store como **app não listado**. Ele não aparece na busca nem nas categorias, e só instala quem tem o link direto, que a gestão manda para a equipe. O que deixa o app privado é o login: só entra o e-mail liberado em `allowed_users`.

Por que não os outros caminhos:
- **TestFlight**: cada build vence em 90 dias. O grupo interno exige que cada pessoa seja usuária da conta App Store Connect da KOMUNE (a mesma da Komune, do Aurora Lab e do Viva Positivo). Ele continua servindo para testar versões antes da loja.
- **Apple Business Manager**: exige D-U-N-S e aparelhos gerenciados pela empresa. A equipe usa o próprio iPhone.

## O cadastro

| | |
|---|---|
| App | **Tríade CRM**, Apple ID `6831297069`, SKU `triade-ios`, `app.triade.ios` |
| Conta | Apple da KOMUNE, equipe `8GF4F9C98L` |
| Primeira versão | **1.0.0** (`VERSAO_DA_CASCA` em `apps/app/src/ambiente.ts`). A Apple recusa o pedido de não listado de app que pareça beta, e a 0.2.0 era a do TestFlight. |
| Idioma | Português (Brasil) |
| Categorias | Negócios; secundária Produtividade |
| Preço | Grátis, com o Brasil de território-base |
| Disponível em | **Só no Brasil**, sem entrar sozinho em países novos. Fora da UE, a loja não pede o cadastro de comerciante (DSA); fora da China, não pede licença ICP. |
| Liberação | **Manual.** Um app aprovado só vai ao ar quando alguém clica, então não há risco de ele sair listado antes da Apple aprovar o pedido de não listado. |
| Suporte | `https://imova-crm.vercel.app/aplicativo` |
| Privacidade | `https://imova-crm.vercel.app/aplicativo/privacidade` |

**Os links estão no domínio da Imova** porque o site dela é publicado da `main`, e a KOMUNE está parada de propósito numa versão de 06/11 (o banco dela tem migrações pendentes que eram só da Imova). As duas páginas abrem nas duas empresas (`ehRotaPublica`). Quando a KOMUNE for publicada da `main`, dá para trocar os links para `triade-crm-tawny.vercel.app`.

As páginas falam de quem **usa** o app (a equipe): dados da conta Google, o registro de atividades (12 meses), o endereço de avisos, as permissões (avisos, microfone, câmera e fotos, sem localização) e os serviços. Os dados dos clientes seguem a política de cada empresa, linkada na página. Mudou o que o app coleta, muda a política (`APLICATIVO.versaoDaPolitica`, em `apps/web/src/lib/aplicativo.ts`) e as respostas de "Privacidade do app" (abaixo).

### Preenchido pela API (11/11/2026)

Com a chave da App Store Connect API em `~/.komune-secrets/` (a do `apps/app/eas.json`), em rascunho:
- nome, subtítulo ("Atendimento e vendas da equipe"), descrição, palavras-chave, texto promocional, links de suporte e de privacidade;
- categorias, copyright ("2026 KOMUNE LTDA"), "não usa conteúdo de terceiros";
- classificação etária: tudo "Nenhum" ou "Não", menos **mensagens e chat: sim** (a equipe conversa com os clientes pelo WhatsApp);
- preço, disponibilidade, versão 1.0.0 com liberação manual;
- notas para o revisor, em inglês, com "conta de demonstração exigida".

As notas dizem:
- que o app é para distribuição não listada;
- o que ele é e que não há cadastro aberto;
- como entrar (empresa KOMUNE, "Entrar com Google", a conta de demonstração);
- a exceção da regra 4.8 (app de empresa, com conta criada pela empresa);
- os recursos nativos (contra a regra 4.2, "site empacotado");
- o nome das telas;
- o pedido para não mandar mensagem, aprovar lead nem ligar: a conta é da KOMUNE em produção, com contatos reais.

## O que só dá para fazer no painel

A App Store Connect API não tem o questionário de privacidade, e a conta do revisor e o envio dependem do usuário.

1. **A conta do revisor** (decisão de 11/11/2026: na KOMUNE em produção, papel SDR).
   - Criar um Gmail só para isso, com senha forte, um e-mail de recuperação e **sem** verificação em duas etapas. A Apple entra de outro país, e o Google pode pedir "confirme que é você".
   - No Tríade da KOMUNE: Administração → Pessoas → liberar o e-mail como SDR, com a nota "Revisor da Apple".
   - Entrar uma vez com ela (app do TestFlight ou navegador), para o perfil nascer e conferir que entra.
   - Na versão 1.0.0, em "Informações para revisão do app": usuário e senha, e o contato (nome, telefone, e-mail).
   - Acrescentar ao fim das notas: `If Google asks to confirm the recovery e-mail, use: <e-mail de recuperação>`.
   - Depois da aprovação, a conta pode ser desligada; para cada versão nova, ela precisa voltar a entrar.
2. **Privacidade do app** → "Sim, coletamos dados". Para cada tipo: usado em "Funcionalidade do app", **vinculado** à identidade, **sem** rastreamento.
   - Informações de contato: nome, endereço de e-mail.
   - Conteúdo do usuário: e-mails ou mensagens de texto, fotos ou vídeos, dados de áudio, outro conteúdo do usuário (documentos).
   - Identificadores: ID do usuário.
   - Dados de uso: interação com o produto (o registro do que cada pessoa fez, que a gestão vê nos relatórios).
   - Não coletamos: localização, contatos do aparelho, histórico de navegação, diagnósticos, dados financeiros ou de saúde.
3. **Capturas de tela** de iPhone 6,9" (1320 × 2868), com dados fictícios.
4. **A build** 1.0.0 escolhida na versão.
5. **Enviar para revisão.**
6. **O pedido de não listado**, logo depois do envio: <https://developer.apple.com/contact/request/unlisted-app/>, com o login da conta Apple. Respostas sugeridas, em inglês:
   - App: Tríade CRM · Apple ID 6831297069 · `app.triade.ios`.
   - Audience: *Internal CRM used only by the staff (sales and customer service teams) of two Brazilian companies: KOMUNE LTDA, the developer, and its client Imova Imobiliária, a real estate agency. Access requires an e-mail registered by a company administrator; there is no public sign-up.*
   - Why unlisted: *The app is of no use to the general public. Team members use their own iPhones, which are not managed devices, so Apple Business Manager is not an option. We will send the link directly to the team.*
7. **Depois das duas aprovações:**
   - conferir em "Preço e disponibilidade" que a distribuição é "App não listado";
   - liberar a versão à mão;
   - copiar o link e mandar para a equipe.

## Versões seguintes

1. Subir `VERSAO_DA_CASCA` (`apps/app/src/ambiente.ts`).
2. Montar e enviar: `TRIADE_APP_AMBIENTE=producao npx eas-cli@25.3.0 build --platform ios --profile producao --non-interactive --auto-submit` (de `apps/app`).
3. Testar pelo TestFlight (grupo Equipe).
4. Criar a versão nova no App Store Connect, escolher a build, dizer o que mudou e enviar para revisão. Toda versão passa pela revisão. A distribuição não listada vale para as versões seguintes sem novo pedido.
