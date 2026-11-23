import AVFoundation
import CallKit
import PushKit
import UIKit

/// A ligação pelo WhatsApp na tela de chamada do iPhone (23/11/2026).
///
/// O banco da Imova manda o aviso de VOZ da Apple (PushKit) quando um cliente liga
/// (Edge Function `voip-push`). O iPhone acorda o app, mesmo fechado, e ele precisa
/// mostrar a tela de chamada (CallKit) ANTES de terminar de tratar o aviso: a Apple
/// encerra o app que recebe aviso de voz sem mostrar chamada, e para de mandar avisos a
/// quem repete. O áudio também é nativo (`LigacaoNativa`): atendendo com o iPhone
/// bloqueado, o React Native nem sobe. O JS (`src/chamada-nativa.ts`) só desenha a tela
/// do app durante a ligação, quando o app está aberto.
///
/// O aviso traz `{ "triade": { "evento": "tocar" | "parar", "chamada": <uuid>, ... } }`
/// (`supabase/functions/_compartilhado/apns.ts`). O id da ligação no banco é o mesmo
/// UUID da chamada no CallKit: o "parar" acha a chamada que tocou.
///
/// Todo o estado daqui mexe só na fila principal: o PushKit e o CallKit chamam nela, e o
/// que vem de outra fila (o JS, a rede) passa para ela antes.
final class CentralDeChamadas: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
  static let shared = CentralDeChamadas()

  /// O CallKit não desiste sozinho de uma chamada tocando; a Meta dá de 30 a 60 s.
  private static let toqueMaximo: TimeInterval = 60
  /// Tocando, o app pergunta se a ligação continua: um "parar" perdido não deixa tocar.
  private static let leituraTocando: TimeInterval = 3

  private var registro: PKPushRegistry?
  private let provedor: CXProvider
  private let controle = CXCallController()

  /// O endereço de chamada deste aparelho, em hexadecimal, para o site gravar.
  private(set) var tokenDeVoz: String?
  /// As chamadas que este app mostrou e ainda não acabaram, com os dados do aviso.
  private var chamadas: [UUID: [String: Any]] = [:]
  /// As que a pessoa atendeu: um "parar" atrasado não derruba a conversa.
  private var atendidas: Set<UUID> = []
  /// Os relógios de cada chamada tocando (o prazo e a consulta ao servidor).
  private var vigias: [UUID: Timer] = [:]
  /// A ligação atendida neste iPhone (uma por vez, como no navegador).
  private var ligacao: LigacaoNativa?

  /// Os eventos para o JS. Guardados até alguém ouvir: o app pode abrir no meio da ligação.
  private var fila: [(String, [String: Any?])] = []
  private var entregar: ((String, [String: Any?]) -> Void)?

  private override init() {
    let configuracao = CXProviderConfiguration()
    configuracao.supportsVideo = false
    configuracao.maximumCallGroups = 1
    configuracao.maximumCallsPerCallGroup = 1
    configuracao.supportedHandleTypes = [.generic]
    // Sem a ligação nas Recentes do Telefone: tocar ali tentaria ligar pelo app, e a
    // ligação para o cliente sai pelo CRM, com a permissão dele.
    configuracao.includesCallsInRecents = false
    // Sem `ringtoneSound`: toca o toque do próprio iPhone, no volume da campainha, como
    // as ligações do WhatsApp. No modo silencioso, vibra.
    provedor = CXProvider(configuration: configuracao)
    super.init()
    provedor.setDelegate(self, queue: nil)
  }

  /// Na abertura do app (`TriadeChamadaAppDelegate`), antes de qualquer tela: o aviso de
  /// voz que acordou o app só é entregue depois que o registro existe.
  func iniciar() {
    if registro != nil { return }
    let r = PKPushRegistry(queue: .main)
    r.delegate = self
    r.desiredPushTypes = [.voIP]
    registro = r
  }

  // MARK: - O JS

  func comecarAEntregar(_ entrega: @escaping (String, [String: Any?]) -> Void) {
    entregar = entrega
    let pendentes = fila
    fila.removeAll()
    for (nome, corpo) in pendentes { entrega(nome, corpo) }
  }

  func pararDeEntregar() {
    entregar = nil
  }

  private func emitir(_ nome: String, _ corpo: [String: Any?]) {
    if let entregar {
      entregar(nome, corpo)
    } else {
      // Fila curta: só o que importa para a ligação de agora.
      if fila.count >= 20 { fila.removeFirst() }
      fila.append((nome, corpo))
    }
  }

  /// A ligação atendida e ainda viva, para o JS que chega depois (o app abriu no meio dela).
  func ligacaoAtual() -> [String: Any?]? {
    guard let ligacao, ligacao.estado == .conectando || ligacao.estado == .emCurso else { return nil }
    return corpoDaLigacao(ligacao)
  }

  // MARK: - O que o JS pede

  /// A pessoa desligou na tela do app: passa pelo CallKit, que fecha a tela de chamada.
  func encerrar(_ chamada: String) {
    guard let uuid = UUID(uuidString: chamada) else { return }
    controle.request(CXTransaction(action: CXEndCallAction(call: uuid))) { erro in
      if erro != nil {
        // O CallKit já não conhecia a chamada: desliga direto.
        DispatchQueue.main.async {
          if self.ligacao?.uuid == uuid { self.ligacao?.desligar() }
          self.esquecer(uuid)
        }
      }
    }
  }

  func silenciar(_ chamada: String, _ mudo: Bool) {
    guard let uuid = UUID(uuidString: chamada) else { return }
    controle.request(CXTransaction(action: CXSetMutedCallAction(call: uuid, muted: mudo))) { _ in }
  }

  func altoFalante(_ ligado: Bool) {
    try? AVAudioSession.sharedInstance().overrideOutputAudioPort(ligado ? .speaker : .none)
  }

  /// O microfone pedido com o app aberto: com o iPhone bloqueado, o iPhone não consegue
  /// perguntar na hora de atender.
  func pedirMicrofone(_ depois: @escaping (Bool) -> Void) {
    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission { ok in DispatchQueue.main.async { depois(ok) } }
    } else {
      AVAudioSession.sharedInstance().requestRecordPermission { ok in DispatchQueue.main.async { depois(ok) } }
    }
  }

  // MARK: - PushKit

  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    tokenDeVoz = token
    emitir("onTokenDeVoz", ["token": token])
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    tokenDeVoz = nil
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    let dados = (payload.dictionaryPayload["triade"] as? [String: Any]) ?? [:]
    let evento = dados["evento"] as? String
    // Sem id válido, um id qualquer: a tela de chamada tem de aparecer de todo jeito.
    let uuid = (dados["chamada"] as? String).flatMap { UUID(uuidString: $0) } ?? UUID()

    if evento == "tocar" {
      let quem = (dados["quem"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Cliente"
      let empresa = (dados["empresa_nome"] as? String) ?? "Imova"
      let atualizacao = CXCallUpdate()
      atualizacao.remoteHandle = CXHandle(type: .generic, value: empresa)
      atualizacao.localizedCallerName = quem
      atualizacao.hasVideo = false
      atualizacao.supportsHolding = false
      atualizacao.supportsGrouping = false
      atualizacao.supportsUngrouping = false
      atualizacao.supportsDTMF = false
      let jaTocava = chamadas[uuid] != nil
      chamadas[uuid] = dados
      provedor.reportNewIncomingCall(with: uuid, update: atualizacao) { erro in
        DispatchQueue.main.async {
          if erro != nil {
            // "Não perturbe", bloqueio do iPhone ou a mesma chamada de novo: não toca.
            if !jaTocava { self.chamadas[uuid] = nil }
          } else {
            self.vigiar(uuid, dados)
            self.emitir("onTocando", self.corpoDaChamada(uuid, dados))
          }
          completion()
        }
      }
      return
    }

    // "parar" (ou um aviso que não é nosso). A Apple exige uma chamada para todo aviso de
    // voz: a mesma chamada de novo (o CallKit diz que já existe) ou uma que já nasce
    // encerrada, quando o app acordou agora só para o "parar".
    let motivo = (dados["motivo"] as? String) ?? "encerrada"
    let atualizacao = CXCallUpdate()
    atualizacao.remoteHandle = CXHandle(type: .generic, value: "Imova")
    atualizacao.localizedCallerName = "Ligação encerrada"
    provedor.reportNewIncomingCall(with: uuid, update: atualizacao) { erro in
      DispatchQueue.main.async {
        if erro == nil {
          self.provedor.reportCall(with: uuid, endedAt: Date(), reason: self.razao(motivo))
        } else if self.chamadas[uuid] != nil && !self.atendidas.contains(uuid) {
          // Ainda tocando aqui: para, com o motivo certo na tela.
          self.pararDeTocar(uuid, motivo)
        }
        completion()
      }
    }
  }

  // MARK: - Tocando: o prazo e a consulta

  /// Um "parar" perdido (rede, a função fora do ar) não deixa o iPhone tocando: a cada
  /// 3 s o app pergunta ao servidor, com o convite, se a ligação ainda toca; e em 60 s
  /// desiste sozinho, como a Meta.
  private func vigiar(_ uuid: UUID, _ dados: [String: Any]) {
    vigias[uuid]?.invalidate()
    let inicio = Date()
    let convite = dados["convite"] as? String
    let funcao = (dados["funcao"] as? String).flatMap(LigacaoNativa.funcaoConfiavel)
    var perguntando = false
    let timer = Timer(timeInterval: CentralDeChamadas.leituraTocando, repeats: true) { [weak self] _ in
      guard let self, self.chamadas[uuid] != nil, !self.atendidas.contains(uuid) else {
        self?.vigias[uuid]?.invalidate()
        self?.vigias[uuid] = nil
        return
      }
      if Date().timeIntervalSince(inicio) >= CentralDeChamadas.toqueMaximo {
        self.pararDeTocar(uuid, "perdida")
        return
      }
      guard let convite, let funcao, !perguntando else { return }
      perguntando = true
      LigacaoNativa.pedirAoServidor(funcao: funcao, convite: convite, acao: "estado") { resultado in
        perguntando = false
        guard case .success(let corpo) = resultado,
              self.chamadas[uuid] != nil, !self.atendidas.contains(uuid) else { return }
        let estado = corpo["estado"] as? String
        if estado != nil && estado != "tocando" {
          let motivo: String
          switch estado {
          case "atendendo", "em_curso": motivo = "atendida"
          case "perdida": motivo = "perdida"
          default: motivo = "encerrada"
          }
          self.pararDeTocar(uuid, motivo)
        }
      }
    }
    RunLoop.main.add(timer, forMode: .common)
    vigias[uuid] = timer
  }

  private func pararDeTocar(_ uuid: UUID, _ motivo: String) {
    provedor.reportCall(with: uuid, endedAt: Date(), reason: razao(motivo))
    esquecer(uuid)
    emitir("onFim", ["chamada": uuid.uuidString.lowercased(), "motivo": motivo])
  }

  // MARK: - CallKit

  func providerDidReset(_ provider: CXProvider) {
    // O sistema derrubou as chamadas: a da Meta também acaba (ela cobra a ligação aberta).
    ligacao?.desligar()
    for uuid in chamadas.keys {
      emitir("onFim", ["chamada": uuid.uuidString.lowercased(), "motivo": "reiniciada"])
    }
    for timer in vigias.values { timer.invalidate() }
    vigias.removeAll()
    chamadas.removeAll()
    atendidas.removeAll()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    let uuid = action.callUUID
    let livre = ligacao == nil || ligacao?.estado == .encerrada || ligacao?.estado == .falhou
    guard livre, let dados = chamadas[uuid], let nova = LigacaoNativa(uuid: uuid, dados: dados) else {
      // Outra ligação em curso, a chamada já esquecida ou um aviso sem convite válido.
      action.fail()
      provedor.reportCall(with: uuid, endedAt: Date(), reason: .failed)
      esquecer(uuid)
      return
    }
    atendidas.insert(uuid)
    vigias[uuid]?.invalidate()
    vigias[uuid] = nil
    nova.aoMudar = { [weak self] l in
      guard let self else { return }
      self.emitir("onEstado", self.corpoDaLigacao(l))
      if (l.estado == .encerrada || l.estado == .falhou) && self.ligacao === l {
        self.ligacao = nil
      }
    }
    nova.aoTerminarPorAqui = { [weak self] l, motivo in
      guard let self else { return }
      self.provedor.reportCall(with: l.uuid, endedAt: Date(), reason: self.razao(motivo))
      self.esquecer(l.uuid)
    }
    ligacao = nova
    // O áudio de ligação, antes de o CallKit ativá-lo (voz, com o eco cancelado).
    LigacaoNativa.prepararAudio()
    action.fulfill()
    emitir("onEstado", corpoDaLigacao(nova))
    nova.atender()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    let uuid = action.callUUID
    let atendida = atendidas.contains(uuid)
    let dados = chamadas[uuid] ?? [:]
    esquecer(uuid)
    // Recusar só para de tocar NESTE iPhone: a ligação segue tocando para o resto da
    // equipe, e o servidor fica sabendo para não mandar "parar" a este aparelho.
    // Desligar, depois de atender, encerra a ligação com o cliente.
    if atendida, ligacao?.uuid == uuid {
      ligacao?.desligar()
    } else if !atendida {
      if let convite = dados["convite"] as? String,
         let funcao = (dados["funcao"] as? String).flatMap(LigacaoNativa.funcaoConfiavel) {
        LigacaoNativa.pedirAoServidor(funcao: funcao, convite: convite, acao: "recusar") { _ in }
      }
      emitir("onRecusar", corpoDaChamada(uuid, dados))
    }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    if ligacao?.uuid == action.callUUID { ligacao?.silenciar(action.isMuted) }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    // O WebRTC só grava e toca depois disto: quem abre o áudio da ligação é o CallKit.
    LigacaoNativa.audioAtivo(audioSession)
  }

  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    LigacaoNativa.audioInativo(audioSession)
  }

  // MARK: - Ajudantes

  private func esquecer(_ uuid: UUID) {
    chamadas[uuid] = nil
    atendidas.remove(uuid)
    vigias[uuid]?.invalidate()
    vigias[uuid] = nil
  }

  private func razao(_ motivo: String) -> CXCallEndedReason {
    switch motivo {
    case "atendida": return .answeredElsewhere
    case "perdida": return .unanswered
    case "falhou": return .failed
    default: return .remoteEnded
    }
  }

  private func corpoDaLigacao(_ l: LigacaoNativa) -> [String: Any?] {
    return [
      "chamada": l.chamada,
      "quem": l.quem,
      "estado": l.estado.rawValue,
      "atendidaEm": l.atendidaEm.map { $0.timeIntervalSince1970 * 1000 },
      "mudo": l.mudo,
      "motivo": l.motivo,
      "caminho": l.caminho,
      "empresa": l.empresa,
      // Para o JS que chega depois não mostrar um fim antigo como se fosse agora.
      "em": Date().timeIntervalSince1970 * 1000,
    ]
  }

  private func corpoDaChamada(_ uuid: UUID, _ dados: [String: Any]) -> [String: Any?] {
    return [
      "chamada": uuid.uuidString.lowercased(),
      "quem": dados["quem"] as? String,
    ]
  }
}
