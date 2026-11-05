# O app de celular do Tríade

O app é uma **casca nativa feita com Expo (SDK 58)** que abre o próprio site do Tríade, da KOMUNE e da Imova, numa WebView do tamanho da tela. As telas, o login e as permissões são os mesmos do navegador. O código mora em `apps/app`.

**Expo, e não Capacitor (decisão do usuário em 29/10/2026).** A primeira casca, de 28/10, era Capacitor. Ela precisava do Xcode neste Mac, e o Xcode pede um macOS mais novo. Com o Expo:

- o app do iPhone é compilado na nuvem (EAS Build) e enviado ao TestFlight (EAS Submit), sem Xcode;
- o primeiro teste é no próprio iPhone, pelo app Expo Go, sem compilar nada;
- a ligação que toca com o app fechado (CallKit, VoIP push, áudio nativo) tem módulos prontos, sem código Swift à mão.

## A regra: o computador não muda

Decisão do usuário em 28/10/2026: "transformar a versão do mobile em app, sem interferir nem modificar a versão do PC".

- **A casca mora numa pasta própria e instala sozinha.** `apps/app` é um projeto pnpm à parte, com lockfile próprio (`apps/app/pnpm-lock.yaml`) e fora do `pnpm -r` da raiz. O app usa o React do React Native (19.3), e o site, o do Next (19.2). No mesmo workspace, o pnpm passava a versão do app para a reserva interna que pacotes do site consultam, e o typecheck do site quebrou (medido em 29/10). Separado, o `pnpm-lock.yaml` da raiz fica idêntico ao da main.
- **O que o app fizer de diferente no site entra atrás da marca do app.** A casca acrescenta `TriadeApp/<versão>` ao user-agent (`apps/app/src/ambiente.ts`). Sem essa marca, no PC ou no navegador do celular, o site segue exatamente como está.
- **Antes de publicar qualquer mudança no site feita para o app**, rodar a comparação tela a tela (`docs/operacao/comparar-versoes.md`): as 22 telas, gestor e SDR, PC e celular, têm de sair iguais à versão no ar.

As mudanças no site feitas para o app:
- **A entrada de teste**, que só existe em `next dev` (em produção a rota dá 404): ela aceita o Supabase local também pelo endereço do Mac na rede, que é como o celular o enxerga (`apps/web/src/lib/auth/entrada-local.ts`).
- **O login com Google pela janela segura** (04/11/2026, `apps/web/src/lib/auth/entrada-pelo-app.ts` e `apps/app/src/entrada.ts`). O botão "Entrar com Google" só toma o caminho novo com a marca do app no user-agent. As rotas `/auth/app/*` só respondem a quem chega pela janela segura do app. Veja "Login com Google" abaixo.

## Como está organizado

| Caminho | O que é |
|---|---|
| `apps/app/src/ambiente.ts` | Os dois ambientes, de onde o app abre o Tríade, os hosts da casa e a marca no user-agent. Não importa nada do React Native: roda no `app.config.ts`, na casca e no Vitest. |
| `apps/app/src/navegacao.ts` | Para onde vai cada endereço: dentro do app (as duas empresas), para o aparelho (outros sites, login do Google, `tel:`, `mailto:`, `whatsapp:`) ou nada (`javascript:`, `file:`, `data:`). |
| `apps/app/src/cor-da-barra.ts` | A faixa do relógio acompanha o tema do site, como no Safari: a casca lê o `<meta name="theme-color">` que o site já troca entre claro e escuro. |
| `apps/app/src/casca.tsx` | A WebView, as bordas do aparelho, o botão voltar do Android, a volta sozinha depois de "Sem internet" e a janela segura do login. |
| `apps/app/src/entrada.ts` | O login com Google do lado do app: reconhece o pedido do site, monta a ida e a volta da janela segura e confere o estado. |
| `apps/app/src/empresa.ts` | Em que empresa o app abre: a última em que a pessoa entrou de fato (página de dentro do CRM, nunca o login). A casca guarda a escolha no aparelho (`empresa.txt`). |
| `apps/app/src/arquivo.ts` | Os downloads do site no app: confere o recado com o arquivo (nome simples, CSV, XLSX ou JSON, até 20 MB). A casca grava e abre a folha de compartilhar. |
| `apps/app/src/sem-internet.tsx` | A tela "Sem conexão" do protótipo. |
| `apps/app/assets/` | A logo do Tríade: ícone do iPhone, ícone do Android e tela de abertura. Os SVGs são a fonte; os PNGs saem de `node scripts/gerar-icones.mjs`. |
| `apps/app/app.config.ts` | Nome, identificador, permissões e o ambiente (`TRIADE_APP_AMBIENTE`). Os projetos nativos (`ios/`, `android/`) nascem dele a cada build e não vão para o git. |
| `apps/app/scripts/site-na-rede.ts` | Liga o site para o celular de teste (`pnpm -C apps/app site`). |

**Identificador nas lojas:** `app.triade.crm`, neutro de empresa porque o app serve à KOMUNE e à Imova (05/11/2026). Fica fixo para sempre depois do cadastro na App Store. O primeiro, `br.app.komune.triade`, chegou a ser registrado na conta Apple numa montagem de teste e não foi usado.

