const sdk = require("api")("@reservoirprotocol/v1.0#6e6s1kl9rh5zqg");
import { paths } from "@reservoir0x/reservoir-kit-client";
import dotenv from "dotenv";
import logger from "../utils/logger";

/**
 * Retrieve collection data from Reservoir
 * @param {string | string[]} name collection name or array of names to search for
 * @param {string | string[]} contractAddress collection address or array of addresses to search
 * @param {number} limit number of collections to return per request
 * @param {boolean} includeTopBid whether to include top bid info or not
 * @returns array of collection info
 */
export default async function getCollection(
  name?: string | string[],
  contractAddress?: string | string[],
  limit: number = 5,
  includeTopBid: boolean = false
): Promise<
  paths["/collections/v5"]["get"]["responses"]["200"]["schema"]["collections"]
> {
  // Log failure + throw if neither name nor contract address are provided
  if (!name && !contractAddress) {
    throw new Error("Either name or contract address must be provided.");
  }

  // Normalize limit to bounds of 1 <= limit <= 20
  limit = Math.min(Math.max(limit, 1), 20);

  // If the inputs are not arrays, convert them to arrays to handle multiple values
  const nameArray = Array.isArray(name) ? name : name ? [name] : [];
  const addressArray = Array.isArray(contractAddress)
    ? contractAddress
    : contractAddress
    ? [contractAddress]
    : [];

  try {
    dotenv.config();
    // Authorizing with Reservoir API Key
    await sdk.auth(process.env.RESERVOIR_API_KEY);

    const collections: paths["/collections/v5"]["get"]["responses"]["200"]["schema"]["collections"] = [];

    // Process each name or contract address
    for (const contract of addressArray) {
      const response: paths["/collections/v5"]["get"]["responses"]["200"]["schema"] =
        await sdk.getCollectionsV5({
          id: contract,
          includeTopBid,
          sortBy: "allTimeVolume",
          limit,
          accept: "*/*",
        });

      // Safely push the collections if they exist, defaulting to an empty array
      collections.push(...(response.collections ?? []));
    }

    for (const collectionName of nameArray) {
      const response: paths["/collections/v5"]["get"]["responses"]["200"]["schema"] =
        await sdk.getCollectionsV5({
          name: collectionName,
          includeTopBid,
          sortBy: "allTimeVolume",
          limit,
          accept: "*/*",
        });

      // Safely push the collections if they exist, defaulting to an empty array
      collections.push(...(response.collections ?? []));
    }

    // Return the consolidated array of collections
    return collections;
  } catch (e) {
    // Log failure + throw on error
    logger.error(
      `Failed to pull collection data for name=${JSON.stringify(
        name
      )}, contractAddress=${JSON.stringify(
        contractAddress
      )}, limit=${limit}, includeTopBid=${includeTopBid}`
    );
    throw new Error("Failed to pull collection data");
  }
}
