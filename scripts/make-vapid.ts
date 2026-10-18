/**
 * Web push keys (VAPID): if .env.local does not have them yet, make a new key pair and append
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT
 * to .env.local. Never prints the private key. Copy the same three values into the host's settings (Vercel).
 * Making new keys later turns off every phone that already subscribed (they must press "Turn on" again).
 *
 * Run from the web folder:  node --no-warnings scripts/make-vapid.ts
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import webpush from "web-push";

const FILE = ".env.local";
const SUBJECT = "https://github.com/priyankddabhi/ncs";

const text = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const has = (name: string) => new RegExp(`^\\s*${name}\\s*=\\s*\\S`, "m").test(text);

if (has("NEXT_PUBLIC_VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY")) {
  console.log(`${FILE} already has the VAPID keys: nothing changed.`);
  if (!has("VAPID_SUBJECT")) {
    appendFileSync(FILE, `${text && !text.endsWith("\n") ? "\n" : ""}VAPID_SUBJECT=${SUBJECT}\n`);
    console.log(`Added VAPID_SUBJECT to ${FILE}.`);
  }
} else {
  const { publicKey, privateKey } = webpush.generateVAPIDKeys();
  const lines = [
    `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}`,
    `VAPID_PRIVATE_KEY=${privateKey}`,
    ...(has("VAPID_SUBJECT") ? [] : [`VAPID_SUBJECT=${SUBJECT}`]),
  ];
  appendFileSync(FILE, `${text && !text.endsWith("\n") ? "\n" : ""}${lines.join("\n")}\n`);
  console.log(`Added NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to ${FILE} (values not shown).`);
  console.log("Rebuild the website (npm run build): the public key is built into the page.");
}
