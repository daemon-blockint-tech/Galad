import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const ITERATIONS = 100000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

let ephemeralKey: string | undefined;

/**
 * Key material for credential encryption. Per ADR-0001 the key is derived from
 * `AUTH_SECRET`; `ENCRYPTION_MASTER_KEY` overrides it when an operator wants a
 * separate key. Read at call time, never at module load, so `next build` (which
 * runs without runtime secrets) is unaffected — same approach as src/lib/db.ts.
 *
 * There is deliberately no hardcoded fallback: a published constant would make
 * every stored credential readable by anyone with the repo.
 */
function getMasterKey(): string {
    const key = process.env.ENCRYPTION_MASTER_KEY || process.env.AUTH_SECRET;
    if (key) return key;

    if (process.env.NODE_ENV === "production") {
        throw new Error("[encryption] AUTH_SECRET (or ENCRYPTION_MASTER_KEY) is not set — refusing to encrypt credentials with a default key.");
    }

    // Dev/test only: a random per-process key. Anything written with it becomes
    // unreadable after a restart, which is the intended loud-ish failure.
    if (!ephemeralKey) {
        ephemeralKey = crypto.randomBytes(KEY_LENGTH).toString("hex");
        console.warn("[encryption] AUTH_SECRET is not set — using an ephemeral key. Stored credentials will not survive a restart.");
    }
    return ephemeralKey;
}

export interface EncryptedCredential {
    version: string;
    salt: string;
    nonce: string;
    ciphertext: string;
}

export async function encryptCredential(plainText: string): Promise<EncryptedCredential> {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16);
        crypto.pbkdf2(getMasterKey(), salt, ITERATIONS, KEY_LENGTH, DIGEST, (err, key) => {
            if (err) return reject(err);

            const nonce = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);

            let ciphertext = cipher.update(plainText, "utf8", "base64");
            ciphertext += cipher.final("base64");
            const authTag = cipher.getAuthTag().toString("base64");

            resolve({
                version: "v1",
                salt: salt.toString("base64"),
                nonce: nonce.toString("base64"),
                ciphertext: `${ciphertext}.${authTag}`
            });
        });
    });
}

export async function decryptCredential(cred: EncryptedCredential): Promise<string> {
    return new Promise((resolve, reject) => {
        if (cred.version !== "v1") {
            return reject(new Error("Unsupported version"));
        }

        const salt = Buffer.from(cred.salt, "base64");
        const nonce = Buffer.from(cred.nonce, "base64");
        const payloadParts = cred.ciphertext.split(".");
        if (payloadParts.length !== 2) {
            return reject(new Error("Invalid ciphertext payload"));
        }

        const ciphertext = payloadParts[0];
        const authTag = Buffer.from(payloadParts[1], "base64");

        crypto.pbkdf2(getMasterKey(), salt, ITERATIONS, KEY_LENGTH, DIGEST, (err, key) => {
            if (err) return reject(err);

            try {
                const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce);
                decipher.setAuthTag(authTag);

                let plainText = decipher.update(ciphertext, "base64", "utf8");
                plainText += decipher.final("utf8");
                resolve(plainText);
            } catch (decipherErr) {
                reject(decipherErr);
            }
        });
    });
}
