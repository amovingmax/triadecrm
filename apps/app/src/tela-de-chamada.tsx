import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { avisoDaLinha, iniciais, rotuloDoEstado } from './chamada';
import {
  alternarAltoFalante,
  alternarMudo,
  desligar,
  fecharAviso,
  useLinhaDaChamada,
} from './chamada-nativa';

// As cores do escuro da Imova (o CRM: `.dark[data-empresa='imova']` em globals.css):
// a ligação pelo WhatsApp só toca na Imova. Protótipo aprovado: artifact "Ligação no iPhone".
const FUNDO = '#0b1918';
const TEXTO = '#e6f0ee';
const APAGADO = '#9db4b0';
const BOTAO = '#1c3734';
const BORDA = '#24423e';
const BOTAO_LIGADO = '#e6f0ee';
const PETROLEO = '#4fb3ab';
const TINTA_DO_PETROLEO = '#062220';
const VERMELHO = '#dc3c3c';

/**
 * A ligação pelo WhatsApp com o app aberto (23/11/2026). Com o iPhone bloqueado quem
 * aparece é a tela de chamada do próprio iPhone; aberto o app, esta, por cima do CRM,
 * como a do WhatsApp: o nome, o tempo, Mudo, Alto-falante e Desligar. "Ver conversa"
 * fecha a tela e abre a conversa do cliente no CRM, com a ligação seguindo (a barra
 * verde do iPhone volta para cá).
 */
export function TelaDeChamada({
  folgaSuperior,
  folgaInferior,
  abrirConversa,
}: {
  folgaSuperior: number;
  folgaInferior: number;
  abrirConversa: (empresa: string | null, caminho: string) => void;
}) {
  const linha = useLinhaDaChamada();
  const [agora, setAgora] = useState(Date.now());
  const [escondida, setEscondida] = useState<string | null>(null);

  const viva = linha !== null && (linha.estado === 'conectando' || linha.estado === 'em_curso');
  useEffect(() => {
    if (!viva) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [viva]);

  // Acabou: a tela sai sozinha (com o porquê na tela, um pouco mais devagar).
  const fim = linha && !viva ? linha.estado : null;
  useEffect(() => {
    if (!fim) return;
    const id = setTimeout(fecharAviso, fim === 'falhou' ? 6000 : 3000);
    return () => clearTimeout(id);
  }, [fim]);

  if (!linha) return null;
  // "Ver conversa" esconde a tela desta ligação; a próxima volta a aparecer.
  if (escondida === linha.chamada && viva) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Voltar para a ligação"
        onPress={() => setEscondida(null)}
        style={[estilos.faixa, { top: folgaSuperior }]}
      >
        <Text style={estilos.faixaTexto}>
          {linha.quem} · {rotuloDoEstado(linha, agora)} · toque para voltar
        </Text>
      </Pressable>
    );
  }

  return (
    <View
      style={[estilos.tela, { paddingTop: folgaSuperior + 48, paddingBottom: folgaInferior + 40 }]}
      accessibilityViewIsModal
    >
      <View style={estilos.topo}>
        <View style={estilos.circulo}>
          <Text style={estilos.iniciais}>{iniciais(linha.quem)}</Text>
        </View>
        <Text style={estilos.nome} numberOfLines={2}>
          {linha.quem}
        </Text>
        <Text style={estilos.subtitulo}>Ligação pelo WhatsApp · Imova</Text>
        <Text style={estilos.estado} accessibilityLiveRegion="polite">
          {rotuloDoEstado(linha, agora)}
        </Text>
        {avisoDaLinha(linha) ? <Text style={estilos.aviso}>{avisoDaLinha(linha)}</Text> : null}
      </View>

      {viva ? (
        <View style={estilos.botoes}>
          <BotaoRedondo
            rotulo={linha.mudo ? 'Ativar som' : 'Mudo'}
            ligado={linha.mudo}
            onPress={alternarMudo}
            desligado={linha.estado !== 'em_curso'}
            icone={
              linha.mudo ? (
                <>
                  <Path d="m2 2 20 20" />
                  <Path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
                  <Path d="M5 10v2a7 7 0 0 0 12 5" />
                  <Path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
                  <Path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
                  <Path d="M12 19v3" />
                </>
              ) : (
                <>
                  <Path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <Path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <Path d="M12 19v3" />
                </>
              )
            }
          />
          <BotaoRedondo
            rotulo="Alto-falante"
            ligado={linha.altoFalante}
            onPress={alternarAltoFalante}
            icone={
              <>
                <Path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
                <Path d="M16 9a5 5 0 0 1 0 6" />
                <Path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
              </>
            }
          />
          {linha.caminho ? (
            <BotaoRedondo
              rotulo="Ver conversa"
              ligado={false}
              onPress={() => {
                setEscondida(linha.chamada);
                abrirConversa(linha.empresa, linha.caminho!);
              }}
              icone={<Path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />}
            />
          ) : null}
        </View>
      ) : null}

      {viva ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Desligar"
          onPress={desligar}
          style={({ pressed }) => [estilos.desligar, pressed && estilos.apertado]}
        >
          <Svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272" />
            <Path d="M22 2 2 22" />
            <Path d="M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473" />
          </Svg>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={fecharAviso}
          style={({ pressed }) => [estilos.fechar, pressed && estilos.apertado]}
        >
          <Text style={estilos.fecharTexto}>Fechar</Text>
        </Pressable>
      )}
    </View>
  );
}

