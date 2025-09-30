import { getSignedUrl as cfGetSignedUrl } from "@aws-sdk/cloudfront-signer";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl as s3GetSignedUrl } from "@aws-sdk/s3-request-presigner";

let cachedKey: string | null = null;
let s3Client: S3Client | null = null;

async function getPrivateKey(secretName: string, region = "us-west-2") {
  if (cachedKey) return cachedKey;
  const client = new SecretsManagerClient({ region });
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const result = await client.send(command);
  cachedKey = result.SecretString || "";
  return cachedKey;
}

export async function getSignedUrl(bucket: string, key: string) {
  const domain = process.env.CLOUDFRONT_DOMAIN;
  const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const secretName = process.env.CLOUDFRONT_PRIVATE_KEY_SECRET || "configint";

  if (domain && keyPairId) {
    const privateKey = await getPrivateKey(secretName);
    return cfGetSignedUrl({
      url: `https://${domain}/${key}`,
      keyPairId,
      dateLessThan: new Date(Date.now() + 60 * 60 * 1000),
      privateKey,
    });
  }

  if (!s3Client) {
    s3Client = new S3Client({ region: "us-west-2" });
  }
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return s3GetSignedUrl(s3Client, command, { expiresIn: 3600 });
}