## Ambientes

| `TRIADE_APP_AMBIENTE` | O app abre | Para quê |
|---|---|---|
| `local` (padrão) | `http://<endereço do Mac na rede>:3100` | O celular de teste, no mesmo Wi-Fi do Mac |
| `producao` | `https://triade-crm-tawny.vercel.app` | O app de verdade |

Sem a variável, o ambiente é `local`. Um app de teste nunca aponta para a produção por descuido. No ar, a casca só aceita https e só navega dentro das duas empresas.

No `local`, o app acha o Mac pelo endereço de onde o próprio Expo o serve. Por isso o iPhone, um Android e os simuladores usam o mesmo ambiente: o `local-android` do Capacitor deixou de existir.

## Testar no iPhone (Expo Go)

Precisa de: Supabase local de pé (`supabase start`), o iPhone no mesmo Wi-Fi do Mac e o app **Expo Go** (App Store) atualizado, que roda o SDK 58.

**Conta Expo nos dois lados.** Desde o Expo Go do SDK 57, o iPhone só abre o projeto com a mesma conta Expo logada no terminal (`pnpm -C apps/app exec expo login`) e no Expo Go (ícone de conta, no canto superior direito). A conta é grátis e é criada em expo.dev/signup. O login não publica nada: o código continua no Mac.

**O Wi-Fi de casa isola os aparelhos** (medido em 29/10/2026): o Safari do iPhone não abria `http://10.0.0.188:8081/status`, com o firewall do Mac desligado. Pelo **Acesso Pessoal (hotspot) do iPhone**, com o Mac conectado nele, funciona. Ligue os dois comandos depois de trocar de rede, porque o endereço do Mac muda. O macOS tende a voltar sozinho para a rede de casa.

1. Na primeira vez: `pnpm -C apps/app install`.
2. Num terminal: `pnpm -C apps/app site`. Liga as duas empresas de teste juntas, presas ao endereço do Mac na rede: KOMUNE na porta 3100 e Imova na 3101, cada uma com o Supabase local dela (o da Imova, em `~/triadecrm-imova-local`). O `next dev` de sempre, na 3000, continua como está.
   - **Escolha da empresa no login.** Na tela de login do app, "Entrar na empresa: KOMUNE | Imova" abre o login da empresa tocada (no navegador esse seletor não aparece). O app guarda a última empresa em que a pessoa entrou e abre nela da próxima vez.
   - **Troca de empresa como no ar.** Já logado, o botão do prédio, no cabeçalho, leva à outra empresa. Na primeira vez, a Imova pede o login dela ("Entrar como gestor"). A volta para a KOMUNE já vem logada. Os dois sites se conhecem (`NEXT_PUBLIC_EMPRESAS_LINKS`) e perguntam um ao outro se a pessoa entra lá, com um segredo sorteado a cada vez que o script liga.
   - **O banco da Imova é chamado pelo nome do Mac na rede** (`MacBook-Air-de-A.local`), e o da KOMUNE, pelo número. Os dois sites ficam no mesmo endereço, e o navegador guarda cookie por endereço, não por porta. Com o número nas duas, a Imova lia o login da KOMUNE. Se o nome não servir, use `TRIADE_NOME_DO_MAC=<nome>.local`.
   - `pnpm -C apps/app site komune` ou `site imova` liga uma empresa só, sem o botão de trocar.
   - No Chrome do computador, as telas da Imova por esse arranjo ficam em "Carregando": é a trava de acesso à rede local do próprio Chrome, que pede permissão para falar com o nome `.local`. No app do iPhone essa trava não existe.
3. Noutro terminal: `pnpm -C apps/app start`. O Expo mostra um QR code.
4. No iPhone, aponte a câmera para o QR code. Ele abre no Expo Go. Na primeira vez, o iPhone pede acesso à rede local: permita.
5. A tela de login do Tríade mostra "Entrar como gestor" e "Entrar como SDR". No celular é um papel por vez: para trocar, saia e entre com o outro.

**Cuidado:** enquanto o `site` estiver ligado, qualquer aparelho no mesmo Wi-Fi abre o Tríade local com a entrada de teste. Use só em rede de confiança e desligue (Ctrl+C) ao terminar.

**Inspecionar a página:** com o iPhone no cabo e "Inspetor Web" ligado (Ajustes → Apps → Safari → Avançado), o Safari do Mac mostra a página em Desenvolvedor → iPhone.

**Trocou de rede (Wi-Fi ↔ hotspot)?** Pare os dois comandos (Ctrl+C) e ligue de novo. O site fica preso ao endereço antigo, e o QR code aponta para ele.

**Teste de resposta só em conversa de número fictício** (+55 84 90000-00xx). Uma mensagem recebida inserida no banco dispara as regras de verdade, como a apresentação automática depois do "Boa tarde!". Depois de cada inserção, confira se não ficou nada na fila (`direction = 'out' and status = 'queued'`). O botão "Conversar" da ficha usa o telefone cadastrado no parceiro, que pode ser real.

