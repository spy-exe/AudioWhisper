import { spawnSync } from "node:child_process";

// Temporary exceptions have no compatible upstream fix in the SDK 55 dependency tree.
// Block new advisories and require a fresh review when these exceptions expire.
const reviewed = new Map([
  ["https://github.com/advisories/GHSA-86w9-cpqp-85rv", "node-forge"],
  ["https://github.com/advisories/GHSA-mrhx-c7xc-m3w5", "zod"],
  ["https://github.com/advisories/GHSA-vcc3-ghjq-m6fr", "decode-uri-component"],
]);
const audit = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["audit", "--json"], {
  encoding: "utf8", shell: process.platform === "win32", maxBuffer: 8 * 1024 * 1024,
});
if (audit.error || ![0, 1].includes(audit.status)) throw new Error("Dependency audit could not run.");
const report = JSON.parse(audit.stdout);
if (report.error || !report.vulnerabilities) throw new Error("Dependency audit returned an invalid report.");
const notices = new Map();
for (const value of Object.values(report.vulnerabilities)) {
  for (const advisory of value.via.filter(item => typeof item === "object")) {
    if (reviewed.get(advisory.url) !== advisory.dependency || advisory.severity === "critical") {
      throw new Error(`Unreviewed security advisory: ${advisory.url}`);
    }
    notices.set(advisory.url, advisory);
  }
}
if (notices.size && new Date() >= new Date("2026-11-26T00:00:00Z")) throw new Error("Mobile dependency exceptions need a new security review.");
for (const notice of notices.values()) console.log(`Reviewed upstream advisory: ${notice.dependency} (${notice.severity}) ${notice.url}`);
console.log("Dependency audit completed. See SECURITY.md for scope and mitigations.");
