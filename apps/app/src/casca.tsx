import NetInfo from '@react-native-community/netinfo';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import { openAuthSessionAsync } from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewProps } from 'react-native-webview';

import { FUNDO, MARCA_NO_USER_AGENT, ambienteDoApp, regrasDaCasca } from './ambiente';
import { AVISAR_COR_DA_BARRA, corDaMensagem, estiloDaBarra } from './cor-da-barra';
import {
  enderecoDepoisDaJanela,
  enderecoDoInicio,
  lerDevolucao,
  origemDoInicio,
  voltaDoApp,
} from './entrada';
import { destinoDoEndereco } from './navegacao';
import { FUNDO_SEM_INTERNET, SemInternet } from './sem-internet';

// O react-native-webview 14 declara `WebView<P = undefined>`, e `WebViewProps &
// undefined` vira `never` no TypeScript 5.9: fixar P em `object` devolve os tipos.
const PaginaWeb = WebView<object>;

// O ambiente sai do `app.config.ts` (`extra.ambiente`); o Mac, do endereço do Expo.
const ambiente = ambienteDoApp(Constants.expoConfig?.extra?.ambiente as string | undefined);
const regras = regrasDaCasca(ambiente, Constants.expoConfig?.hostUri);
const ORIGEM = { uri: regras.inicio };
const DICA_DO_TESTE =
  ambiente === 'local'
    ? `O app procura o Tríade em ${regras.inicio}. O site para o celular está ligado? (pnpm -C apps/app site)`
    : undefined;
// Para onde o site devolve o login com Google (`entrada.ts`).
const VOLTA_DO_LOGIN = voltaDoApp(
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
  Constants.expoConfig?.hostUri,
);

function abrirNoAparelho(endereco: string) {
  // Sem app no aparelho para o endereço (um esquema desconhecido): não há o que fazer.
  Linking.openURL(endereco).catch(() => undefined);
}

/**
 * A casca: uma WebView do tamanho da tela com o próprio site dentro.
 *
 * O que ela faz, e nada além disso:
 *   · se identifica pelo user-agent (`TriadeApp/<versão>`);
 *   · só navega dentro das duas empresas; o resto vai para o aparelho (`navegacao.ts`);
 *   · abre o login com Google na janela segura do iPhone e entrega o resultado ao site
 *     (`entrada.ts`), porque o Google recusa login dentro da WebView;
 *   · pinta a faixa do relógio com a cor do tema do site (`cor-da-barra.ts`);
 *   · mostra "Sem internet" quando o site não abre e volta sozinha com a conexão;
 *   · no Android, o botão voltar volta uma página antes de sair do app.
 *
 * As bordas: em cima e dos lados (o recorte da câmera, deitado) a casca afasta o
 * site. Embaixo, no iPhone, o site vai até a borda e cuida da barrinha de início
 * sozinho (`env(safe-area-inset-bottom)`, já usado no navegador); no Android a
 * casca afasta, porque nem toda WebView do Android informa essa borda ao site.
 */
export function Casca() {
  return (
    <SafeAreaProvider>
      <Tela />
    </SafeAreaProvider>
  );
}

