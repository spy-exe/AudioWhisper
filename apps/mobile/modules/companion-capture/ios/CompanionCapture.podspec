Pod::Spec.new do |s|
  s.name = 'CompanionCapture'
  s.version = '0.1.0'
  s.summary = 'Local audio capture and delivery to AudioWhisper Studio.'
  s.description = 'A native recorder with a durable local journal and LAN delivery.'
  s.author = 'AudioWhisper'
  s.homepage = 'https://github.com/spy-exe/AudioWhisper'
  s.license = { :type => 'UNLICENSED' }
  s.platforms = { :ios => '16.0' }
  s.source = { :git => 'https://github.com/spy-exe/AudioWhisper.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.frameworks = 'AVFoundation', 'Security'
  s.swift_version = '5.9'
end
