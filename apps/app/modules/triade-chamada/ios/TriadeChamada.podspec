require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# A tela de chamada do iPhone (CallKit) e o aviso de voz da Apple (PushKit), 23/11/2026.
# Módulo local do app (apps/app/modules): o autolinking do Expo o acha sozinho.
Pod::Spec.new do |s|
  s.name           = 'TriadeChamada'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'UNLICENSED'
  s.author         = 'KOMUNE'
  s.homepage       = 'https://komune.app.br'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # O WebRTC compilado pela Jitsi (o mesmo do react-native-webrtc), com o áudio de
  # ligação do iPhone (RTCAudioSession) que o CallKit precisa.
  s.dependency 'JitsiWebRTC', '~> 155.0.1'
  s.frameworks = 'CallKit', 'PushKit', 'AVFoundation'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
