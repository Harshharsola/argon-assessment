import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

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
const BUCKET = process.env.S3_BUCKET_NAME ?? '';

/**
 * Upload a buffer to S3-compatible storage.
 * @returns Public URL of the stored object
 */
export async function uploadBuffer(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType })
  );

  if (process.env.S3_PUBLIC_URL) {
    return `${process.env.S3_PUBLIC_URL}/${key}`;
  }
  return `https://${BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com/${key}`;
}

/** Delete an object from storage by key */
export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
