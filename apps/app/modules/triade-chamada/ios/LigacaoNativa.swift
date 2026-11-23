import AVFoundation
import Foundation
import WebRTC

/// O áudio da ligação pelo WhatsApp, atendida na tela de chamada do iPhone (23/11/2026).
///
/// Tudo nativo, de propósito: no Expo 58 o React Native só sobe quando o app abre numa
/// tela (o ciclo de cenas do iOS), e a pessoa atende com o iPhone bloqueado e o app
/// fechado. Nesse caso nenhuma linha de JS roda; o áudio precisa subir assim mesmo.
///
/// O caminho é o do botão Atender do navegador (`apps/web/.../ligacao-whatsapp`), com o
/// convite do aviso no lugar da sessão (Edge Function `wa-chamada-app`):
///   1. `atender`: reserva a ligação e recebe a oferta SDP da Meta;
///   2. responde a oferta (WebRTC, sem STUN/TURN: a Meta é ICE-lite com endereço
///      público), com o microfone MUDO;
///   3. `pre_aceitar` sobe a conexão; `aceitar` atende. Só depois do 200 o microfone corre;
///   4. a cada 3 s pergunta o `estado`: o cliente desligou, a tela de chamada fecha.
///
/// Todo o estado mexe só na fila principal (as respostas do WebRTC e da rede voltam
/// para ela antes de tocar em qualquer coisa).
final class LigacaoNativa: NSObject, RTCPeerConnectionDelegate {
  enum Estado: String {
    case conectando
    case emCurso = "em_curso"
    case encerrada
    case falhou
  }

  struct Recusa: Error {
    let motivo: String
  }

  // Os mesmos prazos do navegador (`chamada.ts` no app, `webrtc.ts` no site).
  private static let coletaMaxima: TimeInterval = 2.5
  private static let conexaoAntesDeAtender: TimeInterval = 4.0
  private static let leituraDoEstado: TimeInterval = 3.0

  private static let fabrica: RTCPeerConnectionFactory = {
    RTCInitializeSSL()
    return RTCPeerConnectionFactory()
  }()

  let uuid: UUID
  let chamada: String
  let quem: String
  let caminho: String?
  let empresa: String?
  private let convite: String
  private let funcao: URL

  private(set) var estado: Estado = .conectando
  private(set) var atendidaEm: Date?
  private(set) var mudo = false
  private(set) var motivo: String?
  private var liberado = false
  private var reservou = false
  private var acabou = false
  /// A conexão caiu antes do aceite: o aceite não pode virar uma ligação muda.
  private var caiu = false

  private var pc: RTCPeerConnection?
  private var trilha: RTCAudioTrack?
  private var leitura: Timer?
  private var aoColetar: [() -> Void] = []
  private var aoConectar: [(Bool) -> Void] = []

  /// Toda mudança que a tela do app mostra.
  var aoMudar: ((LigacaoNativa) -> Void)?
  /// O fim que veio daqui (recusa, falha, o cliente desligou): a tela de chamada fecha
  /// com este motivo (`atendida`, `encerrada`, `falhou`).
  var aoTerminarPorAqui: ((LigacaoNativa, String) -> Void)?

