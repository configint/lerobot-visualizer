import { getSignedUrl as cfGetSignedUrl } from "@aws-sdk/cloudfront-signer";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

let cachedKey: string | null = null;

async function getPrivateKey(secretName: string, region = "us-east-2") {
  if (cachedKey) return cachedKey;
  const client = new SecretsManagerClient({ region });
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const result = await client.send(command);
  cachedKey = result.SecretString || "";
  return cachedKey;
}

export async function getSignedCloudFrontUrl(key: string) {
  const domain = process.env.CLOUDFRONT_DOMAIN;
  const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const secretName = process.env.CLOUDFRONT_PRIVATE_KEY_SECRET || "configint";

  if (!domain || !keyPairId) {
    throw new Error("Missing CloudFront configuration");
  }

  const privateKey = await getPrivateKey(secretName);

  return cfGetSignedUrl({
    url: `https://${domain}/${key}`,
    keyPairId,
    dateLessThan: new Date(Date.now() + 60 * 60 * 1000),
    privateKey,
  });
}
