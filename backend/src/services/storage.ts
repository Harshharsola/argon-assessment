import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

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
 * Stream an object from R2/S3 directly — avoids presigned URL CORS issues.
 * Returns the readable body stream and content type.
 */
export async function getObjectStream(key: string): Promise<{ stream: Readable; contentType: string }> {
  const response = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  return {
    stream: response.Body as Readable,
    contentType: response.ContentType ?? 'application/octet-stream',
  };
}
