/**
 * Unit tests for storage service.
 * @aws-sdk/client-s3 is mocked — no real S3/R2 calls.
 */

jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn().mockResolvedValue({});
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send })),
    PutObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    __send: send,
  };
});

// Load via require so mock is guaranteed to be in place
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { uploadBuffer, deleteObject } = require('../services/storage') as typeof import('../services/storage');

function getMockSend(): jest.Mock {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@aws-sdk/client-s3') as { __send: jest.Mock }).__send;
}

beforeEach(() => {
  process.env['S3_BUCKET_NAME'] = 'test-bucket';
  process.env['S3_REGION'] = 'us-east-1';
  process.env['S3_ACCESS_KEY_ID'] = 'test-key';
  process.env['S3_SECRET_ACCESS_KEY'] = 'test-secret';
  delete process.env['S3_ENDPOINT'];
  delete process.env['S3_PUBLIC_URL'];
  getMockSend().mockClear();
});

describe('uploadBuffer', () => {
  it('sends a PutObjectCommand to S3', async () => {
    await uploadBuffer('images/test.jpg', Buffer.from('x'), 'image/jpeg');
    expect(getMockSend()).toHaveBeenCalledTimes(1);
  });

  it('returns a standard AWS URL when no S3_PUBLIC_URL is set', async () => {
    const url = await uploadBuffer('images/test.jpg', Buffer.from('x'), 'image/jpeg');
    expect(url).toBe('https://test-bucket.s3.us-east-1.amazonaws.com/images/test.jpg');
  });

  it('returns the public URL when S3_PUBLIC_URL is configured', async () => {
    process.env['S3_PUBLIC_URL'] = 'https://pub.example.com';
    const url = await uploadBuffer('images/test.jpg', Buffer.from('x'), 'image/jpeg');
    expect(url).toBe('https://pub.example.com/images/test.jpg');
  });
});

describe('deleteObject', () => {
  it('sends a DeleteObjectCommand to S3', async () => {
    await deleteObject('images/test.jpg');
    expect(getMockSend()).toHaveBeenCalledTimes(1);
  });
});
