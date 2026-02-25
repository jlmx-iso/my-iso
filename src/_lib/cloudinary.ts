import { Result, logger } from "../_utils";
import { env } from "~/env";

export type Resource = {
  public_id: string;
  format: string;
  version: number;
  resource_type: string;
  type: string;
  created_at: string;
  bytes: number;
  width: number;
  height: number;
  url: string;
  secure_url: string;
  access_mode: string;
  original_filename: string;
  tags: string[];
  context: {
    custom: {
      alt: string;
    };
  };
};

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
   * Create an image tag with Cloudinary transformations
   */
  createImageTag: (publicId: string) => {
    const baseUrl = `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/image/upload`;
    return `<img src="${baseUrl}/${publicId}" />`;
  },

  /**
   * Get asset information from Cloudinary
   */
  getAssetInfo: async (publicId: string): Promise<{ secure_url: string } | undefined> => {
    try {
      const timestamp = Math.round(Date.now() / 1000);
      const paramsToSign = `public_id=${publicId}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`;
      const signature = await generateSignature(paramsToSign);

      const url = new URL(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/resources/image/upload`);
      url.searchParams.set('public_ids', publicId);
      url.searchParams.set('api_key', env.CLOUDINARY_API_KEY);
      url.searchParams.set('timestamp', timestamp.toString());
      url.searchParams.set('signature', signature);

      const response = await fetch(url.toString());

      if (!response.ok) {
        logger.error("Failed to fetch asset info from Cloudinary", {
          status: response.status,
          publicId
        });
        return undefined;
      }

      const data = await response.json() as { resources: Array<{ secure_url: string }> };

      // Check if resources array is empty
      if (!data.resources || data.resources.length === 0) {
        logger.warn("No resources found in Cloudinary response", { publicId });
        return undefined;
      }

      return data.resources[0];
    } catch (error) {
      logger.error("An error occurred while fetching asset info.", { error, publicId });
      return undefined;
    }
  },

  /**
   * Get assets by prefix from Cloudinary
   */
  getAssetsByPrefix: async (prefix: string): Promise<Result<{ resources: Resource[] }>> => {
    try {
      const timestamp = Math.round(Date.now() / 1000);
      const paramsToSign = `max_results=5&prefix=${prefix}&timestamp=${timestamp}&type=upload${env.CLOUDINARY_API_SECRET}`;
      const signature = await generateSignature(paramsToSign);

      const url = new URL(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/resources/image`);
      url.searchParams.set('prefix', prefix);
      url.searchParams.set('max_results', '5');
      url.searchParams.set('type', 'upload');
      url.searchParams.set('api_key', env.CLOUDINARY_API_KEY);
      url.searchParams.set('timestamp', timestamp.toString());
      url.searchParams.set('signature', signature);

      const response = await fetch(url.toString());

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn("Failed to fetch assets from Cloudinary", {
          status: response.status,
          error: errorText,
          prefix
        });
        return Result.err(new Error(`Cloudinary API error: ${response.status}`));
      }

      const data = await response.json() as { resources: Resource[] };
      logger.info("Fetched assets from Cloudinary.", { prefix, count: data.resources.length });
      return Result.ok(data);
    } catch (error) {
      logger.warn("An error occurred while fetching assets.", { error, prefix });
      if (error instanceof Error) {
        return Result.err(error);
      }
      return Result.err(new Error("An unknown error occurred while fetching assets."));
    }
  },

  /**
   * Upload image to Cloudinary using base64 data
   * Edge-compatible implementation using fetch API
   */
  upload: async (
    base64Data: string,
    folder: string
  ): Promise<Result<UploadApiResponse | undefined, UploadApiErrorResponse>> => {
    logger.info("Uploading asset to Cloudinary.", { folder });

    try {
      const timestamp = Math.round(Date.now() / 1000);
      const paramsToSign = `folder=${folder}&format=jpg&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`;
      const signature = await generateSignature(paramsToSign);

      const formData = new FormData();
      formData.append('file', `data:image/jpeg;base64,${base64Data}`);
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
