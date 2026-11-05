// O Expo traduz este arquivo, mas não o que ele importa: o `tsx` registra a tradução
// de TypeScript para o `require` de `./src/ambiente` (o mesmo papel do `ts-node/register`
// da documentação do Expo).
import 'tsx/cjs';

import type { ConfigContext, ExpoConfig } from 'expo/config';

import { FUNDO, ID_DO_APP, VERSAO_DA_CASCA, ambienteDoApp } from './src/ambiente';

/**
 * A configuração do app. O Expo lê este arquivo a cada `expo start` e a cada build;
 * os projetos nativos (`ios/`, `android/`) nascem dele e não vão para o git.
 *
 * O ambiente vem de TRIADE_APP_AMBIENTE (local ou producao; ver src/ambiente.ts) e
 * chega à casca por `extra.ambiente`.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const ambiente = ambienteDoApp(process.env.TRIADE_APP_AMBIENTE);
  // A versão que vai para o TestFlight (montada na nuvem do Expo, que liga EAS_BUILD) só
  // abre o Tríade no ar: um app instalado procurando o site de um Mac não abriria nunca.
  if (process.env.EAS_BUILD === 'true' && ambiente !== 'producao') {
    throw new Error('A montagem na nuvem só sai com TRIADE_APP_AMBIENTE=producao (eas.json).');
  }
  return {
    ...config,
    name: 'Tríade',
    slug: 'triade',
    // A organização do Expo da KOMUNE, a mesma do app da Komune (projeto separado).
    owner: 'komune-app',
    version: VERSAO_DA_CASCA,
    // O endereço de volta do login com Google (`triade://auth`, ver `src/entrada.ts`). No
    // Expo Go a volta é o próprio projeto (`exp://`), e este esquema só vale no app instalado.
    scheme: 'triade',
    // A casca é uma WebView: não existe versão de navegador do app (o navegador já tem o site).
    platforms: ['ios', 'android'],
    // "Só celular" (28/10/2026), mas deitado vale: está na auditoria de tamanhos.
    orientation: 'default',
    userInterfaceStyle: 'dark',
    backgroundColor: FUNDO,
    // A logo do Tríade, o mesmo desenho do ícone do site (assets/*.svg; os PNGs saem de
    // `node scripts/gerar-icones.mjs`). No Expo Go aparece o ícone do Expo Go: o do
    // Tríade só existe no app instalado (TestFlight).
    icon: './assets/icone.png',
    ios: {
      bundleIdentifier: ID_DO_APP,
      // No iPad o app abre no tamanho de iPhone, sem ajuste próprio.
      supportsTablet: false,
      // O app só usa a criptografia padrão do iPhone (https): isenta. Sem isto, a Apple
      // pergunta a cada versão enviada ao TestFlight.
      config: { usesNonExemptEncryption: false },
      infoPlist: {
        NSMicrophoneUsageDescription:
          'O Tríade usa o microfone para gravar áudios e fazer ligações.',
        NSCameraUsageDescription: 'O Tríade usa a câmera para anexar fotos nas conversas.',
        NSPhotoLibraryUsageDescription: 'O Tríade abre suas fotos para anexar nas conversas.',
        // Só no teste: o site do Mac é http. No ar, o iPhone exige https (o padrão).
        ...(ambiente === 'local'
          ? {
              NSAppTransportSecurity: {
                NSAllowsLocalNetworking: true,
                NSAllowsArbitraryLoadsInWebContent: true,
              },
            }
          : {}),
      },
    },
    android: {
      package: ID_DO_APP,
      adaptiveIcon: { foregroundImage: './assets/icone-android.png', backgroundColor: FUNDO },
      permissions: ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'],
    },
    plugins: [
      // A abertura: a logo sobre o fundo escuro do site, para a troca para a WebView não
      // piscar outra cor.
      [
        'expo-splash-screen',
        {
          image: './assets/abertura.png',
          imageWidth: 112,
          resizeMode: 'contain',
          backgroundColor: FUNDO,
        },
      ],
    ],
    extra: { ambiente },
  };
};
