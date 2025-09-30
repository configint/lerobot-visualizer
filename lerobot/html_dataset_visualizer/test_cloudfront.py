import datetime
from botocore.signers import CloudFrontSigner
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.backends import default_backend
import requests
from urllib.parse import urlparse
import os
import boto3

def get_private_key_from_secrets_manager(secret_name: str, region_name: str = "us-west-2") -> bytes:
    client = boto3.client("secretsmanager", region_name=region_name)
    response = client.get_secret_value(SecretId=secret_name)
    return response["SecretString"].encode("utf-8")

def rsa_signer(message: bytes) -> bytes:
    pem_data = get_private_key_from_secrets_manager("configint")
    private_key = serialization.load_pem_private_key(
        pem_data, password=None, backend=default_backend()
    )
    return private_key.sign(message, padding.PKCS1v15(), hashes.SHA1())

key_id = "K1REJ1HDDLE7OS"  # Replace with your actual Key-Pair-ID
url = "https://d3keuzsn7dd5q1.cloudfront.net/data-builder/1.0.0/data/teleop-250612-policy-test/videos/chunk-000/observation.images.front_view/episode_000000.mp4"
expire_date = datetime.datetime.utcnow() + datetime.timedelta(minutes=30)

signer = CloudFrontSigner(key_id, rsa_signer)
signed_url = signer.generate_presigned_url(url, date_less_than=expire_date)

print("CloudFront Signed URL:\n", signed_url)

# === DOWNLOAD FILE ===
response = requests.get(signed_url, stream=True)
if response.status_code == 200:
    filename = os.path.basename(urlparse(url).path)
    download_path = os.path.expanduser(f"/Users/minjoon/Downloads/{filename}")
    with open(download_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)
    print(f"✅ File downloaded to {download_path}")
else:
    print(f"❌ Failed to download. Status code: {response.status_code}")