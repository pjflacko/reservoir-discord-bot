import Redis from "ioredis";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ChannelType,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { paths } from "@reservoir0x/reservoir-kit-client";
import logger from "../utils/logger";
import handleMediaConversion from "../utils/media";
import constants from "../utils/constants";
const sdk = require("api")("@reservoirprotocol/v1.0#6e6s1kl9rh5zqg");

/**
 * Check listings to see if there are new ones since the last alert
 * @param {TextChannel} channel channel to send new listings alerts
 * @param {string[]} contractArray collections to check for new listings
 * @param {string} apiKey Reservoir API Key
 * @param {Redis} redis Redis instance to save order ids
 */
export async function listingPoll(
  channel: TextChannel,
  contractArray: string[],
  apiKey: string,
  redis: Redis
) {
  if (!constants.ALERT_ENABLED.listings || contractArray?.length <= 0) {
    return;
  }
  if (channel === undefined) {
    logger.error("listings channel is undefined");
    return;
  } else if (channel.type !== ChannelType.GuildText) {
    logger.error("listings channel is not a text channel");
    return;
  }

  try {
    // Authorizing with Reservoir API Key
    await sdk.auth(apiKey);

    // Loop through each contract in contractArray
    for (const contractAddress of contractArray) {
      // Getting floor ask events from Reservoir
      const listingResponse: paths["/orders/asks/v3"]["get"]["responses"]["200"]["schema"] =
        await sdk.getOrdersAsksV3({
          contracts: [contractAddress],
          includePrivate: "false",
          includeMetadata: "true",
          includeRawData: "false",
          sortBy: "createdAt",
          limit: "500",
          accept: "*/*",
        });

      // Getting the most recent listings
      const listings = listingResponse.orders;

      // Log failure + continue if listings couldn't be pulled for this contract
      if (!listings) {
        logger.error(`Could not pull listings for contract: ${contractAddress}`);
        continue;
      }

      // Pull cached listing order id from Redis for the current contract
      const cachedId: string | null = await redis.get(
        `listingsorderid_${contractAddress}`
      );

      if (!cachedId) {
        channel.send(
          `Restarting listing bot for contract ${contractAddress}, new listings will begin to populate from here...`
        );
        await redis.set(`listingsorderid_${contractAddress}`, listings[0].id);
        continue;
      }

      // If most recent event matches cached event, skip to the next contract
      if (listings[0].id === cachedId) {
        continue;
      }

      // Find the index of the cached listing
      const cachedListingIndex =
        listings.findIndex((order) => {
          return order.id === cachedId;
        }) - 1;

      // If cached listing is not found, reset cache
      if (cachedListingIndex < 0) {
        await redis.del(`listingsorderid_${contractAddress}`);
        logger.info(`Cached listing not found for ${contractAddress}, resetting`);
        continue;
      }

      // Loop through new listings and process them
      for (let i = cachedListingIndex; i >= 0; i--) {
        if (listings[i].tokenSetId === listings[i + 1]?.tokenSetId) {
          logger.info(
            `Skipping duplicated listing order from other marketplace for ${listings[i].id}`
          );
          continue;
        }

        if (!listings[i].source?.icon || !listings[i].source?.name) {
          logger.error(
            `Couldn't return listing order source for ${listings[i].id}`
          );
          continue;
        }

        const tokenResponse: paths["/tokens/v5"]["get"]["responses"]["200"]["schema"] =
          await sdk.getTokensV5({
            tokenSetId: listings[i].tokenSetId,
            sortBy: "floorAskPrice",
            limit: "20",
            includeTopBid: "false",
            /* includeAttributes: "true", */
            accept: "*/*",
          });

        const tokenDetails = tokenResponse.tokens?.[0].token;

        if (
          !tokenDetails ||
          !tokenDetails?.collection ||
          /* !tokenDetails.attributes || */
          !tokenDetails.collection.image ||
          !tokenDetails.collection.name ||
          !tokenDetails.image ||
          !tokenDetails.name
        ) {
          logger.error(
            `Couldn't return listing order collection data for ${listings[i].id}`
          );
          continue;
        }

        // Create attributes array for Discord fields if the attributes exist
        /* const attributes: { name: string; value: string; inline: boolean }[] =
          tokenDetails.attributes.map((attr) => {
            return {
              name: attr.key ?? "",
              value: attr.value ?? "",
              inline: true,
            };
          }) ?? []; */

        // Handle media conversions
        const sourceIcon = await handleMediaConversion(
          `${listings[i].source?.icon}`,
          `${listings[i].source?.name}`
        );

        const authorIcon = await handleMediaConversion(
          tokenDetails.collection.image,
          tokenDetails.collection.name
        );

        const image = await handleMediaConversion(
          tokenDetails.image,
          tokenDetails.name
        );

        // Generate the listing embed message
        const listingEmbed = new EmbedBuilder()
          .setColor(0x8b43e0)
          .setTitle(`${tokenDetails.name?.trim()} has been listed!`)
          .setAuthor({
            name: `${tokenDetails.collection.name}`,
            url: `https://forgotten.market/${tokenDetails.contract}`,
            iconURL: `attachment://${authorIcon.name}`,
          })
          .setDescription(
            `Item: ${tokenDetails.name}\nPrice: ${listings[i].price?.amount?.native}Ξ ($${listings[i].price?.amount?.usd})\nFrom: ${listings[i].maker}`
          )
          /* .addFields(attributes) */
          .setThumbnail(`attachment://${image.name}`)
          .setFooter({
            text: `${listings[i].source?.name}`,
            iconURL: `attachment://${sourceIcon.name}`,
          })
          .setTimestamp();

        // Generating purchase button
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel("Purchase")
            .setStyle(5)
            .setURL(
              `https://forgotten.market/${tokenDetails.contract}/${tokenDetails.tokenId}`
            )
        );

        // Send listing alert to Discord channel
        channel.send({
          embeds: [listingEmbed],
          components: [row],
          files: [sourceIcon, authorIcon, image],
        });
      }

      // Update Redis cache with the latest order ID
      await redis.set(`listingsorderid_${contractAddress}`, listings[0].id);
    }
  } catch (e) {
    logger.error(`Error ${e} updating new listings`);
  }
}
