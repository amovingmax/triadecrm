# Anúncios e leads do Canal Pro no CRM da Imova: contexto

Situação em 05/11/2026, fim da tarde. Resume a conversa de 04 e 05/11/2026 entre o usuário e o Claude Code sobre integrar o CRM da Imova (instalação Imova do Tríade) ao Canal Pro do Grupo OLX (ZAP Imóveis, Viva Real e OLX).

**Nada disto está em produção e nada tem commit.** Todo o trabalho está na worktree `/Users/amovingmaxm4/triadecrm-anuncios` (branch `anuncios-canal-pro`), testado no Supabase local da Imova. A KOMUNE não é afetada: toda migração verifica a empresa e, no banco da KOMUNE, só emite um aviso.

---

## 1. Resumo

- A Imova vai continuar anunciando no ZAP, no Viva Real e na OLX pelo plano do Canal Pro, mas vai publicar, editar e tirar anúncios do ar pelo próprio CRM.
- O Grupo OLX **não tem API** para criar, ler ou apagar anúncios. A única integração de anúncios é um **arquivo XML (VRSync)** num endereço que o Canal Pro lê. Hoje esse endereço é o da **Arbo Imóveis**, que publica os anúncios da Imova.
- Os leads chegam por um **webhook** do Grupo OLX, que só é liberado depois de uma **homologação** (formulário). Pela decisão do usuário, o lead só aparece no CRM **quando a pessoa manda mensagem** e já chega com o anúncio e o código do imóvel.
- Já existe, no ambiente local: publicar e tirar do ar pelo CRM, o limite do plano, o importador do sistema atual (Arbo), o importador do relatório do Canal Pro, a entrada de leads, a aba Leads, a etiqueta "Veio do anúncio" nas conversas e a lista de Anúncios no formato do cartão do Canal Pro.
- Faltam, nesta ordem:
  1. autorização para publicar;
  2. validar o endpoint e enviar o formulário;
  3. o relatório exportado do Canal Pro;
  4. trocar o endereço no Canal Pro.

---

## 2. O que o usuário pediu

Palavras do usuário, em 04 e 05/11/2026:

1. "Subir anúncios dentro do próprio CRM da Imova e, assim que subirmos pelo CRM, o anúncio também subir no Canal Pro."
2. "Todos os imóveis que estão sendo anunciados pela ZAP devem aparecer no nosso CRM, isso inclui: anúncios no ar, rascunhos, e os anúncios que já estão no Canal Pro."
3. "Opção de remover os anúncios do ar pelo nosso CRM", e com isso tirá-los do ZAP.
4. "Todos os leads apareçam no nosso CRM com o contato deles", com "identificação de qual anúncio ele veio, incluindo o código do imóvel".
5. Um protótipo interativo com aparência e estrutura parecidas com as do Canal Pro, entregue por link.
6. "Quero poder editar e gerir meus anúncios dentro do meu próprio CRM", ou seja, "que o meu sistema seja integrado com tudo isso".
7. Depois refinado: "os leads somente cheguem ao CRM quando enviarem mensagem", e quando enviarem, que "já venham com a tag de qual anúncio eles clicaram, com o código do imóvel".
8. "Preciso que o meu CRM fique igual o Canal Pro" (o print do CRM ao lado do print do cartão do Canal Pro).

---

## 3. Fatos que moldam a solução

### O Grupo OLX e o Canal Pro

- **Anúncios:** a integração é um arquivo XML no formato VRSync, num endereço que a conta cadastra no Canal Pro (Configurações da conta → Integração de anúncios).
  - O robô do Grupo OLX lê o arquivo periodicamente. A tela da Imova mostra a próxima leitura "amanhã às 00:07".
  - O portal mostra as mudanças em até 4 h (ZAP e Viva Real) ou 24 h (OLX).
  - Não há API para criar, ler ou apagar anúncios.
