import { env } from "~/env";

import { Result, logger } from "../_utils";

export type UploadApiResponse = {
  public_id: string;
  secure_url: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  created_at: string;
};

export type UploadApiErrorResponse = {
  message: string;
  http_code: number;
};

/**
 * Generate SHA-1 signature for Cloudinary API requests
 * Edge-compatible implementation using Web Crypto API
 */
async function generateSignature(paramsToSign: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(paramsToSign);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Edge-compatible Cloudinary client using fetch API
 * Replaces cloudinary/v2 SDK which uses Node.js APIs
 */
export const cloudinaryClient = {
  /**
   * Upload image to Cloudinary using base64 data
   * Edge-compatible implementation using fetch API
   *
   * Callers pass an image that has already been size- and type-checked (see
   * requireValidImage in ~/server/_utils/image); `mime` is the detected type.
   */
  upload: async (
    image: { base64: string; mime: string },
    folder: string
  ): Promise<Result<UploadApiResponse | undefined, UploadApiErrorResponse>> => {
    logger.info("Uploading asset to Cloudinary.", { folder });

    try {
      const timestamp = Math.round(Date.now() / 1000);
      const paramsToSign = `folder=${folder}&format=jpg&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`;
      const signature = await generateSignature(paramsToSign);

      const formData = new FormData();
      formData.append('file', `data:${image.mime};base64,${image.base64}`);
      formData.append('folder', folder);
      formData.append('format', 'jpg');
      formData.append('api_key', env.CLOUDINARY_API_KEY);
      formData.append('timestamp', timestamp.toString());
      formData.append('signature', signature);

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!response.ok) {
        const error = await response.json() as { error: { message: string } };
        logger.error('Cloudinary upload failed', {
          status: response.status,
          error: error.error?.message,
          folder
        });
        return Result.err({
          message: error.error?.message || 'Upload failed',
          http_code: response.status,
        });
      }

      const data = await response.json() as UploadApiResponse;
      logger.info("Successfully uploaded asset to Cloudinary.", {
        public_id: data.public_id,
        folder
      });
      return Result.ok(data);
    } catch (error) {
      logger.error("An error occurred while uploading asset to Cloudinary.", { error, folder });
      return Result.err({
        message: error instanceof Error ? error.message : 'Unknown error',
        http_code: 500,
      });
    }
  }
};