function BotaoRedondo({
  rotulo,
  ligado,
  desligado = false,
  onPress,
  icone,
}: {
  rotulo: string;
  ligado: boolean;
  desligado?: boolean;
  onPress: () => void;
  icone: React.ReactNode;
}) {
  return (
    <View style={estilos.itemDoBotao}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={rotulo}
        accessibilityState={{ selected: ligado, disabled: desligado }}
        disabled={desligado}
        onPress={onPress}
        style={({ pressed }) => [
          estilos.redondo,
          ligado && estilos.redondoLigado,
          (pressed || desligado) && estilos.apertado,
        ]}
      >
        <Svg
          width={26}
          height={26}
          viewBox="0 0 24 24"
          fill="none"
          stroke={ligado ? FUNDO : TEXTO}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icone}
        </Svg>
      </Pressable>
      <Text style={estilos.rotulo}>{rotulo}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  tela: {
    ...StyleSheet.absoluteFill,
    backgroundColor: FUNDO,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topo: { alignItems: 'center', gap: 8, maxWidth: 340 },
  circulo: {
    width: 120,
    height: 120,
    borderRadius: 9999,
    backgroundColor: PETROLEO,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  iniciais: { color: TINTA_DO_PETROLEO, fontSize: 44, fontWeight: '700' },
  nome: { color: TEXTO, fontSize: 34, lineHeight: 40, fontWeight: '600', letterSpacing: -0.5, textAlign: 'center' },
  subtitulo: { color: APAGADO, fontSize: 15 },
  estado: { color: TEXTO, fontSize: 20, fontWeight: '500', marginTop: 4, fontVariant: ['tabular-nums'] },
  aviso: {
    color: '#ffcf9e',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(247,146,58,0.12)',
  },
  botoes: { flexDirection: 'row', gap: 20, justifyContent: 'center' },
  itemDoBotao: { alignItems: 'center', gap: 8, width: 76 },
  redondo: {
    width: 72,
    height: 72,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: BORDA,
    backgroundColor: BOTAO,
    alignItems: 'center',
    justifyContent: 'center',
  },
  redondoLigado: { backgroundColor: BOTAO_LIGADO },
  rotulo: { color: APAGADO, fontSize: 13, textAlign: 'center' },
  desligar: {
    width: 78,
    height: 78,
    borderRadius: 9999,
    backgroundColor: VERMELHO,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fechar: {
    minWidth: 220,
    height: 54,
    borderRadius: 14,
    backgroundColor: PETROLEO,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  fecharTexto: { color: TINTA_DO_PETROLEO, fontSize: 16, fontWeight: '600' },
  apertado: { opacity: 0.6 },
  faixa: {
    position: 'absolute',
    left: 12,
    right: 12,
    minHeight: 44,
    borderRadius: 9999,
    backgroundColor: PETROLEO,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  faixaTexto: { color: TINTA_DO_PETROLEO, fontSize: 14, fontWeight: '600' },
});