**Mac com mais de uma rede:** se o app procurar o Tríade no endereço errado, fixe o mesmo endereço nos dois comandos: `TRIADE_IP_DO_MAC=192.168.0.10 pnpm -C apps/app site` e `REACT_NATIVE_PACKAGER_HOSTNAME=192.168.0.10 pnpm -C apps/app start`.

## Login com Google

O Google recusa login dentro de WebView (`disallowed_useragent`). Por isso o login acontece na **janela segura do iPhone** (`ASWebAuthenticationSession`, pelo `expo-web-browser`), a mesma folha que outros apps abrem para "Entrar com Google":

1. No app, "Entrar com Google" abre `/auth/app/google`. A casca intercepta esse endereço, sorteia um estado e abre a janela segura.
2. Na janela, o site guarda o estado e a volta num cookie e manda para o Google, pelo mesmo Supabase do navegador. A volta do Google é `/auth/callback?next=/auth/app/volta`.
3. `/auth/app/volta` gera um código de uso único para o mesmo e-mail (link mágico do Supabase, sem e-mail nenhum) e redireciona para a volta do app. A janela fecha, e só o app recebe o código. A sessão da janela é encerrada.
4. A casca confere o estado e abre `/auth/app/entrar?token=…` na WebView, que fica logada.

**Para onde o código pode ir:** `triade://auth`, o app instalado, ou `exp://<endereço da rede local>:<porta>/--/auth`, o Expo Go servido pelo Mac. Nunca um site, nem um Expo Go com endereço público. A volta do Expo Go sai quando a equipe passar a usar o app instalado.

**Recusas** (cancelou no Google, e-mail sem acesso, conta sem perfil): voltam para o app, que mostra o aviso na tela de login. Na janela, a pessoa ficaria presa.

**O microfone só funciona em https.** No teste do Mac (`http://<IP do Mac>`) o navegador nem oferece o microfone à página, e o gravador avisa isso. Para gravar áudio pelo app, abra o Tríade no ar.

**No teste do Mac** não há Google: a tela de login do app mostra também "Testar a janela segura do Google". A janela abre com os usuários de teste, e o resto do caminho é o mesmo do ar. Para testar, saia do Tríade no app (menu da conta → Sair) e toque nesse botão.

**No ar** precisa:
- do site publicado com as rotas `/auth/app/*`;
- da volta `/auth/callback?next=/auth/app/volta` aceita na lista de endereços de retorno do Supabase de cada empresa. O botão do navegador já usa `/auth/callback?next=…`;
- do app aberto no ambiente `producao` (`TRIADE_APP_AMBIENTE=producao pnpm -C apps/app start`).

## Versões

Expo 58.0.11 com React Native 0.88.0, a primeira combinação do SDK 58 com o React Native final, que completou duas semanas em 29/10/2026. O `expo install --check` pede patches mais novos (58.0.21, RN 0.88.1), que ainda não têm duas semanas. O Expo Go confere só o SDK, então isso não impede o teste.

## Limites conhecidos desta versão

- **Login com Apple ainda não existe.** O Google entra pela janela segura (acima). A Apple precisa da chave da conta Apple da KOMUNE e de uma versão instalável do app, porque no Expo Go o app tem o identificador do Expo.
- **Downloads** (CSV e XLSX dos relatórios, exportação do parceiro): desde 05/11/2026, no app, o arquivo abre na folha de compartilhar do aparelho (Salvar em Arquivos, WhatsApp, e-mail), em vez de baixar (`lib/entregar-arquivo.ts` no site, `src/arquivo.ts` na casca). No navegador, o download é o de sempre.
- **Ícone e tela de abertura do Tríade** (05/11/2026) só aparecem no app instalado. No Expo Go aparecem os do Expo Go.
- **A tela "Sem internet" usa a fonte do sistema.**
- **Android:** a casca afasta o site da barra de baixo, porque nem toda WebView do Android informa essa borda ao site. O teclado não foi conferido.
- **A escolha da empresa no login** só aparece com o site publicado com ela (05/11/2026, ainda não no ar). Antes disso, no app, quem só tem acesso à Imova é recusado pela KOMUNE.

## As etapas

1. Proteção: a comparação tela a tela do PC e do celular antes de cada publicação do site.
2. Ajustes de tamanho, só dentro do app.
3. **Casca no iPhone** (Expo desde 29/10/2026: a casca empacota para iPhone e Android; falta o primeiro teste no aparelho).
4. Login: **Google pela janela segura** (no ar desde 05/11/2026; primeiro login real e primeiro áudio pelo app conferidos no iPhone). Escolha da empresa no login feita em 05/11/2026. Apple nativo ainda falta.
5. Push: mensagem nova, conversa transferida, compromisso marcado, lote para ligar, lembrete 30 min antes e resumo às 8h.
6. Teste com a equipe: build de desenvolvimento e TestFlight pelo EAS (conta Expo), teste fechado do Google Play.
7. Distribuição privada: Apple Business Manager e teste fechado.
