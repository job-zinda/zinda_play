import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

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
await copyFile(source, new URL("zinda-play.apk", destination));
await writeFile(
  new URL("zinda-play.apk.sha256", destination),
  `${createHash("sha256").update(apk).digest("hex")}  zinda-play.apk\n`,
);
console.log(`Packaged Zinda Play ${version[1]}+${version[2]} (${(apk.length / 1024 / 1024).toFixed(1)} MiB) in client/public/downloads.`);