- **Um integrador por conta.** Trocar de integrador pode apagar os anúncios integrados. Ninguém publica se manter os mesmos códigos (ListingID) preserva os anúncios.
  - O caminho seguro é perguntar ao suporte (chamado.integracao@olxbr.com).
  - O usuário prefere seguir sem esse e-mail. Foi avisado do pior caso: os anúncios são apagados e recriados, ficam até cerca de 1 dia fora do ar e perdem o histórico.
  - A volta é colar de novo o endereço da Arbo.
- **"Via Integração" e "Via CanalPro":** no Canal Pro, "Via Integração" é anúncio vindo de outro sistema, e só esse sistema o tira do ar. "Via CanalPro" é anúncio cadastrado à mão no Canal Pro.
- **Validador oficial do arquivo:** POST multipart com o campo `file` para `https://integrations-api-re-listings.olx.com.br/v1/sandbox/xml_validation`.
  - Confere estrutura e vocabulário.
  - Recusou `TRIPLE` (destaque triplo) e "Residential / Loft". O triplo saiu do CRM, e o loft é enviado como apartamento.
  - O `ContactInfo` vai dentro de cada anúncio.
- **Regras do portal:**
  - fotos só em JPG, até 7 MB cada. A documentação pede no mínimo 5, mas o Canal Pro aceitou 4, e o CRM pede 4 (decisão de 05/11);
  - título de 10 a 100 caracteres;
  - descrição de 50 a 3.000 caracteres;
  - CEP, estado, cidade e bairro;
  - área;
  - quartos e banheiros, nos tipos que pedem.
- **Leads:** chegam por webhook, um POST JSON com `Authorization: Basic base64(usuario:SECRET_KEY)`.
  - A SECRET_KEY vem da homologação.
  - O endpoint tem de ser validado antes no validador de endpoint, que chama `POST https://integrations-api-re-listings.olx.com.br/v1/sandbox/leads/send-a-lead-to-me` com `{url, token, body}`.
  - O que responder:
    - 2xx: inclusive para lead repetido;
    - 401: chave errada;
    - nunca 404, que desliga a integração;
    - nunca 3xx.
  - O Grupo OLX tenta 3 vezes e guarda o lead por 14 dias.
- **Campos do lead:**
  - originLeadId, que identifica o lead e evita duplicidade;
  - clientListingId, o código do imóvel no CRM;
  - originListingId, o código no portal;
  - name, email, ddd, phone;
  - message;
  - temperature (Baixa, Média, Alta);
  - transactionType (SELL, RENT);
  - extraData: leadType (CLICK_WHATSAPP, PHONE_VIEW, CONTACT_CHAT, CONTACT_FORM, VISIT_REQUEST, CLICK_SCHEDULE), leadCerto, izi, feedback e mcmv. O mcmv pode trazer CPF ou CNPJ, e o CRM não guarda.
  - Não vêm: de qual portal (o aviso diz só "Grupo OLX") e o histórico de busca da pessoa.
- **Lead Certo:** a pessoa viu um anúncio parecido e o portal a indicou para a Imova. O CRM mostra "Parecido com o anúncio X".
- **Izi:** a atendente automática do Grupo OLX. Se estiver ligada, o WhatsApp do anúncio cai num número dela, fora do CRM.
- **Relatório de integração por webhook:** depois de cada leitura, traz totais e erros e avisos por ListingID. Não traz visualizações nem nota de qualidade, e também exige endpoint homologado.
- **Fica só no Canal Pro:** as visualizações e a nota de qualidade, que o Grupo OLX não publica como calcula.
- **Plano B dos leads:** o e-mail de lead do Grupo OLX traz nome, e-mail, telefone e o código do imóvel (`listing-externalCode`) em atributos `title`, que dá para ler. Exigiria um endereço de e-mail que o CRM leia. Não foi construído.
- **A mensagem pronta do WhatsApp:** não se sabe se o texto que o portal deixa escrito no WhatsApp traz link ou código. A documentação não diz. A leitura das mensagens de produção foi bloqueada sem autorização do usuário, e foi pedido a ele o print de um teste.

