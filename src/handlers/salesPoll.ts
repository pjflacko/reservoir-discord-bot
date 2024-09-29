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
import getCollection from "./getCollection";
import constants from "../utils/constants";
const sdk = require("api")("@reservoirprotocol/v1.0#6e6s1kl9rh5zqg");

/**
 * Check sales to see if there are new ones since the last alert
 * @param {TextChannel} channel channel to send new sales alerts
 * @param {string[]} contractArray collections to check for new sales
 * @param {string} apiKey Reservoir API Key
 * @param {Redis} redis Redis instance to save order ids
 */
export async function salePoll(
  channel: TextChannel,
  contractArray: string[],
  apiKey: string,
  redis: Redis
) {
  if (!constants.ALERT_ENABLED.sales || contractArray?.length <= 0) {
    return;
  }
  if (channel === undefined) {
    logger.error("sales channel is undefined");
    return;
  } else if (channel.type !== ChannelType.GuildText) {
    logger.error("sales channel is not a text channel");
    return;
  }

  try {
    // Authorizing with Reservoir API Key
    await sdk.auth(apiKey);

    // Loop through each contract in contractArray
    for (const contractAddress of contractArray) {
      // Getting sales events from Reservoir
      const salesResponse: paths["/sales/v4"]["get"]["responses"]["200"]["schema"] =
        await sdk.getSalesV4({
          contract: [contractAddress],
          includeTokenMetadata: "true",
          limit: "100",
          accept: "*/*",
        });

      // Getting the most recent sales
      const sales = salesResponse.sales;

      // Log failure + continue if sales couldn't be pulled for this contract
      if (!sales) {
        logger.error(`Could not pull sales for contract: ${contractAddress}`);
        continue;
      }

      // Pull cached sales event id from Redis for the current contract
      const cachedId: string | null = await redis.get(
        `saleorderid_${contractAddress}`
      );

      if (!cachedId) {
        channel.send(
          `Restarting sales bot for contract ${contractAddress}, new sales will begin to populate from here...`
        );
        await redis.set(`saleorderid_${contractAddress}`, sales[0].saleId ?? '');
        continue;
      }

      // If most recent sale event matches cached event, skip to next contract
      if (sales[0].saleId === cachedId) {
        continue;
      }

      // Find the index of the cached sale
      const cachedSaleIndex =
        sales.findIndex((order) => {
          return order.saleId === cachedId;
        }) - 1;

      // If cached sale is not found, reset cache
      if (cachedSaleIndex < 0) {
        await redis.del(`saleorderid_${contractAddress}`);
        logger.info(`Cached sale not found for ${contractAddress}, resetting`);
        continue;
      }

      // Loop through new sales and process them
      for (let i = cachedSaleIndex; i >= 0; i--) {
        const name = sales[i].token?.name;
        const image = sales[i].token?.image;

        if (!sales[i].orderSource) {
          logger.error(
            `Couldn't return sale order source for ${sales[i].txHash}`
          );
          continue;
        }

        if (!name || !image) {
          logger.error(
            `Couldn't return sale order name and image for ${sales[i].txHash}`
          );
          continue;
        }

        const collection = await getCollection(
          undefined,
          sales[i].token?.contract ?? '', // Fallback to empty string if undefined
          1,
          false
        );

        if (!collection?.[0]?.image || !collection?.[0]?.name) {
          logger.error(
            `Couldn't return sale order collection data for ${sales[i].txHash}`
          );
          continue;
        }

        const marketIcon = await handleMediaConversion(
          `https://api.reservoir.tools/redirect/sources/${sales[i].orderSource}/logo/v2`,
          `${sales[i].orderSource}`
        );

        const thumbnail = await handleMediaConversion(image, name);

        const authorIcon = await handleMediaConversion(
          collection[0].image,
          collection[0].name
        );

        const salesEmbed = new EmbedBuilder()
          .setColor(0x808080)
          .setTitle(`${sales[i].token?.name} has been sold!`)
          .setAuthor({
            name: `${sales[i].token?.collection?.name ?? 'Unknown Collection'}`,
            url: `https://forgotten.market/${sales[i].token?.contract ?? ''}`,
            iconURL: `attachment://${authorIcon.name}`,
          })
          .setDescription(
            `Item: ${sales[i].token?.name}\nPrice: ${sales[i].price?.amount?.native}Ξ ($${sales[i].price?.amount?.usd})\nBuyer: ${sales[i].to}\nSeller: ${sales[i].from}`
          )
          .setThumbnail(`attachment://${thumbnail.name}`)
          .setFooter({
            text: `${sales[i].orderSource}`,
            iconURL: marketIcon
              ? `attachment://${marketIcon.name}`
              : `https://api.reservoir.tools/redirect/sources/${sales[i].orderSource}/logo/v2`,
          })
          .setTimestamp();

        // Generating sale view button
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel("View Sale")
            .setStyle(5)
            .setURL(`https://etherscan.io/tx/${sales[i].txHash}`)
        );

        // Send sale alert to Discord channel
        channel.send({
          embeds: [salesEmbed],
          components: [row],
          files: [marketIcon, thumbnail, authorIcon],
        });
      }

      // Update Redis cache with the latest sale ID
      await redis.set(`saleorderid_${contractAddress}`, sales[0].saleId ?? '');
    }
  } catch (e) {
    logger.error(`Error ${e} updating new sales`);
  }
}
