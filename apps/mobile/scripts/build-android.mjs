import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = process.env.AW_MOBILE_ROOT || fileURLToPath(new URL("../", import.meta.url));
const android = path.join(root, "android");
const env = { ...process.env, NODE_ENV: "production" };
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" && command.endsWith(".bat") });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ["node_modules/expo/bin/cli", "prebuild", "--platform", "android", "--no-install"], root);
run(process.platform === "win32" ? "gradlew.bat" : "./gradlew", [
  ":audiowhisper-companion-capture:testDebugUnitTest", ":app:assembleRelease", "--console=plain", "--max-workers=2",
  "-Dorg.gradle.jvmargs=-Xmx3072m",
  `-PreactNativeArchitectures=${process.env.AW_ANDROID_ABIS || "arm64-v8a,x86_64"}`,
], android);
console.log("APK de validação: android/app/build/outputs/apk/release/app-release.apk. Assine com uma chave própria antes de distribuir.");