  init?(uuid: UUID, dados: [String: Any]) {
    guard
      let convite = dados["convite"] as? String, !convite.isEmpty,
      let texto = dados["funcao"] as? String,
      let funcao = LigacaoNativa.funcaoConfiavel(texto)
    else { return nil }
    self.uuid = uuid
    self.chamada = uuid.uuidString.lowercased()
    self.quem = (dados["quem"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Cliente"
    self.caminho = dados["caminho"] as? String
    self.empresa = dados["empresa"] as? String
    self.convite = convite
    self.funcao = funcao
    super.init()
  }

  /// O endereço da função vem no aviso: no ar, só o Supabase em https (um aviso
  /// adulterado não manda o convite e o SDP para outro lugar). No app de teste, o do Mac.
  static func funcaoConfiavel(_ texto: String) -> URL? {
    guard let url = URL(string: texto), let host = url.host?.lowercased(),
          url.path == "/functions/v1/wa-chamada-app" else { return nil }
    #if DEBUG
      if url.scheme == "http" || url.scheme == "https" { return url }
    #endif
    let refDoProjeto = host.hasSuffix(".supabase.co")
      && host.dropLast(".supabase.co".count).range(of: "^[a-z0-9]{20}$", options: .regularExpression) != nil
    return url.scheme == "https" && refDoProjeto && url.port == nil ? url : nil
  }

  // MARK: - O que a tela de chamada pede

  func atender() {
    // Sem microfone, nem reserva: a ligação segue tocando para o resto da equipe (com o
    // iPhone bloqueado não há como perguntar; o app pede ao entrar na Imova).
    guard LigacaoNativa.microfoneLiberado() else {
      falhar("microfone")
      return
    }
    reservar(tentativa: 1)
  }

  private func reservar(tentativa: Int) {
    pedir("atender") { resultado in
      switch resultado {
      case .failure(let r) where r.motivo == "sem_internet":
        // A reserva pode ter sido gravada e a resposta se perdido: o servidor aceita o
        // mesmo convite de novo. Na segunda falha, devolve a ligação à equipe.
        if tentativa == 1 && !self.acabou {
          DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.reservar(tentativa: 2) }
        } else {
          self.pedir("soltar") { _ in }
          self.falhar("sem_internet")
        }
      case .failure(let r):
        self.falhar(r.motivo)
      case .success(let corpo):
        self.reservou = true
        if self.acabou {
          // Desligou enquanto a reserva ia e voltava: a ligação não fica presa.
          self.pedir("encerrar") { _ in }
          return
        }
        guard let oferta = corpo["oferta_sdp"] as? String, !oferta.isEmpty else {
          self.falhar("ja_atendida")
          return
        }
        self.responder(oferta)
      }
    }
  }

  /// Desligou no iPhone (ou na tela do app): encerra com o cliente.
  func desligar() {
    if acabou { return }
    if reservou { pedir("encerrar") { _ in } }
    fechar(.encerrada, motivo: nil)
  }

  func silenciar(_ novo: Bool) {
    mudo = novo
    trilha?.isEnabled = liberado && !mudo
    avisar()
  }

  /// O CallKit ativou o áudio da ligação: o WebRTC grava e toca a partir daqui.
  static func audioAtivo(_ sessao: AVAudioSession) {
    let rtc = RTCAudioSession.sharedInstance()
    rtc.audioSessionDidActivate(sessao)
    rtc.isAudioEnabled = true
  }

  static func audioInativo(_ sessao: AVAudioSession) {
    let rtc = RTCAudioSession.sharedInstance()
    rtc.audioSessionDidDeactivate(sessao)
    rtc.isAudioEnabled = false
  }

  /// Antes de o CallKit ativar o áudio: o WebRTC não abre a sessão por conta própria
  /// (quem abre é o CallKit), e a configuração é a de ligação (voz, com eco cancelado).
  static func prepararAudio() {
    let rtc = RTCAudioSession.sharedInstance()
    // `isAudioEnabled` fica com o didActivate/didDeactivate do CallKit: zerar aqui
    // deixaria muda uma segunda ligação atendida sem nova ativação.
    rtc.useManualAudio = true
    rtc.lockForConfiguration()
    try? rtc.setConfiguration(RTCAudioSessionConfiguration.webRTC())
    rtc.unlockForConfiguration()
  }

  // MARK: - O caminho do atender

  private func responder(_ oferta: String) {
    let configuracao = RTCConfiguration()
    configuracao.iceServers = []
    configuracao.sdpSemantics = .unifiedPlan
    configuracao.continualGatheringPolicy = .gatherOnce
    let restricoes = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
    guard let pc = LigacaoNativa.fabrica.peerConnection(with: configuracao, constraints: restricoes, delegate: self) else {
      falhar("conexao")
      return
    }
    self.pc = pc
    let fonte = LigacaoNativa.fabrica.audioSource(with: restricoes)
    let trilha = LigacaoNativa.fabrica.audioTrack(with: fonte, trackId: "triade-audio")
    // Mudo até o aceite: o cliente não ouve nada antes da hora.
    trilha.isEnabled = false
    self.trilha = trilha
    pc.add(trilha, streamIds: ["triade"])

    pc.setRemoteDescription(RTCSessionDescription(type: .offer, sdp: oferta)) { erro in
      DispatchQueue.main.async {
        if self.acabou { return }
        if erro != nil { self.falhar("conexao"); return }
        pc.answer(for: restricoes) { resposta, erro in
          DispatchQueue.main.async {
            if self.acabou { return }
            guard let resposta, erro == nil else { self.falhar("conexao"); return }
            pc.setLocalDescription(resposta) { erro in
              DispatchQueue.main.async {
                if self.acabou { return }
                if erro != nil { self.falhar("conexao"); return }
                self.esperarColeta { self.aceitar() }
              }
            }
          }
        }
      }
    }
  }

  private func aceitar() {
    guard let sdp = pc?.localDescription?.sdp, !acabou else {
      if !acabou { falhar("conexao") }
      return
    }
    // `pre_accept` sobe a conexão antes de atender; se falhar, o `accept` ainda tenta.
    pedir("pre_aceitar", sdp: sdp) { _ in
      self.esperarConectar { _ in
        if self.acabou { return }
        self.pedir("aceitar", sdp: sdp) { resultado in
          if self.acabou { return }
          switch resultado {
          case .failure(let r):
            self.falhar(r.motivo)
          case .success:
            // A conexão caiu antes do aceite: o navegador desliga nesse caso, e aqui também.
            if self.caiu || self.pc?.connectionState == .failed {
              self.falhar("conexao")
              return
            }
            self.liberado = true
            self.trilha?.isEnabled = !self.mudo
            self.estado = .emCurso
            self.atendidaEm = Date()
            self.avisar()
            self.acompanhar()
          }
        }
      }
    }
  }

  /// O cliente desligou? O webhook da Meta marca no banco; o app pergunta.
  private func acompanhar() {
    leitura?.invalidate()
    let timer = Timer(timeInterval: LigacaoNativa.leituraDoEstado, repeats: true) { [weak self] _ in
      guard let self, !self.acabou else { return }
      self.pedir("estado") { resultado in
        guard case .success(let corpo) = resultado, !self.acabou else { return }
        let estado = corpo["estado"] as? String
        let minha = corpo["minha"] as? Bool
        if minha == false || ["encerrada", "perdida", "recusada", "falhou"].contains(estado ?? "") {
          self.fechar(.encerrada, motivo: nil)
          self.aoTerminarPorAqui?(self, "encerrada")
        }
      }
    }
    RunLoop.main.add(timer, forMode: .common)
    leitura = timer
  }

  // MARK: - Fim

  private func falhar(_ motivo: String) {
    if acabou { return }
    if reservou {
      pedir("encerrar") { _ in }
    } else {
      // Sem reserva, a ligação segue para a equipe; o "recusar" evita que o "parar" de
      // depois faça a tela de chamada piscar de novo neste iPhone.
      pedir("recusar") { _ in }
    }
    fechar(.falhou, motivo: motivo)
    let naTela: String
    switch motivo {
    case "ja_atendida": naTela = "atendida"
    case "encerrada", "convite_invalido": naTela = "encerrada"
    default: naTela = "falhou"
    }
    aoTerminarPorAqui?(self, naTela)
  }

  /// O fim que veio de fora (um "parar" da Apple, o CallKit reiniciado).
  func terminarPorFora() {
    fechar(.encerrada, motivo: nil)
  }

  private func fechar(_ final: Estado, motivo: String?) {
    if acabou { return }
    acabou = true
    leitura?.invalidate()
    leitura = nil
    trilha?.isEnabled = false
    pc?.close()
    pc = nil
    trilha = nil
    estado = final
    self.motivo = motivo
    for f in aoColetar { f() }
    for f in aoConectar { f(false) }
    aoColetar.removeAll()
    aoConectar.removeAll()
    avisar()
  }

  private func avisar() {
    aoMudar?(self)
  }

  // MARK: - Esperas

  private func esperarColeta(_ depois: @escaping () -> Void) {
    if pc?.iceGatheringState == .complete {
      depois()
      return
    }
    var feito = false
    let uma = {
      if feito { return }
      feito = true
      depois()
    }
    aoColetar.append(uma)
    DispatchQueue.main.asyncAfter(deadline: .now() + LigacaoNativa.coletaMaxima) { uma() }
  }

  private func esperarConectar(_ depois: @escaping (Bool) -> Void) {
    if pc?.connectionState == .connected {
      depois(true)
      return
    }
    var feito = false
    let uma: (Bool) -> Void = { ok in
      if feito { return }
      feito = true
      depois(ok)
    }
    aoConectar.append(uma)
    DispatchQueue.main.asyncAfter(deadline: .now() + LigacaoNativa.conexaoAntesDeAtender) { uma(false) }
  }

  static func microfoneLiberado() -> Bool {
    if #available(iOS 17.0, *) {
      return AVAudioApplication.shared.recordPermission == .granted
    }
    return AVAudioSession.sharedInstance().recordPermission == .granted
  }

