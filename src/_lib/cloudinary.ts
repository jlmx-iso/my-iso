import { type UploadApiErrorResponse, type UploadApiResponse, v2 } from "cloudinary";

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

v2.config({
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  secure: true,
});


export const cloudinaryClient = {
  createImageTag: (publicId: string) => {

    // Create an image tag with transformations applied to the src URL
    const imageTag = v2.image(publicId, {
      // transformation: [
      //   { width: 250, height: 250, gravity: 'faces', crop: 'thumb' },
      //   { radius: 'max' },
      //   { effect: 'outline:10', color: effectColor },
      //   { background: backgroundColor },
      // ],
    });

    return imageTag;
  },

  getAssetInfo: async (publicId: string) => {

    // Return colors in the response
    const options = {
      colors: true,
    };

    try {
      // Get details about the asset
      const result = await v2.api.resource(publicId, options) as { secure_url: string };
      return result;
    } catch (error) {
      logger.error("An error occurred while fetching asset info.", { error, publicId });
    }
  },

  getAssetsByPrefix: async (prefix: string): Promise<Result<{ resources: Resource[]; }>> => {
    try {
      // Get details about the asset
      const result = await v2.api.resources({
        max_results: 5,
        prefix: prefix,
        type: "upload",
      }) as { resources: Resource[] };
      logger.info("Fetched assets from Cloudinary.", { prefix });
      return Result.ok(result);
    } catch (error) {
      logger.warn("An error occurred while fetching assets.", { error, prefix });
      if (error instanceof Error) {
        return Result.err(error);
      }
      return Result.err(new Error("An unknown error occurred while fetching assets."));
    }
  },

  uploadStream: async (stream: Buffer, folder: string): Promise<Result<UploadApiResponse | undefined, UploadApiErrorResponse>> => {
    logger.info("Uploading asset to Cloudinary.", { folder });
    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const uploadResult = await new Promise((resolve) => {
        v2.uploader.upload_stream(
          { folder, resource_type: "image" },
          (error, result) => {
            return resolve(result);
          }
        ).end(stream);
      }) as UploadApiResponse | undefined;
      return Result.ok(uploadResult);
    } catch (error) {
      logger.error("An error occurred while uploading asset to Cloudinary.", { error, folder });
      return Result.err(error as UploadApiErrorResponse);
    }
  }
};