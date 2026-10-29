import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/** O fundo da tela "Sem conexão" do protótipo aprovado (canvas de 22/10/2026). */
export const FUNDO_SEM_INTERNET = '#050505';

/**
 * A tela que a casca mostra quando o site não abre. É a "Sem conexão" do protótipo.
 * Mora no app porque, sem internet, é a única que dá para desenhar. Quando a conexão
 * volta, a casca abre o Tríade de novo sozinha (`casca.tsx`).
 *
 * `dica` só aparece no teste local: lá o mais comum é o site do Mac estar desligado,
 * e não a internet ter caído.
 */
export function SemInternet({
  aoTentar,
  dica,
  folgaInferior,
}: {
  aoTentar: () => void;
  dica?: string;
  folgaInferior: number;
}) {
  return (
    <View style={[estilos.tela, { paddingBottom: 24 + folgaInferior }]}>
      <View style={estilos.centro}>
        <View style={estilos.icone}>
          <Svg
            width={32}
            height={32}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f4f4f3"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <Path d="M12 20h.01" />
            <Path d="M8.5 16.429a5 5 0 0 1 7 0" />
            <Path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
            <Path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
            <Path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
            <Path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
            <Path d="m2 2 20 20" />
          </Svg>
        </View>
        <Text style={estilos.titulo}>Sem internet</Text>
        <Text style={estilos.texto}>
          Nada foi gravado enquanto a conexão caiu. Quando ela voltar, o Tríade abre de novo
          sozinho.
        </Text>
        {dica ? <Text style={estilos.dica}>{dica}</Text> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={aoTentar}
        style={({ pressed }) => [estilos.botao, pressed && estilos.botaoApertado]}
      >
        <Svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#111110"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <Path d="M21 3v5h-5" />
        </Svg>
        <Text style={estilos.rotulo}>Tentar de novo</Text>
      </Pressable>
    </View>
  );
}

const estilos = StyleSheet.create({
  // Por cima da WebView, que a biblioteca mantém montada embaixo.
  tela: {
    ...StyleSheet.absoluteFill,
    backgroundColor: FUNDO_SEM_INTERNET,
    paddingTop: 24,
    paddingHorizontal: 24,
  },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  icone: {
    width: 72,
    height: 72,
    borderRadius: 9999,
    backgroundColor: '#1c1c1c',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  titulo: {
    color: '#f4f4f3',
    fontSize: 26,
    lineHeight: 31,
    letterSpacing: -0.5,
  },
  texto: {
    maxWidth: 300,
    color: '#a3a3a2',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  dica: {
    maxWidth: 300,
    marginTop: 12,
    color: '#78fc90',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  botao: {
    height: 52,
    borderRadius: 9999,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  botaoApertado: {
    opacity: 0.85,
  },
  rotulo: {
    color: '#111110',
    fontSize: 16,
    fontWeight: '600',
  },
});