  // MARK: - O servidor

  private func pedir(
    _ acao: String,
    sdp: String? = nil,
    _ depois: @escaping (Result<[String: Any], Recusa>) -> Void
  ) {
    LigacaoNativa.pedirAoServidor(funcao: funcao, convite: convite, acao: acao, sdp: sdp, depois)
  }

  /// Um pedido à `wa-chamada-app` com o convite. A resposta volta na fila principal.
  static func pedirAoServidor(
    funcao: URL,
    convite: String,
    acao: String,
    sdp: String? = nil,
    _ depois: @escaping (Result<[String: Any], Recusa>) -> Void
  ) {
    var pedido = URLRequest(url: funcao, timeoutInterval: 12)
    pedido.httpMethod = "POST"
    pedido.setValue("application/json", forHTTPHeaderField: "Content-Type")
    var corpo: [String: Any] = ["acao": acao, "convite": convite]
    if let sdp { corpo["sdp"] = sdp }
    pedido.httpBody = try? JSONSerialization.data(withJSONObject: corpo)
    URLSession.shared.dataTask(with: pedido) { dados, resposta, erro in
      let status = (resposta as? HTTPURLResponse)?.statusCode ?? 0
      let json = dados.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
      let resultado: Result<[String: Any], Recusa>
      if erro != nil || status == 0 {
        resultado = .failure(Recusa(motivo: "sem_internet"))
      } else if !(200..<300).contains(status) || (json["ok"] as? Bool) == false {
        resultado = .failure(Recusa(motivo: (json["codigo"] as? String) ?? "falha"))
      } else {
        resultado = .success(json)
      }
      DispatchQueue.main.async { depois(resultado) }
    }.resume()
  }

  // MARK: - RTCPeerConnectionDelegate (vem na fila do WebRTC; tudo volta para a principal)

  func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
  func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}

  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
    guard newState == .complete else { return }
    DispatchQueue.main.async {
      let fila = self.aoColetar
      self.aoColetar.removeAll()
      for f in fila { f() }
    }
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
    DispatchQueue.main.async {
      if newState == .connected {
        let fila = self.aoConectar
        self.aoConectar.removeAll()
        for f in fila { f(true) }
      } else if newState == .failed {
        self.caiu = true
        let fila = self.aoConectar
        self.aoConectar.removeAll()
        for f in fila { f(false) }
        // A conexão caiu no meio da conversa: desliga com o cliente.
        if self.liberado && !self.acabou { self.falhar("conexao") }
      }
    }
  }
}