### A conta da Imova hoje

- **No Canal Pro:** 17 anúncios, 9 publicados e 8 não publicados. O plano é Multiportais 10 Padrão: 10 anúncios e 2 destaques, até 22/01/2027.
- **Integração de anúncios:** software "Desenvolvedor Próprio", com a URL da Arbo (`https://integracao.arboimoveis.com/api/custom-xml/imobiliaria/<chave>/vivareal-xml`).
  - **A chave no caminho funciona como senha:** não guardar em repositório nem compartilhar. Ela está na própria tela do Canal Pro.
  - Como a Arbo já está como "Desenvolvedor Próprio", a troca para o CRM é só trocar a URL nesse campo.
- **O arquivo da Arbo tem 7 anúncios:**

  | Código | Imóvel | Fotos |
  |---|---|---|
  | TE0001_IMOVA | Terreno 3.000 m², Capim Macio | 12 |
  | TE0002_IMOVA | Terreno na área da BONOR, Parnamirim | 12 |
  | TE0003_IMOVA | Terreno esquina 10.000 m², Parnamirim | 4 (o portal pede 5) |
  | TE0004_IMOVA | Terreno frente ao mar, Tabatinga | 6 |
  | TE0005_IMOVA | 4 terrenos em Pipa | 7 |
  | SA0012_IMOVA | Sala comercial no Brisa Mall, Ponta Negra (aluguel) | 8 |
  | PT0001_IMOVA | Repasse Loja de Plantas + Casa, Ponta Negra | 17 |

- **O relatório exportado do Canal Pro (05/11, noite)** tem 17 linhas: 9 ativos e 8 inativos. Os outros 10, que não estão no arquivo da Arbo, são anúncios antigos com códigos antigos:
  - **2 ativos repetidos**, o mesmo imóvel de um atual: "BONOR-ESQUINA-HERONIDES" (= TE0002_IMOVA) e "Terreno - Pipa" (= TE0005_IMOVA). Ocupam 2 vagas do plano.
  - **4 inativos**, versões antigas de imóveis atuais: Sala 05 (= SA0012), Bonor 10.000 (= TE0003), Tabatinga (= TE0004) e Capim Macio (= TE0001).
  - **4 inativos que só existem lá:**
    - "Brisa Mall - Loja 02", bloqueado pelo Grupo OLX "por infringir regulamento";
    - "Casa extremox";
    - "Edifício Simone", com 1.073 visualizações e 58 contatos;
    - "SANTA CATARINA".
  - O TE0003_IMOVA está ativo lá com 4 fotos.
- **As fotos da Arbo vêm em WebP,** com a marca d'água da Imova.
- **O WhatsApp no arquivo da Arbo é o (84) 99405-8888,** que está no CRM desde 28/10/2026. Ainda falta confirmar se o botão do anúncio usa esse número e se a Izi está ligada.
- **Dados da empresa:** IMOVA LTDA, CRECI-RN PJ 9825, e-mail de domínio contato@imovaimobiliaria.com.br. O formulário do Grupo OLX recusa Gmail.

---

## 4. Decisões do usuário

