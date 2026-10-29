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

A única mudança no site até aqui é da entrada de teste, que só existe em `next dev` (em produção a rota dá 404): ela aceita o Supabase local também pelo endereço do Mac na rede, que é como o celular o enxerga (`apps/web/src/lib/auth/entrada-local.ts`).

## Como está organizado

| Caminho | O que é |
|---|---|
| `apps/app/src/ambiente.ts` | Os dois ambientes, de onde o app abre o Tríade, os hosts da casa e a marca no user-agent. Não importa nada do React Native: roda no `app.config.ts`, na casca e no Vitest. |
| `apps/app/src/navegacao.ts` | Para onde vai cada endereço: dentro do app (as duas empresas), para o aparelho (outros sites, login do Google, `tel:`, `mailto:`, `whatsapp:`) ou nada (`javascript:`, `file:`, `data:`). |
| `apps/app/src/cor-da-barra.ts` | A faixa do relógio acompanha o tema do site, como no Safari: a casca lê o `<meta name="theme-color">` que o site já troca entre claro e escuro. |
| `apps/app/src/casca.tsx` | A WebView, as bordas do aparelho, o botão voltar do Android e a volta sozinha depois de "Sem internet". |
| `apps/app/src/sem-internet.tsx` | A tela "Sem conexão" do protótipo. |
| `apps/app/app.config.ts` | Nome, identificador, permissões e o ambiente (`TRIADE_APP_AMBIENTE`). Os projetos nativos (`ios/`, `android/`) nascem dele a cada build e não vão para o git. |
| `apps/app/scripts/site-na-rede.ts` | Liga o site para o celular de teste (`pnpm -C apps/app site`). |

**Identificador nas lojas:** `br.app.komune.triade`. Fica fixo para sempre depois da primeira publicação.

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
2. Num terminal: `pnpm -C apps/app site`. Liga um segundo `next dev` na porta 3100, preso ao endereço do Mac na rede, com o Supabase local nesse endereço. O `next dev` de sempre, na 3000, continua como está.
3. Noutro terminal: `pnpm -C apps/app start`. O Expo mostra um QR code.
4. No iPhone, aponte a câmera para o QR code. Ele abre no Expo Go. Na primeira vez, o iPhone pede acesso à rede local: permita.
5. A tela de login do Tríade mostra "Entrar como gestor" e "Entrar como SDR". No celular é um papel por vez: para trocar, saia e entre com o outro.

**Cuidado:** enquanto o `site` estiver ligado, qualquer aparelho no mesmo Wi-Fi abre o Tríade local com a entrada de teste. Use só em rede de confiança e desligue (Ctrl+C) ao terminar.

**Inspecionar a página:** com o iPhone no cabo e "Inspetor Web" ligado (Ajustes → Apps → Safari → Avançado), o Safari do Mac mostra a página em Desenvolvedor → iPhone.

**Mac com mais de uma rede:** se o app procurar o Tríade no endereço errado, fixe o mesmo endereço nos dois comandos: `TRIADE_IP_DO_MAC=192.168.0.10 pnpm -C apps/app site` e `REACT_NATIVE_PACKAGER_HOSTNAME=192.168.0.10 pnpm -C apps/app start`.

## Versões

Expo 58.0.11 com React Native 0.88.0, a primeira combinação do SDK 58 com o React Native final, que completou duas semanas em 29/10/2026. O `expo install --check` pede patches mais novos (58.0.21, RN 0.88.1), que ainda não têm duas semanas. O Expo Go confere só o SDK, então isso não impede o teste.

## Limites conhecidos desta versão

- **Login com Google vai para o Safari.** O Google recusa login dentro de WebView (`disallowed_useragent`). Por isso, a casca manda esse endereço para o navegador do aparelho, em vez de mostrar a página de erro do Google. O login nativo com Google e Apple é a etapa 4.
- **Downloads por blob** (CSV e XLSX dos relatórios, exportação do parceiro) não salvam dentro do app. É um dos ajustes do site atrás da marca do app.
- **Ícone e tela de abertura são os padrões do Expo.** Faltam os da marca.
- **A tela "Sem internet" usa a fonte do sistema.** A Plus Jakarta Sans entra junto com o ícone da marca.
- **Android:** a casca afasta o site da barra de baixo, porque nem toda WebView do Android informa essa borda ao site. O teclado não foi conferido.
- **Quem só tem acesso à Imova** entra pela KOMUNE e não consegue. A escolha da empresa no login vem com a etapa 4.

## As etapas

1. Proteção: a comparação tela a tela do PC e do celular antes de cada publicação do site.
2. Ajustes de tamanho, só dentro do app.
3. **Casca no iPhone** (Expo desde 29/10/2026: a casca empacota para iPhone e Android; falta o primeiro teste no aparelho).
4. Login nativo com Google e Apple, com a escolha da empresa.
5. Push: mensagem nova, conversa transferida, compromisso marcado, lote para ligar, lembrete 30 min antes e resumo às 8h.
6. Teste com a equipe: build de desenvolvimento e TestFlight pelo EAS (conta Expo), teste fechado do Google Play.
7. Distribuição privada: Apple Business Manager e teste fechado.
