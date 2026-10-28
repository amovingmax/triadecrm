# O app de celular do Tríade

O app é uma **casca nativa (Capacitor 8.5.3)** que abre o próprio site do Tríade, da KOMUNE e da Imova. As telas, o login e as permissões são os mesmos do navegador. O código mora em `apps/app`.

## A regra: o computador não muda

Decisão do usuário em 28/10/2026: "transformar a versão do mobile em app, sem interferir nem modificar a versão do PC".

- **A casca mora numa pasta própria.** `apps/web` (o site) não muda por causa dela, e a publicação do site continua igual.
- **O que o app fizer de diferente no site entra atrás da marca do app.** A casca acrescenta `TriadeApp/<versão>` ao user-agent (`apps/app/src/ambiente.ts`). Sem essa marca, no PC ou no navegador do celular, o site segue exatamente como está.
- **Antes de publicar qualquer mudança no site feita para o app**, rodar a comparação tela a tela (`docs/operacao/comparar-versoes.md`): as 22 telas, gestor e SDR, PC e celular, têm de sair iguais à versão no ar.

## Como está organizado

| Caminho | O que é |
|---|---|
| `apps/app/src/ambiente.ts` | De onde o app abre o Tríade, o que ele deixa navegar e a marca no user-agent. Testado em `ambiente.test.ts`. |
| `apps/app/capacitor.config.ts` | Lê `TRIADE_APP_AMBIENTE` e monta a configuração. |
| `apps/app/www/erro.html` | A tela "Sem internet" do protótipo. Quando a conexão volta, o app abre o Tríade de novo sozinho. |
| `apps/app/scripts/preparar-www.ts` | Escreve `www/inicio.js` (o endereço do ambiente) e copia a fonte do site para a tela sem internet. |
| `apps/app/android`, `apps/app/ios` | Os projetos nativos gerados pelo Capacitor (`cap add`). O que o `cap sync` copia para dentro deles fica fora do git. |

**Identificador nas lojas:** `br.app.komune.triade`. Fica fixo para sempre depois da primeira publicação.

## Ambientes

| `TRIADE_APP_AMBIENTE` | O app abre | Para quê |
|---|---|---|
| `local` (padrão) | `http://localhost:3000` | Simulador do iPhone, contra o `next dev` deste Mac |
| `local-android` | `http://10.0.2.2:3000` | Emulador do Android, que enxerga o Mac nesse endereço |
| `producao` | `https://triade-crm-tawny.vercel.app` | O app de verdade |

Sem a variável, o ambiente é `local`. Um app de teste nunca aponta para a produção por descuido. No ar, a casca só aceita https e só navega dentro das duas empresas.

## Rodar no simulador

O site local precisa estar de pé: Supabase local (`supabase start`) e `pnpm dev` na porta 3000. Dentro do app, o login de teste é o mesmo do navegador: `/auth/dev?quem=gestor`.

- **Android:** precisa do JDK 21 e do Android SDK 36 (command-line tools, emulador e uma imagem de sistema).

  ```bash
  TRIADE_APP_AMBIENTE=local-android pnpm -C apps/app android
  ```

- **iPhone:** precisa do Xcode 26 ou mais novo, com a plataforma iOS baixada. O app pede iOS 15 ou mais novo.

  ```bash
  pnpm -C apps/app ios
  ```

## Limites conhecidos desta primeira versão

- **Login com Google não funciona dentro da casca.** O Google recusa login dentro de WebView (`disallowed_useragent`). O login nativo com Google e Apple é a etapa 4. Até lá, no teste local, use `/auth/dev`.
- **Ícone e tela de abertura são os padrões do Capacitor.** Faltam os da marca.
- **A barra de status e a barra de baixo do aparelho** ainda precisam ser conferidas no simulador. O site já declara `viewport-fit=cover` e respeita a área segura de baixo.
- **Quem só tem acesso à Imova** entra pela KOMUNE e não consegue. A escolha da empresa no login vem com a etapa 4.

## As etapas

1. Proteção: a comparação tela a tela do PC e do celular antes de cada publicação do site.
2. Ajustes de tamanho, só dentro do app.
3. **Casca no simulador** (começada em 28/10/2026: a casca existe; falta rodar no simulador).
4. Login nativo com Google e Apple, com a escolha da empresa.
5. Push: mensagem nova, conversa transferida, compromisso marcado, lote para ligar, lembrete 30 min antes e resumo às 8h.
6. Teste com a equipe: TestFlight e teste fechado do Google Play.
7. Distribuição privada: Apple Business Manager e teste fechado.