| Quando | Decisão |
|---|---|
| 04/11 | Todos criam anúncio; admin e gestor publicam, destacam, excluem e tiram do ar. |
| 04/11 | Os anúncios cadastrados à mão no Canal Pro aparecem no CRM pelo relatório exportado. Eles só se excluem dentro do Canal Pro, e o CRM orienta. |
| 04/11 | Limite do plano no CRM: 10 anúncios e 2 destaques. |
| 05/11 | O sistema atual é a Arbo. Os anúncios dela vêm para o CRM com o mesmo código, como rascunho. |
| 05/11 | Seguir sem o e-mail ao suporte. O e-mail foi escrito e fica como opcional (anexo B). |
| 05/11 | Seguir **com o formulário** de homologação dos leads, para ter mais informação no CRM. |
| 05/11 | O lead só entra no CRM quando a pessoa **manda mensagem**: pelo WhatsApp, ou pelo chat, formulário ou pedido de visita do portal. |
| 05/11 | Quem tocou em WhatsApp, "ver telefone" ou agendar e não mandou mensagem fica numa seção separada, **"Clicaram e não chamaram"**, para a equipe ligar. O contato é apagado em 90 dias. |
| 05/11 | Quem escreveu pelo chat, formulário ou pedido de visita do portal entra na lista principal e ganha ficha de Cliente na hora. |
| 05/11 | A lista de Anúncios do CRM deve ficar como o cartão do Canal Pro. |
| 05/11 | Um código, um anúncio: o código do imóvel é único. |
| 05/11 | Os inativos aparecem como inativos, na aba "Não publicados". As abas passaram a ser Publicados, Não publicados, Rascunhos e Excluídos. |
| 05/11 | Quatro fotos bastam para ir ao ar. O Canal Pro aceitou o TE0003 com 4. |
| 05/11 | Sem trava de fotos: basta 1 para ir ao ar (o formato exige uma); máximo de 40. |
| 05/11 | Os 4 imóveis que só existem no Canal Pro vêm para o CRM com o código de lá ("Casa extremox"): o código aceita espaço e acento. |
| 06/11 | Atualizar com um clique: o endereço do sistema atual fica guardado e o botão traz tudo; o relatório traz sozinho o que só existe no Canal Pro (sem as cópias); as abas consideram quem saiu do arquivo do sistema atual. |
| 06/11 | Nada de campo no caminho: "Atualizar do Canal Pro" importa ao escolher o arquivo; o contato, o plano e a URL do CRM foram para a engrenagem "Ajustes do Canal Pro"; o endereço do sistema atual é guardado na publicação. |
| 06/11 | Excluir duplicado: o CRM não exclui no Canal Pro (não há como); o botão copia o código e abre o Canal Pro, a exclusão é um clique lá, e o próximo relatório confere (`marcado_excluido_em` avisa quando não pegou). |
| 06/11 | Excluir no CRM e sair do Canal Pro é o arquivo do CRM (já pronto), ligado na troca. Antes de colar, os Ajustes põem no ar pelo CRM o que está no portal pelo sistema atual — o arquivo do CRM estava vazio e a troca tiraria os 7 do ar. |
| 05/11 | Recomendação aceita: importar o relatório do Canal Pro uma vez (com o primeiro arquivo enviado ao Claude para conferir o formato), trocar o endereço e, depois, ligar o relatório de integração. A leitura diária da Arbo só vale se a troca demorar. |

---

## 5. O que foi construído (local)

### Banco (`supabase/migrations`, só na Imova)

