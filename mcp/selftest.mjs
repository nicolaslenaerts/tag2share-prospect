#!/usr/bin/env node
/**
 * Vérification de bout en bout du serveur MCP : on le lance comme le ferait
 * Claude Code (stdio), on négocie, on liste les outils et on appelle les
 * LECTURES de chaque marque. Aucune écriture : ce script doit rester lançable
 * sur n'importe quelle instance sans rien y créer.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [path.join(here, "server.mjs")], {
  stdio: ["pipe", "pipe", "inherit"],
});

let id = 0;
const pending = new Map();
let buf = "";

child.stdout.setEncoding("utf8");
child.stdout.on("data", (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});

function call(method, params) {
  const rid = ++id;
  return new Promise((resolve) => {
    pending.set(rid, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: rid, method, params }) + "\n");
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

/** Contenu texte d'un tools/call, décodé. Lève si l'outil a signalé une erreur. */
function payload(res, label) {
  const text = res.result?.content?.[0]?.text ?? "";
  if (res.result?.isError) throw new Error(`${label} : ${text}`);
  return JSON.parse(text);
}

const ok = (s) => console.log(`  ✓ ${s}`);

try {
  const init = await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "selftest", version: "0" },
  });
  if (!init.result?.serverInfo) throw new Error("initialize sans serverInfo");
  ok(`initialize — ${init.result.serverInfo.name} (protocole ${init.result.protocolVersion})`);
  notify("notifications/initialized");

  const tools = (await call("tools/list")).result.tools;
  ok(`tools/list — ${tools.length} outils : ${tools.map((t) => t.name).join(", ")}`);

  const { brands } = payload(
    await call("tools/call", { name: "list_brands", arguments: {} }),
    "list_brands"
  );
  ok(`list_brands — ${brands.length} marque(s)`);

  for (const b of brands) {
    const { segments } = payload(
      await call("tools/call", { name: "list_segments", arguments: { brand: b.slug } }),
      "list_segments"
    );
    const { campaigns } = payload(
      await call("tools/call", { name: "list_campaigns", arguments: { brand: b.slug } }),
      "list_campaigns"
    );
    ok(
      `${b.slug} — ${segments.length} segment(s), ${campaigns.length} campagne(s)` +
        (b.ready_to_send ? "" : " [envoi réel non autorisé]")
    );
    const withVariants = campaigns.find((c) => c.variants?.length);
    if (withVariants) {
      const d = payload(
        await call("tools/call", {
          name: "get_campaign",
          arguments: { brand: b.slug, campaign_id: withVariants.id },
        }),
        "get_campaign"
      );
      ok(
        `  get_campaign « ${d.campaign.name} » — ${d.campaign.variants.length} variante(s), ` +
          `total ${d.campaign.variants_total_weight} %`
      );
    }
  }

  // Le garde-fou de marque doit refuser, pas dériver silencieusement.
  const bad = await call("tools/call", {
    name: "list_segments",
    arguments: { brand: "marque-qui-nexiste-pas" },
  });
  if (!bad.result?.isError) throw new Error("un slug inconnu aurait dû être refusé");
  ok("slug inconnu refusé : " + bad.result.content[0].text);

  console.log("\nTout est vert.");
  process.exitCode = 0;
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  child.kill();
}
