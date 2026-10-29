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
  return {
    ...config,
    name: 'Tríade',
    slug: 'triade',
    version: VERSAO_DA_CASCA,
    // A casca é uma WebView: não existe versão de navegador do app (o navegador já tem o site).
    platforms: ['ios', 'android'],
    // "Só celular" (28/10/2026), mas deitado vale: está na auditoria de tamanhos.
    orientation: 'default',
    userInterfaceStyle: 'dark',
    backgroundColor: FUNDO,
    ios: {
      bundleIdentifier: ID_DO_APP,
      // No iPad o app abre no tamanho de iPhone, sem ajuste próprio.
      supportsTablet: false,
      infoPlist: {
        NSMicrophoneUsageDescription: 'O Tríade usa o microfone nas ligações feitas pelo app.',
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
      permissions: ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'],
    },
    extra: { ambiente },
  };
};