| Migração | O que faz |
|---|---|
| `20261104150000_anuncios_no_canal_pro` | Tabelas de anúncios e fotos, com o balde **público** `anuncios` (só JPEG, 7 MB). Funções de publicar, tirar do ar, destaque e excluir. Arquivo VRSync do CRM (`canal_pro_feed`). Relatório do Canal Pro importado (`anuncios_no_canal_pro`, `canal_pro_importar`, `canal_pro_trazer`, `canal_pro_marcar_excluido`). Registro das leituras do Grupo OLX (`canal_pro_leituras`). |
| `20261104180000_anuncios_limite_do_plano` | Limite do plano (`canal_pro.limite_anuncios` e `limite_destaques`). Publicar recusa `plano_cheio` e `plano_sem_destaque`. Sem triplo; loft enviado como apartamento. |
| `20261105100000_leads_dos_portais` | Origem "Portais (ZAP, Viva Real, OLX)"; tabela `portal_leads`; `grupozap_lead_receber` (idempotente); assumir e mudar situação; coluna de leads na lista de Anúncios. |
| `20261105110000_anuncios_do_sistema_atual` | `anuncios.origem` (crm, relatorio_canal_pro, sistema_atual) e `importado_em`; `anuncio_importar`, que cria ou atualiza o rascunho pelo código. |
| `20261105130000_leads_so_com_mensagem` | O contato do portal vai para `portal_lead_contatos`, que só a gestão lê. O SDR revela pela função `portal_lead_revelar_telefone`, e a revelação fica registrada. Só quem escreveu pelo portal ganha ficha na hora. A lista `portal_leads_na_lista` liga o lead à conversa de WhatsApp do mesmo telefone com mensagem depois do clique, na hora de ler, e mostra a primeira mensagem, a primeira resposta do time e "respondido" sozinho. A rotina `portal_leads_manter` roda a cada 15 min: grava a conversa, põe a atividade na ficha e apaga o contato depois de 90 dias. Nenhum gatilho nem chave estrangeira em `messages` ou `conversations`. |
| `20261106100000_atualizar_com_um_clique` | Endereço do sistema atual guardado, `sistema_atual_no_arquivo`, `canal_pro_parece_com` no banco e o relatório que traz sozinho. |
| `20261105170000_codigo_como_no_canal_pro` | Código com espaço e acento, como no Canal Pro (`app.codigo_de_anuncio_valido`, no check, no importar e no trazer). |
| `20261105160000_fotos_sem_minimo` | Sem mínimo de fotos além de uma (pendências e remoção da última foto no ar). Era a `quatro_fotos_bastam`. |
| `20261105150000_relatorio_real_do_canal_pro` | O relatório de verdade: só o ativo ocupa vaga do plano; "Trazer para o CRM" liga quando o código já existe no CRM e, com outro código, traz descrição, CEP, estado, cômodos, áreas, condomínio e IPTU da linha; a lista ganha os contatos e a data de criação do Canal Pro. |
| `20261105140000_anuncios_como_no_canal_pro` | A lista de Anúncios ganha o que o cartão do Canal Pro mostra: cômodos, endereço, o que pesa na nota de qualidade, a última leitura do Grupo OLX e a situação e as visualizações do último relatório do Canal Pro. |

### Funções na nuvem (`supabase/functions`)

- `canal-pro-feed`: serve o arquivo VRSync do CRM em `<projeto>/functions/v1/canal-pro-feed?chave=<64 hex>`. É esse endereço que vai no Canal Pro.
- `grupozap-lead`: recebe os leads.
  - Confere a credencial Basic em tempo constante.
  - Aceita só POST, até 256 KB.
  - Responde 200, 401, 400, 405, 413, 422, 500 ou 503, nunca 404 nem 3xx.
  - Usa o segredo `GRUPOZAP_LEAD_SECRET` (mais `_ANTERIOR` e `GRUPOZAP_LEAD_USUARIO`, opcionais).
  - Tem `verify_jwt = false` no `config.toml`.

### Site (`apps/web/src`)

- **Anúncios (`components/anuncios`):**
  - lista, editor em passos, fotos convertidas para JPEG, publicar e tirar do ar;
  - limite do plano e folha "Canal Pro" com o endereço do arquivo;
  - "No Canal Pro hoje", com "Como tirar do ar" (Via Integração e Via CanalPro);
  - **"Trazer do sistema atual":** lê o arquivo da Arbo com proteção contra endereços internos e converte WebP e PNG para JPEG no servidor (`app/api/anuncios/importar/fotos/foto-em-jpeg.ts`, com `sharp`);
  - **"Trazer a lista do Canal Pro" / "Importar de novo":** lê o relatório exportado, em CSV ou .xlsx.
- **Aba Leads (`components/anuncios/leads`):**
  - **"Mandaram mensagem":** como chegou, a primeira mensagem, "Respondido em X min · fulano" ou "Sem resposta há X". No alto: hoje, 7 dias, sem resposta e tempo médio até a 1ª resposta.
  - **"Clicaram e não chamaram":** nome e e-mail do portal, telefone com Revelar para o SDR, o que tocou, Descartar e o aviso dos 90 dias.
  - **"Resumo por anúncio · últimos 7 dias":** o Lead Certo fica fora da conta, com nota.
  - **Ficha do lead:** o nome que veio do portal, a primeira mensagem, a resposta e "Abrir conversa".
