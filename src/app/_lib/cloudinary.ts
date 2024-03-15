import { v2 } from "cloudinary";
import { Cloudinary } from "@cloudinary/url-gen";
import { env } from "~/env";

export const cloudinaryClient = new Cloudinary({
    cloud: {
      cloudName: env.CLOUDINARY_CLOUD_NAME,
    }
});
  
v2.config({
  secure: true,
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

export const getAssetInfo = async (publicId: string) => {

    // Return colors in the response
    const options = {
      colors: true,
    };

    try {
      // Get details about the asset
      const result = await v2.api.resource(publicId, options) as {secure_url: string};
      console.log(result);
      return result;
      } catch (error) {
      console.error(error);
    }
};

export const createImageTag = (publicId: string) => {

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
};