import Redis from "ioredis";
import {
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ChannelType,
} from "discord.js";
import { paths } from "@reservoir0x/reservoir-kit-client";
import logger from "../utils/logger";
import constants from "../utils/constants";
import getCollection from "./getCollection";
const sdk = require("api")("@reservoirprotocol/v1.0#6e6s1kl9rh5zqg");

/**
 * Check top bid events for all tracked collections and send alerts if applicable
 * @param {TextChannel} channel Channel to send top bid alerts to
 * @param {string[]} contractAddresses List of collection contract addresses to check for top bid events
 * @param {string} apiKey Reservoir API Key
 * @param {Redis} redis Redis instance
 */
export async function bidPoll(
  channel: TextChannel,
  contractAddresses: string[],
  apiKey: string,
  redis: Redis
) {
  if (!constants.ALERT_ENABLED.bid || contractAddresses.length === 0) {
    return;
  }
  if (channel === undefined) {
    logger.error("top bid channel is undefined");
    return;
  } else if (channel.type !== ChannelType.GuildText) {
    logger.error("top bid channel is not a text channel");
    return;
  }

  try {
    // Authorizing with Reservoir API Key
    await sdk.auth(apiKey);

    // Loop through all tracked contract addresses
    for (const contractAddress of contractAddresses) {
      if (!contractAddress) continue;

      // Getting top bid events from Reservoir
      const topBidResponse: paths["/events/collections/top-bid/v1"]["get"]["responses"]["200"]["schema"] =
        await sdk.getEventsCollectionsTopbidV1({
          collection: contractAddress,
          sortDirection: "desc",
          limit: 1,
          accept: "*/*",
        });

      // Getting the most recent top bid event
      const topBid = topBidResponse.events?.[0];

      // Log failure + continue to next contract if top bid event couldn't be pulled
      if (
        !topBid?.event?.id ||
        !topBid?.topBid?.price ||
        !topBid?.topBid?.maker
      ) {
        logger.error(`Could not pull top bid for ${contractAddress}`);
        continue;
      }

      // Pull cached top bid event id from Redis
      const cachedId: string | null = await redis.get(`bideventid_${contractAddress}`);

      // If most recent event matches cached event, skip to next contract
      if (Number(topBid.event.id) === Number(cachedId)) {
        continue;
      }

      // Pull cooldown for bid alert from Redis
      const eventCooldown: string | null = await redis.get(`bidcooldown_${contractAddress}`);

      // Pull cached top bid price from Redis
      const cachedPrice: string | null = await redis.get(`bidprice_${contractAddress}`);

      // If the cached price does not match the most recent price and process not on cooldown, generate alert
      if (Number(topBid.topBid.price) !== Number(cachedPrice) && !eventCooldown) {
        // Setting updated top bid event id
        const success: "OK" = await redis.set(`bideventid_${contractAddress}`, topBid.event.id);
        // Setting updated bid cooldown
        const cooldownSuccess: "OK" = await redis.set(
          `bidcooldown_${contractAddress}`,
          "true",
          "EX",
          constants.ALERT_COOLDOWN
        );

        // Log failure + continue if bid info couldn't be set
        if (success !== "OK" || cooldownSuccess !== "OK") {
          logger.error(`Could not set new top bid event id for ${contractAddress}`);
          continue;
        }

        // Getting top bid collection from Reservoir
        const bidCollectionResponse = await getCollection(
          undefined,
          contractAddress,
          1,
          true
        );

        // Getting top bid collection details
        const bidCollection = bidCollectionResponse?.[0];

        // Log failure + continue if collection details don't exist
        if (!bidCollection || !bidCollection.name) {
          logger.error(`Could not collect stats for ${contractAddress}`);
          continue;
        }

        // Generating top bid token Discord alert embed
        const bidEmbed = new EmbedBuilder()
          .setColor(0x8b43e0)
          .setTitle("New Top Bid!")
          .setAuthor({
            name: bidCollection.name,
            url: `https://reservoir.market/collections/${bidCollection.id}`,
            iconURL: bidCollection.image ?? constants.RESERVOIR_ICON,
          })
          .setDescription(
            `The top bid on the collection just changed to ${
              topBid.topBid.price
            }Ξ made by [${topBid.topBid.maker.substring(
              0,
              6
            )}](https://www.reservoir.market/address/${topBid.topBid.maker})`
          )
          .setThumbnail(bidCollection.image ?? constants.RESERVOIR_ICON)
          .setTimestamp();

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel("Accept offer")
            .setStyle(5)
            .setURL(
              `https://www.reservoir.market/collections/${topBid.topBid.contract}`
            )
        );

        // Sending top bid token Discord alert
        channel.send({ embeds: [bidEmbed], components: [row] });
        logger.info(
          `Successfully alerted new top bid by ${JSON.stringify(
            topBid.topBid.maker
          )} for contract ${contractAddress}`
        );
      }
    }
  } catch (e) {
    logger.error(`Error ${e} updating new top bid for multiple contracts`);
  }
}