- **Conversas:** a etiqueta "Veio do anúncio X · WhatsApp" aparece em "Dados do contato", só leitura, só para quem mandou mensagem, também na conversa de quem ainda não tem ficha.
- **Lista de Anúncios no formato do cartão do Canal Pro** (05/11, fim da tarde; `cartao-do-anuncio.tsx` e `regras-do-cartao.ts`):
  - foto grande com a contagem, e o endereço como título, com o título do anúncio embaixo;
  - Venda ou Aluguel, a origem e o código com botão de copiar;
  - tipo, área, quartos, banheiros, vagas, preço e "Criado em · Atualizado em";
  - "Qualidade do anúncio", com nota calculada pelo CRM (pode diferir da do Canal Pro) e o que sobe a nota;
  - situação com as palavras do Canal Pro (Publicado, Em processamento, Rascunho, Não publicado);
  - "No portal pelo sistema atual" nos rascunhos que vieram da Arbo;
  - visualizações, só quando o relatório do Canal Pro traz;
  - leads;
  - menu ⋮ com editar, copiar código, ver leads e, para a gestão, pôr no ar, destaque, tirar do ar, excluir e restaurar.

  **Limites:** "Criado em" é a data do CRM (os 7 da Arbo mostram 05/11/2026). A nota dos anúncios da Arbo sai mais baixa que a do Canal Pro (PT0001: 7,0 contra 9,2), porque o arquivo da Arbo não traz características nem IPTU.

### Testes

- pgTAP: 123 (60), 124 (30), 125 (66), 126 (39), 127 (43) e 128 (16), todos passando no banco local da Imova.
- Vitest: 1.697 testes no site, passando. Typecheck, eslint e prettier limpos.
- Deno: 39 testes das duas funções.
- Na KOMUNE, as migrações só emitem o aviso. O `db lint` não aponta nada nas funções novas.
- Ensaios:
  - o arquivo do CRM e o de exemplo passaram no validador oficial;
  - 17 casos de curl na função de leads;
  - o importador com o arquivo real da Arbo: 7 anúncios e 66 fotos;
  - as telas no Chrome em 1440 e 390 px, como gestor e SDR.

### Protótipo

- Link: https://claude.ai/artifact/RnA81VvJWEGk83tgABJf12 (privado até ser compartilhado).
- Tem a estrutura do Canal Pro: Meus anúncios, editor em 7 passos, Leads e Integração. Usa os 3 anúncios reais dos prints e dados de exemplo.

---

## 6. Como testar no computador (local)

- **Site:** `next dev -p 3090` em `apps/web` da worktree, com o `.env.local` da Imova (banco local na porta 56321).
  - Gestor: http://localhost:3090/auth/dev?quem=gestor&next=/anuncios
  - Leads: http://localhost:3090/auth/dev?quem=gestor&next=/anuncios/leads
  - SDR (tem de ser 127.0.0.1): http://127.0.0.1:3090/auth/dev?quem=sdr&next=/anuncios
- **Função de leads local:** contêiner `grupozap-lead-local`, porta 8790, com chave local de teste.
- **Arquivo de anúncios local:** contêiner `canal-pro-feed-local`, porta 8789.
- **Dados de exemplo no banco local:**
  - os 7 anúncios reais da Arbo (rascunho, com fotos);
  - anúncios de teste IMV-0011, 0012, 0033, 0037 e 0048;
  - 7 leads de exemplo (`exemplo-0511-a` a `g`): 3 pelo WhatsApp com conversa local, 1 pelo chat, 1 pedido de visita e 2 que só clicaram.
- O backup do banco local antes dos anúncios está em `~/triadecrm-backups/imova-local-antes-anuncios-0411.dump`.

