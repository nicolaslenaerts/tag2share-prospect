/**
 * Chiffrement des clés API Buffer au repos (AES-256-GCM).
 *
 * La clé maître vit dans SOCIAL_ENCRYPTION_KEY (32 octets en hex, soit 64
 * caractères, à générer avec `openssl rand -hex 32`). La base ne stocke que le
 * chiffré et l'IV : une fuite de la table seule ne donne accès à aucun compte
 * Buffer.
 *
 * `version` prépare une rotation : on lira l'ancienne clé pour déchiffrer les
 * lignes existantes, et on réécrira avec la nouvelle.
 *
 * ⚠️ Module SERVEUR (node:crypto).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const TAG_LENGTH = 16;

export class EncryptionConfigError extends Error {}

function masterKey(version: number): Buffer {
  if (version !== 1) throw new EncryptionConfigError(`Version de clé inconnue : ${version}.`);
  const hex = process.env.SOCIAL_ENCRYPTION_KEY?.trim();
  if (!hex)
    throw new EncryptionConfigError(
      "SOCIAL_ENCRYPTION_KEY manquante : générez-la avec `openssl rand -hex 32` et ajoutez-la aux variables d'environnement."
    );
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32)
    throw new EncryptionConfigError("SOCIAL_ENCRYPTION_KEY doit faire 64 caractères hexadécimaux (32 octets).");
  return key;
}

/** La clé maître est-elle utilisable ? (affiché dans l'écran de connexion) */
export function encryptionReady(): boolean {
  try {
    masterKey(1);
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string): { encrypted: string; iv: string; version: number } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, masterKey(1), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const buf = Buffer.concat([data, cipher.getAuthTag()]);
  return { encrypted: buf.toString("base64"), iv: iv.toString("base64"), version: 1 };
}

export function decryptSecret(row: { encrypted: string; iv: string; version: number }): string {
  const buf = Buffer.from(row.encrypted, "base64");
  const data = buf.subarray(0, buf.length - TAG_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, masterKey(row.version), Buffer.from(row.iv, "base64"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
