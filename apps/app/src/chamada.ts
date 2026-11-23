/**
 * A ligação pelo WhatsApp na tela de chamada do iPhone (23/11/2026): o que a tela do app
 * mostra durante a ligação. Sem nada do React Native: roda igual nos testes.
 *
 * A ligação em si é toda nativa (`modules/triade-chamada/ios`): o aviso de voz da Apple
 * acorda o app, a tela de chamada do iPhone toca com o toque do telefone, e Atender
 * reserva a ligação com o convite do aviso (`wa-chamada-app`), responde a oferta da Meta
 * pelo WebRTC e só libera o microfone depois do aceite. O React Native nem sobe quando a
 * pessoa atende com o iPhone bloqueado; esta tela aparece quando o app está aberto.
 */

import type { LigacaoDoNativo } from '../modules/triade-chamada';

export type LinhaNoApp = LigacaoDoNativo & { altoFalante: boolean };

const FRASES: Record<string, string> = {
  ja_atendida: 'Outra pessoa da equipe já atendeu esta ligação.',
  encerrada: 'O cliente desligou antes.',
  convite_invalido: 'Esta ligação não pode mais ser atendida pelo celular.',
  sem_permissao: 'Seu perfil não atende ligações pelo CRM.',
  voce_ja_esta_em_ligacao: 'Você já está em outra ligação.',
  meta_recusou: 'O WhatsApp não completou a ligação.',
  microfone: 'O Tríade não tem acesso ao microfone. Libere em Ajustes do iPhone → Tríade → Microfone.',
  conexao: 'A conexão de áudio caiu. Confira a internet do celular.',
  sem_internet: 'Sem internet para atender a ligação.',
};

export function fraseDoMotivo(motivo: string | null | undefined): string {
  return (motivo && FRASES[motivo]) || 'A ligação não pôde ser atendida pelo celular.';
}

/** "0:07", "12:30", "1:02:03". */
export function relogio(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function rotuloDoEstado(linha: LigacaoDoNativo, agora: number): string {
  switch (linha.estado) {
    case 'conectando':
      return 'Conectando…';
    case 'em_curso':
      return linha.atendidaEm === null ? 'Em ligação' : relogio((agora - linha.atendidaEm) / 1000);
    case 'encerrada':
      return 'Ligação encerrada';
    case 'falhou':
      return 'Não deu certo';
  }
}

/** A frase de baixo, só quando a ligação não deu certo. */
export function avisoDaLinha(linha: LigacaoDoNativo): string | null {
  return linha.estado === 'falhou' ? fraseDoMotivo(linha.motivo) : null;
}

/** As iniciais do nome, para o círculo da tela (como no site). */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const primeira = partes[0]!.charAt(0);
  const ultima = partes.length > 1 ? partes[partes.length - 1]!.charAt(0) : '';
  return (primeira + ultima).toUpperCase();
}