---

## 7. O que falta, em ordem

1. **Autorização do usuário: "pode publicar" e "sim" para o balde público das fotos.** O robô do Grupo OLX precisa baixar as fotos, que já são públicas no portal. Publicar o banco cria o balde público.
   - Publicar só na Imova: as 6 migrações (`publicar-banco.mjs imova migrar`), as funções `canal-pro-feed` e `grupozap-lead` (`supabase functions deploy … --project-ref kkqadgxvmzulcamuakzk`) e o site da Imova, de uma cópia limpa da main.
   - Antes: conferir o que está no ar contra a main.
2. **Validar o endpoint de leads:** gravar uma chave provisória em `GRUPOZAP_LEAD_SECRET`, rodar o validador do Grupo OLX contra `https://kkqadgxvmzulcamuakzk.supabase.co/functions/v1/grupozap-lead` e apagar o lead de teste que entra na produção.
3. **Enviar o formulário de homologação**, com as respostas do anexo A. Quando o Grupo OLX mandar a SECRET_KEY, trocar o segredo. A partir daí os leads chegam.
4. **Relatório do Canal Pro: feito no local (05/11, noite).** O arquivo real foi lido e importado. Os 7 da Arbo casaram pelo código, e os cartões mostram a situação, as visualizações, os contatos e a data de criação de lá.
   - **Falta decidir:** tirar do ar no Canal Pro os 2 antigos ativos repetidos, e trazer ou não os 4 imóveis que só existem lá. Eles vêm sem fotos.
   - Importar de novo uma vez por semana até a troca.
5. **Antes da troca:** os anúncios no CRM e os publicados de hoje no ar pelo CRM, até 10, o limite do plano. O TE0003 já pode ir com as 4 fotos que tem.
6. **A troca:** alguém com o login do Canal Pro cola o endereço do CRM (Anúncios → botão Canal Pro) no lugar do da Arbo, mantém "Desenvolvedor Próprio" e clica em Adicionar, de manhã. No dia seguinte, conferir o relatório de integração e o portal. Dali em diante, anúncio só se edita no CRM.
7. **Depois da troca:** ligar o relatório de integração por webhook, que mostra os erros de cada anúncio no CRM.
8. **Perguntas em aberto ao usuário:**
   - Qual número abre no WhatsApp do anúncio, e a Izi está ligada?
   - O print da mensagem pronta do WhatsApp (ZAP e OLX).
   - A Arbo recebe os leads hoje? Ao ligar os leads no CRM, ela pode deixar de receber.
9. **Mais tarde:**
   - a mensagem do lead no dossiê da LGPD;
   - a leitura do e-mail de lead (plano B);
   - quem chama no WhatsApp só com nome de usuário (BSUID), sem telefone, não abre conversa hoje;
   - commit quando o usuário pedir.

---

## 8. Cuidados

- **WhatsApp intocável:** nada disto envia mensagem, enfileira envio ou cria gatilho em `messages` ou `conversations`. A ligação do lead com a conversa é só leitura.
- **KOMUNE intocada:** toda migração verifica a empresa.
- **Sem CPF no CRM:** a simulação do Minha Casa Minha Vida vira só um marcador.
- **Produção só a pedido:** nada de `db push`, deploy ou merge sem o usuário pedir.
- **A chave da URL da Arbo e a SECRET_KEY** nunca entram no repositório.
- **Safeupdate:** o `authenticator` do Supabase recusa UPDATE e DELETE sem WHERE dentro de função. O pgTAP 123 e o 125 conferem o texto das funções.
- **O protótipo e as telas não usam marca nem logotipo** do Grupo OLX, ZAP ou Canal Pro.

---

## Anexo A: respostas do formulário de homologação

Formulário "Homologação de Softwares": https://docs.google.com/forms/d/e/1FAIpQLSd6WJ3xw-qoFzW2-6OvrEihTjurUwVsJYei-P4alae2S1yedQ/viewform

