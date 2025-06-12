import { getSignedUrl as cfGetSignedUrl } from "@aws-sdk/cloudfront-signer";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const domain =
  process.env.CLOUDFRONT_DOMAIN || "https://d3keuzsn7dd5q1.cloudfront.net";
const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID || "K1REJ1HDDLE7OS";
const secretName = process.env.CLOUDFRONT_PRIVATE_KEY_SECRET || "configint";
const region = process.env.AWS_REGION || "us-east-2";

const secretsClient = new SecretsManagerClient({ region });
// Cache the resolved private key so we don't fetch from Secrets Manager
// repeatedly. The key may be returned either as a PEM string or raw Buffer
// depending on how it's stored.
let cachedKey: string | Buffer | null = null;

async function getPrivateKey(): Promise<string | Buffer> {
  if (!cachedKey) {
    let keyData: string | Buffer;

    if (process.env.CLOUDFRONT_PRIVATE_KEY) {
      keyData = process.env.CLOUDFRONT_PRIVATE_KEY;
    } else {
      const resp = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: secretName }),
      );

      if (resp.SecretString) {
        keyData = resp.SecretString;
      } else if (resp.SecretBinary) {
        keyData =
          resp.SecretBinary instanceof Uint8Array
            ? Buffer.from(resp.SecretBinary)
            : Buffer.from(resp.SecretBinary as string, "base64");
      } else {
        throw new Error(`Secret ${secretName} is empty`);
      }
    }

    if (typeof keyData === "string") {
      // Handle escaped newlines from environment variables
      if (keyData.includes("\\n")) {
        keyData = keyData.replace(/\\n/g, "\n");
      }

      // If the string doesn't look like PEM, attempt base64 decode. If the
      // decoded data still looks textual and contains the PEM header, use the
      // decoded string. Otherwise keep the binary Buffer for DER formatted keys.
      if (!keyData.includes("BEGIN")) {
        try {
          const buf = Buffer.from(keyData, "base64");
          const asText = buf.toString("utf-8");
          keyData = asText.includes("BEGIN") ? asText : buf;
        } catch {
          /* ignore */
        }
      }
    }

    cachedKey = keyData;
  }
  return cachedKey;
}

export async function getSignedCloudFrontUrl(path: string): Promise<string> {
  const privateKey = await getPrivateKey();
  return cfGetSignedUrl({
    url: `${domain}/${path.replace(/^\//, "")}`,
    keyPairId,
    dateLessThan: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    privateKey,
  });
}
