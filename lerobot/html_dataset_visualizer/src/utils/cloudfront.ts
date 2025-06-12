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
let cachedKey: string | null = null;

async function getPrivateKey(): Promise<string> {
  if (!cachedKey) {
    const resp = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretName }),
    );
    cachedKey = resp.SecretString || "";
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