Só enviar depois de validar o endpoint (passo 2 da seção 7).

| Campo | Resposta |
|---|---|
| Antes de começar | Marcar as duas opções |
| Nome da Aplicação | Imova CRM |
| Nome da Empresa do CRM Integrador | IMOVA LTDA |
| Endpoint | `https://kkqadgxvmzulcamuakzk.supabase.co/functions/v1/grupozap-lead` |
| E-mail para contato | contato@imovaimobiliaria.com.br |
| Perfil | Imobiliária |
| Observação | CRM próprio da Imova, usado só pela própria conta (Imova - Negócios Imobiliária). O endpoint responde 2xx ao lead recebido ou repetido (deduplicado pelo originLeadId) e 401 à chave errada. Aguardamos a SECRET_KEY para substituir a chave provisória usada no validador. |

## Anexo B: e-mail ao suporte (opcional)

**De:** contato@imovaimobiliaria.com.br · **Para:** chamado.integracao@olxbr.com
**Assunto:** Troca de integrador na conta Imova - Negócios Imobiliária, com os mesmos códigos de anúncio

> Olá, equipe de integração,
>
> Somos a Imova - Negócios Imobiliária (IMOVA LTDA, CRECI-RN PJ 9825, Natal/RN). Nossa conta do Canal Pro é a de login **[e-mail de acesso ao Canal Pro]**, no plano Multiportais 10 Padrão.
>
> Hoje nossos anúncios chegam por integração. Em Configurações da conta → Integração de anúncios, o software está como "Desenvolvedor Próprio", e a URL é a do arquivo VRSync da Arbo Imóveis (integracao.arboimoveis.com).
>
> Temos um CRM próprio e queremos que ele publique no lugar da Arbo. O arquivo dele já passou no validador de XML de vocês e vai trazer os mesmos anúncios, com o mesmo ListingID de hoje (por exemplo, SA0012_IMOVA, PT0001_IMOVA e TE0002_IMOVA).
>
> Antes de trocar, precisamos confirmar:
>
> 1. Se trocarmos só a URL de Integração e mantivermos "Desenvolvedor Próprio", os anúncios com o mesmo ListingID continuam os mesmos no portal, com visualizações, leads e qualidade? Ou eles são apagados e criados de novo?
> 2. Existe um procedimento recomendado para a troca, como dia, horário ou aviso prévio?
> 3. A conta mostra 17 anúncios (9 publicados e 8 não publicados), mas o arquivo da Arbo tem 7. Vocês podem nos dizer quais dos 17 vieram da integração e quais foram cadastrados direto no Canal Pro? Os cadastrados direto são afetados pela troca?
> 4. Depois da troca, a primeira leitura da nova URL acontece no horário programado, ou podemos pedir uma leitura antes?
> 5. Também vamos receber os leads no nosso CRM pela integração por webhook, e faremos a homologação pelo formulário. Os leads continuam chegando por e-mail e no Canal Pro depois disso? Se outro sistema recebe nossos leads hoje, ele deixa de receber?
>
> Obrigado,
> **[Seu nome]**
> Imova Imobiliária · contato@imovaimobiliaria.com.br · (84) 99405-8888

## Anexo C: onde está cada coisa

- Histórico detalhado: `docs/CHANGELOG.md`, nas entradas de 04/11/2026 e 05/11/2026 ("Anúncios e leads do Canal Pro no CRM da Imova" e "o lead só entra quando a pessoa manda mensagem").
- Migrações: `supabase/migrations/2026110415*`, `2026110418*` e `2026110510*` a `2026110514*`.
- Testes do banco: `supabase/tests/123_*` a `127_*`.
- Funções: `supabase/functions/canal-pro-feed/`, `supabase/functions/grupozap-lead/`.
- Telas: `apps/web/src/components/anuncios/` (inclui `leads/`), `apps/web/src/components/conversas/origem-no-portal*`, `apps/web/src/app/api/anuncios/`.
