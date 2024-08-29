import { cloudinaryClient } from "~/_lib";

export const getPortfolioImages = async (userId: string) => {
  let images = await cloudinaryClient.getAssetsByPrefix(`portfolios/${userId}`);
  if (!images.isOk || images.value.resources.length === 0) {
    images = await cloudinaryClient.getAssetsByPrefix(`portfolios/default`);
  }
  if (images.isOk && images.value.resources.length > 0) {
    return images.value.resources;
  };
  return [];
};