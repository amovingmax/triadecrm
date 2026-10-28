import type { CapacitorConfig } from '@capacitor/cli';

/**
 * De onde o app abre o Tríade, e o que ele deixa a casca fazer.
 *
 * O app é uma casca nativa (Capacitor) que abre o PRÓPRIO SITE: as mesmas telas, o
 * mesmo login, as mesmas permissões. Nada da versão do computador muda por causa dele
 * (decisão do usuário em 28/10/2026). Tudo que o app fizer de diferente no site entra
 * atrás da marca `TriadeApp/<versão>`, que a casca acrescenta ao user-agent: sem ela,
 * no navegador do PC ou do celular, o site segue exatamente como está.
 *
 * TRÊS AMBIENTES, escolhidos por `TRIADE_APP_AMBIENTE`:
 *   · `local`         o `next dev` deste Mac, visto pelo simulador do iPhone;
 *   · `local-android` o mesmo servidor, visto pelo emulador do Android, que enxerga o
 *                     Mac em 10.0.2.2, e não em localhost;
 *   · `producao`      o Tríade no ar.
 * Sem a variável é `local`: um app de teste nunca aponta para a produção por descuido.
 * Valor desconhecido é erro, nunca "cai" num ambiente em silêncio (como `empresaPorSlug`).
 */

export type AmbienteDoApp = 'local' | 'local-android' | 'producao';

const AMBIENTES: readonly AmbienteDoApp[] = ['local', 'local-android', 'producao'];

/** O identificador do app nas lojas. Fixo para sempre depois da primeira publicação. */
export const ID_DO_APP = 'br.app.komune.triade';

/** A versão da casca. Sobe junto com cada nova versão enviada às lojas. */
export const VERSAO_DA_CASCA = '0.1.0';

/** O que o site procura no user-agent para saber que está dentro do app. */
export const MARCA_DO_APP = 'TriadeApp';

/**
 * Os endereços no ar (memória "Endereços do CRM"). A KOMUNE é a porta de entrada; a
 * troca para a Imova é a mesma do site, que navega para o endereço dela.
 */
export const ENDERECOS = {
  komune: 'https://triade-crm-tawny.vercel.app',
  imova: 'https://imova-crm.vercel.app',
} as const;

/** O fundo escuro do Tríade (o `themeColor` do site), para a abertura não piscar branco. */
const FUNDO = '#0f172a';

export function ambienteDoApp(valor: string | undefined | null): AmbienteDoApp {
  const chave = (valor ?? '').trim() || 'local';
  if (!(AMBIENTES as readonly string[]).includes(chave)) {
    throw new Error(`TRIADE_APP_AMBIENTE="${valor}" não existe. Use ${AMBIENTES.join(', ')}.`);
  }
  return chave as AmbienteDoApp;
}

/** O endereço que a casca abre ao ligar. */
export function enderecoInicial(ambiente: AmbienteDoApp): string {
  switch (ambiente) {
    case 'local':
      return 'http://localhost:3000';
    case 'local-android':
      return 'http://10.0.2.2:3000';
    case 'producao':
      return ENDERECOS.komune;
  }
}

/**
 * Para onde a casca deixa navegar sem sair para o navegador do aparelho: as duas
 * empresas e, no teste, o servidor deste Mac. O login com Google NÃO entra aqui: o
 * Google recusa login dentro de WebView (`disallowed_useragent`), e o login do app
 * vai ser nativo (etapa 4 do plano, `docs/operacao/app-celular.md`).
 */
export function hostsPermitidos(ambiente: AmbienteDoApp): string[] {
  const empresas = Object.values(ENDERECOS).map((url) => new URL(url).host);
  if (ambiente === 'producao') return empresas;
  return [...empresas, new URL(enderecoInicial(ambiente)).host];
}

export function montarConfig(ambiente: AmbienteDoApp): CapacitorConfig {
  return {
    appId: ID_DO_APP,
    appName: 'Tríade',
    // Só a tela de "sem conexão" e a de abertura moram no app; o resto é o site.
    webDir: 'www',
    backgroundColor: FUNDO,
    appendUserAgent: `${MARCA_DO_APP}/${VERSAO_DA_CASCA}`,
    server: {
      url: enderecoInicial(ambiente),
      // http só no teste, contra o `next dev` deste Mac. No ar, só https.
      cleartext: ambiente !== 'producao',
      allowNavigation: hostsPermitidos(ambiente),
      errorPath: 'erro.html',
    },
    android: {
      allowMixedContent: false,
    },
  };
}