function Tela() {
  const bordas = useSafeAreaInsets();
  const webview = useRef<WebView<object>>(null);
  const podeVoltar = useRef(false);
  const [cor, setCor] = useState(FUNDO);
  const [semInternet, setSemInternet] = useState(false);
  // Trocar a chave monta uma WebView nova: é o que o Android pede quando o processo
  // da página morre.
  const [chave, setChave] = useState(0);

  // Com a tela "Sem internet" aberta, a volta da conexão recarrega o site. Só a
  // VOLTA conta: o NetInfo avisa o estado atual ao assinar, e isso não é volta.
  useEffect(() => {
    if (!semInternet) return;
    let estavaConectado: boolean | null = null;
    return NetInfo.addEventListener((estado) => {
      const conectado = estado.isConnected === true && estado.isInternetReachable !== false;
      if (estavaConectado === false && conectado) webview.current?.reload();
      estavaConectado = conectado;
    });
  }, [semInternet]);

  useEffect(() => {
    const assinatura = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!podeVoltar.current) return false;
      webview.current?.goBack();
      return true;
    });
    return () => assinatura.remove();
  }, []);

  // Uma janela segura por vez: um segundo toque em "Entrar com Google" com ela aberta
  // não abre outra.
  const entrando = useRef(false);

  async function entrarPelaJanela(origem: string) {
    if (entrando.current) return;
    entrando.current = true;
    try {
      const estado = randomUUID();
      const resultado = await openAuthSessionAsync(
        enderecoDoInicio(origem, estado, VOLTA_DO_LOGIN),
        VOLTA_DO_LOGIN,
        // Sem guardar cookie no Safari: o login vale só para o app, e o iPhone dispensa
        // a pergunta "quer usar google.com para entrar?".
        { preferEphemeralSession: true },
      );
      // Fechou sem entrar: a tela de login continua onde estava.
      if (resultado.type !== 'success') return;
      const destino = enderecoDepoisDaJanela(origem, lerDevolucao(resultado.url, estado));
      webview.current?.injectJavaScript(
        `window.location.replace(${JSON.stringify(destino)});true;`,
      );
    } finally {
      entrando.current = false;
    }
  }

  const aoNavegar: WebViewProps['onShouldStartLoadWithRequest'] = (pedido) => {
    // Iframes do site (um mapa, um vídeo) carregam dentro do próprio quadro.
    if (pedido.isTopFrame === false) return true;
    const origemDoLogin = origemDoInicio(pedido.url, regras);
    if (origemDoLogin) {
      void entrarPelaJanela(origemDoLogin);
      return false;
    }
    const destino = destinoDoEndereco(pedido.url, regras);
    if (destino === 'fora') abrirNoAparelho(pedido.url);
    return destino === 'app';
  };

  // `target="_blank"` e `window.open`: o que é da casa abre aqui mesmo (uma aba nova
  // no Safari perderia o login); o resto vai para o aparelho.
  const aoAbrirJanela: WebViewProps['onOpenWindow'] = ({ nativeEvent }) => {
    const destino = destinoDoEndereco(nativeEvent.targetUrl, regras);
    if (destino === 'app') {
      webview.current?.injectJavaScript(
        `window.location.assign(${JSON.stringify(nativeEvent.targetUrl)});true;`,
      );
    } else if (destino === 'fora') {
      abrirNoAparelho(nativeEvent.targetUrl);
    }
  };

  const faixa = semInternet ? FUNDO_SEM_INTERNET : cor;
  const folgaInferior = Platform.OS === 'ios' ? bordas.bottom : 0;

  return (
    <View
      style={[
        estilos.raiz,
        {
          backgroundColor: faixa,
          paddingTop: bordas.top,
          paddingLeft: bordas.left,
          paddingRight: bordas.right,
          paddingBottom: Platform.OS === 'android' ? bordas.bottom : 0,
        },
      ]}
    >
      <StatusBar barStyle={estiloDaBarra(faixa)} />
      <PaginaWeb
        key={chave}
        ref={webview}
        source={ORIGEM}
        style={{ backgroundColor: cor }}
        applicationNameForUserAgent={MARCA_NO_USER_AGENT}
        // Tudo passa por `aoNavegar`, que decide entre app, aparelho e nada.
        originWhitelist={['*']}
        onShouldStartLoadWithRequest={aoNavegar}
        onOpenWindow={aoAbrirJanela}
        javaScriptCanOpenWindowsAutomatically
        injectedJavaScript={AVISAR_COR_DA_BARRA}
        onMessage={({ nativeEvent }) => {
          const nova = corDaMensagem(nativeEvent.data);
          if (nova) setCor(nova);
        }}
        onNavigationStateChange={(estado) => {
          podeVoltar.current = estado.canGoBack;
        }}
        onLoad={() => setSemInternet(false)}
        onError={() => setSemInternet(true)}
        renderError={() => (
          <SemInternet
            aoTentar={() => webview.current?.reload()}
            dica={DICA_DO_TESTE}
            folgaInferior={folgaInferior}
          />
        )}
        renderLoading={() => (
          <View style={[estilos.carregando, { backgroundColor: faixa }]}>
            <ActivityIndicator color={estiloDaBarra(faixa) === 'light-content' ? '#fff' : '#000'} />
          </View>
        )}
        // O iPhone encerra a página quando falta memória com o app em segundo plano;
        // sem isto, a volta ao app mostra uma tela vazia.
        onContentProcessDidTerminate={() => webview.current?.reload()}
        onRenderProcessGone={() => setChave((c) => c + 1)}
        // Ligações (Twilio) e áudios: o microfone vale para o próprio site sem
        // perguntar de novo a cada ligação; o aparelho pergunta uma vez.
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // Gesto de voltar pela borda, como num app do iPhone.
        allowsBackForwardNavigationGestures
        // Rolagem com o peso do iPhone, e sem a página inteira "quicar" nas pontas.
        decelerationRate="normal"
        bounces={false}
        overScrollMode="never"
        // As bordas são da casca (acima); a WebView não soma outra folga por conta própria.
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        // No teste, o Safari do Mac inspeciona a página (Desenvolvedor → iPhone).
        webviewDebuggingEnabled={__DEV__}
      />
    </View>
  );
}

const estilos = StyleSheet.create({
  raiz: {
    flex: 1,
  },
  carregando: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
