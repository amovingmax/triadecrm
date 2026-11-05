/**
 * De onde o app abre o Tríade, e o que ele deixa a casca fazer.
 *
 * O app é uma casca nativa (Expo) que abre o PRÓPRIO SITE: as mesmas telas, o
 * mesmo login, as mesmas permissões. Nada da versão do computador muda por causa dele
 * (decisão do usuário em 28/10/2026). Tudo que o app fizer de diferente no site entra
 * atrás da marca `TriadeApp/<versão>`, que a casca acrescenta ao user-agent: sem ela,
 * no navegador do PC ou do celular, o site segue exatamente como está.
 *
 * DOIS AMBIENTES, escolhidos por `TRIADE_APP_AMBIENTE` quando o Expo lê o
 * `app.config.ts`:
 *   · `local`    o site deste Mac, aberto pelo celular na mesma rede Wi-Fi. O app
 *                acha o Mac pelo endereço de onde o próprio Expo o serve (`hostUri`),
 *                e o site para o celular roda na porta 3100 (`pnpm -C apps/app site`);
 *   · `producao` o Tríade no ar.
 * Sem a variável é `local`: um app de teste nunca aponta para a produção por descuido.
 * Valor desconhecido é erro, nunca "cai" num ambiente em silêncio (como `empresaPorSlug`).
 *
 * Este arquivo não importa nada do React Native: roda igual no `app.config.ts`, na
 * casca e nos testes do Vitest.
 */

export type AmbienteDoApp = 'local' | 'producao';

const AMBIENTES: readonly AmbienteDoApp[] = ['local', 'producao'];

/**
 * O identificador do app nas lojas. Fixo para sempre depois do cadastro na App Store.
 * Neutro de empresa (decisão do usuário em 05/11/2026): o app serve à KOMUNE e à Imova.
 * Antes era `br.app.komune.triade`, registrado na conta Apple e nunca cadastrado.
 */
export const ID_DO_APP = 'app.triade.crm';

/** A versão da casca. Sobe junto com cada nova versão enviada às lojas. */
export const VERSAO_DA_CASCA = '0.1.0';

/** O que o site procura no user-agent para saber que está dentro do app. */
export const MARCA_DO_APP = 'TriadeApp';

/** O que a casca acrescenta ao user-agent do aparelho. */
export const MARCA_NO_USER_AGENT = `${MARCA_DO_APP}/${VERSAO_DA_CASCA}`;

/**
 * Os endereços no ar (memória "Endereços do CRM"). A troca de empresa é a mesma do site,
 * que navega para o endereço da outra; no login do app, a pessoa escolhe a empresa
 * antes de entrar, e o app abre na última em que entrou (`empresa.ts`).
 */
export const ENDERECOS = {
  komune: 'https://triade-crm-tawny.vercel.app',
  imova: 'https://imova-crm.vercel.app',
} as const;

/** O fundo escuro do Tríade (o `themeColor` do site), para a abertura não piscar branco. */
export const FUNDO = '#0f172a';

/**
 * As portas dos sites de teste para o celular (`scripts/site-na-rede.ts`), uma por
 * empresa, ligadas ao mesmo tempo para a troca de empresa funcionar como no ar. Não é
 * a 3000 porque o `next dev` de sempre continua lá, com o Supabase em 127.0.0.1, que o
 * celular não alcança. O app abre na última empresa usada (na primeira vez, a KOMUNE).
 */
export const PORTAS_NA_REDE = { komune: 3100, imova: 3101 } as const;

export function ambienteDoApp(valor: string | undefined | null): AmbienteDoApp {
  const chave = (valor ?? '').trim() || 'local';
  if (!(AMBIENTES as readonly string[]).includes(chave)) {
    throw new Error(`TRIADE_APP_AMBIENTE="${valor}" não existe. Use ${AMBIENTES.join(', ')}.`);
  }
  return chave as AmbienteDoApp;
}

/**
 * Esquema e host de um endereço, sem `new URL`: o `URL` do React Native não
 * implementa `host` em todas as versões, e esta conta precisa dar o mesmo resultado
 * no aparelho e no teste. A porta padrão (443 no https, 80 no http) some, como no
 * navegador; o que vem antes de `@` (usuário e senha) não é host.
 */
export function partesDoEndereco(endereco: string): { esquema: string; host: string } | null {
  const achado = /^([a-z][a-z0-9+.-]*):(?:\/\/([^/?#]*))?/i.exec(endereco.trim());
  if (!achado) return null;
  const esquema = achado[1]!.toLowerCase();
  let host = (achado[2] ?? '').split('@').pop()!.toLowerCase();
  if (
    (esquema === 'https' && host.endsWith(':443')) ||
    (esquema === 'http' && host.endsWith(':80'))
  ) {
    host = host.slice(0, host.lastIndexOf(':'));
  }
  return { esquema, host };
}

/**
 * O Mac, como o celular o enxerga: o mesmo endereço de onde o Expo serve o app
 * (`hostUri`, por exemplo "10.0.0.188:8081"). Sem ele (o simulador do iPhone, que
 * divide a rede com o Mac), é `localhost`.
 */
export function hostDoMac(hostUri: string | null | undefined): string {
  return (hostUri ?? '').split(':')[0]!.trim() || 'localhost';
}

export type RegrasDaCasca = {
  /** O endereço que a casca abre ao ligar. */
  inicio: string;
  /**
   * Para onde a casca deixa navegar sem sair para o navegador do aparelho: as duas
   * empresas e, no teste, os dois sites deste Mac. O login com Google NÃO entra aqui: o
   * Google recusa login dentro de WebView (`disallowed_useragent`). Ele acontece na
   * janela segura do iPhone (`entrada.ts`), e o site entrega o resultado à casca.
   */
  hosts: string[];
  /** No ar, só https. No teste, o site do Mac é http. */
  soHttps: boolean;
};

/** As empresas que o app abre. A primeira vez é sempre a KOMUNE. */
export type EmpresaDoApp = keyof typeof ENDERECOS;
export const EMPRESA_PADRAO: EmpresaDoApp = 'komune';

/** O endereço de cada empresa neste ambiente: no ar, o site; no teste, a porta no Mac. */
export function origensDasEmpresas(
  ambiente: AmbienteDoApp,
  hostUri?: string | null,
): Record<EmpresaDoApp, string> {
  if (ambiente === 'producao') return { ...ENDERECOS };
  const mac = hostDoMac(hostUri);
  return {
    komune: `http://${mac}:${PORTAS_NA_REDE.komune}`,
    imova: `http://${mac}:${PORTAS_NA_REDE.imova}`,
  };
}

/**
 * `empresa` é onde a casca abre: a última empresa em que a pessoa entrou de fato
 * (`empresa.ts`), ou a KOMUNE na primeira vez.
 */
export function regrasDaCasca(
  ambiente: AmbienteDoApp,
  hostUri?: string | null,
  empresa: EmpresaDoApp = EMPRESA_PADRAO,
): RegrasDaCasca {
  const empresas = Object.values(ENDERECOS).map((url) => partesDoEndereco(url)!.host);
  const inicio = origensDasEmpresas(ambiente, hostUri)[empresa];
  if (ambiente === 'producao') {
    return { inicio, hosts: empresas, soHttps: true };
  }
  const mac = hostDoMac(hostUri);
  const sites = Object.values(PORTAS_NA_REDE).map((porta) => `${mac}:${porta}`);
  return { inicio, hosts: [...empresas, ...sites], soHttps: false };
}
