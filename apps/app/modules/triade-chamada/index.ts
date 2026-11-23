import { requireOptionalNativeModule, type EventSubscription } from 'expo';

/**
 * A tela de chamada do iPhone (CallKit), o aviso de voz da Apple (PushKit) e o áudio da
 * ligação (WebRTC), todos nativos: `ios/CentralDeChamadas.swift` e
 * `ios/LigacaoNativa.swift`. Atendendo com o iPhone bloqueado e o app fechado, o React
 * Native nem sobe; por isso o JS só desenha a tela do app durante a ligação
 * (`src/tela-de-chamada.tsx`) e entrega o endereço de chamada ao site.
 *
 * No Expo Go e no Android o módulo não existe: `chamadaNativa` é `null` e o app segue
 * como antes (o aviso comum "está ligando").
 */

/** A ligação atendida neste iPhone, como o nativo a conta (`corpoDaLigacao`). */
export type LigacaoDoNativo = {
  chamada: string;
  quem: string;
  estado: 'conectando' | 'em_curso' | 'encerrada' | 'falhou';
  /** Quando o aceite deu certo, em ms desde 1970. */
  atendidaEm: number | null;
  mudo: boolean;
  /** Por que não deu certo (`ja_atendida`, `microfone`, `conexao`...). */
  motivo: string | null;
  caminho: string | null;
  empresa: string | null;
  /** Quando o nativo contou isto (ms desde 1970). */
  em: number;
};

export type EventosDaChamada = {
  onTokenDeVoz: (e: { token: string }) => void;
  onTocando: (e: { chamada: string; quem: string | null }) => void;
  onRecusar: (e: { chamada: string }) => void;
  onFim: (e: { chamada: string; motivo: string }) => void;
  onEstado: (e: LigacaoDoNativo) => void;
};

type ModuloNativo = {
  iniciar(): Promise<void>;
  tokenDeVoz(): Promise<string | null>;
  servidorDeTeste(): boolean;
  ligacaoAtual(): Promise<LigacaoDoNativo | null>;
  encerrar(chamada: string): Promise<void>;
  silenciar(chamada: string, mudo: boolean): Promise<void>;
  altoFalante(ligado: boolean): Promise<void>;
  pedirMicrofone(): Promise<boolean>;
  addListener<K extends keyof EventosDaChamada>(evento: K, ouvinte: EventosDaChamada[K]): EventSubscription;
};

export const chamadaNativa = requireOptionalNativeModule<ModuloNativo>('TriadeChamada');
