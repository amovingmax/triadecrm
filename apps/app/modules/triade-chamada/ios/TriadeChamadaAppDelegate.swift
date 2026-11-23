import ExpoModulesCore
import UIKit

/// Liga o aviso de voz da Apple na abertura do app, antes da primeira tela: quando o
/// iPhone abre o app fechado por causa de uma ligação, o aviso só é entregue a quem já
/// estiver registrado (`CentralDeChamadas.iniciar`).
public class TriadeChamadaAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    CentralDeChamadas.shared.iniciar()
    return true
  }
}
