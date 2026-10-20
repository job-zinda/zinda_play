import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const source = new URL("../../mobile/build/app/outputs/flutter-apk/app-release.apk", import.meta.url);
const metadata = new URL("../../mobile/build/app/outputs/apk/release/output-metadata.json", import.meta.url);
const destination = new URL("../public/downloads/", import.meta.url);
const pubspec = await readFile(new URL("../../mobile/pubspec.yaml", import.meta.url), "utf8");
const version = pubspec.match(/^version:\s*([^\s+]+)\+(\d+)\s*$/m);
if (!version) throw new Error("Cannot read the Android release version from mobile/pubspec.yaml.");

const output = JSON.parse(await readFile(metadata, "utf8"));
if (output.applicationId !== "com.zindaplay.zinda_play" ||
    output.elements?.length !== 1 ||
    output.elements[0].versionName !== version[1] ||
    output.elements[0].versionCode !== Number(version[2]) ||
    output.elements[0].filters?.length !== 0) {
  throw new Error("Build a current universal release APK first: cd mobile; flutter build apk --release");
}
const apk = await readFile(source);
if (apk.length < 1024 || apk.readUInt32LE(0) !== 0x04034b50) {
  throw new Error("The release APK is missing or is not an APK/ZIP archive.");
}
// Stay below GitHub's individual-file limit for repository-backed deployments.
if (apk.length >= 100 * 1024 * 1024) {
  throw new Error("APK exceeds the repository file-size limit. Use dedicated release storage before publishing.");
}
await mkdir(destination, { recursive: true });
await verifyAppLinkCertificate();
await copyFile(source, new URL("zinda-play.apk", destination));
await writeFile(
  new URL("zinda-play.apk.sha256", destination),
  `${createHash("sha256").update(apk).digest("hex")}  zinda-play.apk\n`,
);
console.log(`Packaged Zinda Play ${version[1]}+${version[2]} (${(apk.length / 1024 / 1024).toFixed(1)} MiB) in client/public/downloads.`);

// Shared zindaplay.com links only open the installed app when its signing certificate is published in assetlinks.json.
async function verifyAppLinkCertificate() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
    (process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk"));
  const buildTools = sdk ? join(sdk, "build-tools") : "";
  const versions = buildTools && existsSync(buildTools)
    ? (await readdir(buildTools)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    : [];
  const apksigner = versions.map(v => join(buildTools, v, process.platform === "win32" ? "apksigner.bat" : "apksigner")).find(existsSync);
  if (!apksigner) throw new Error("Cannot find apksigner. Set ANDROID_HOME so the APK certificate can be checked against assetlinks.json.");
  const result = spawnSync(`"${apksigner}" verify --print-certs "${fileURLToPath(source)}"`, { shell: true, encoding: "utf8" });
  const digest = result.stdout?.match(/Signer #1 certificate SHA-256 digest: ([0-9a-f]{64})/i)?.[1];
  if (result.status !== 0 || !digest) throw new Error(`Could not verify the APK signature.\n${result.stderr || result.stdout}`);
  const fingerprint = digest.toUpperCase().match(/../g).join(":");
  const links = JSON.parse(await readFile(new URL("../public/.well-known/assetlinks.json", import.meta.url), "utf8"));
  const published = links.some(link => link.target?.package_name === output.applicationId &&
    link.target.sha256_cert_fingerprints?.includes(fingerprint));
  if (!published) {
    throw new Error(`Add ${fingerprint} to client/public/.well-known/assetlinks.json, or shared links will open in the browser instead of the installed app.`);
  }
}
