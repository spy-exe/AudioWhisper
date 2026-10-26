import { requireOptionalNativeModule } from "expo";

interface CompanionCapture {
  connections(): Promise<string>;
  connect(options: string): Promise<string>;
  snapshot(): Promise<string>;
  transcript(id: string): Promise<string>;
  cachedTranscript(id: string): Promise<string>;
  start(options: string): Promise<string>;
  stop(): Promise<void>;
  sync(): Promise<void>;
  exportAudio(id: string): Promise<string>;
}

export default requireOptionalNativeModule<CompanionCapture>("CompanionCapture");
