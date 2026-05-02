import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
  region: process.env.S3_REGION ?? 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
};

if (process.env.S3_ENDPOINT) {
  clientConfig.endpoint = process.env.S3_ENDPOINT;
  clientConfig.forcePathStyle = true; // required for R2 and MinIO
}

const s3 = new S3Client(clientConfig);

/** Read bucket name lazily so tests can set env vars in beforeEach */
const getBucket = () => process.env.S3_BUCKET_NAME ?? '';

/**
 * Upload a buffer to S3-compatible storage.
 * @returns Public URL of the stored object
 */
export async function uploadBuffer(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const bucket = getBucket();
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType })
  );

  if (process.env.S3_PUBLIC_URL) {
    return `${process.env.S3_PUBLIC_URL}/${key}`;
  }
  return `https://${bucket}.s3.${process.env.S3_REGION}.amazonaws.com/${key}`;
}

/** Delete an object from storage by key */
export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

/**
 * Generate a presigned URL for viewing a private object.
 * Expires in 1 hour. Used when S3_PUBLIC_URL is not configured.
 */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key });
  return getSignedUrl(s3, command, { expiresIn });
}
