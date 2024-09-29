import Redis from "ioredis";
import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, TextChannel, ChannelType } from "discord.js";
import { paths } from "@reservoir0x/reservoir-kit-client";
import logger from "../utils/logger";
import constants from "../utils/constants";

const sdk = require("api")("@reservoirprotocol/v1.0#6e6s1kl9rh5zqg");

// Burn address to monitor (this is the burn address on Ethereum)
const BURN_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Check for tokens sent to the burn address
 * @param {TextChannel} channel - The Discord channel to send burn alerts
 * @param {string[]} contractArray - List of contracts to monitor
 * @param {string} apiKey - Reservoir API Key
 * @param {Redis} redis - Redis instance to store the last tracked burn event
 */
export async function burnAddressPoll(
  channel: TextChannel,
  contractArray: string[],
  apiKey: string,
  redis: Redis
) {
  if (!constants.ALERT_ENABLED.sales || contractArray.length <= 0) {
    return;
  }

  if (channel === undefined || channel.type !== ChannelType.GuildText) {
    logger.error("Burn address channel is not properly configured.");
    return;
  }

  try {
    // Authorize the Reservoir SDK
    await sdk.auth(apiKey);

    for (const contractAddress of contractArray) {
      // Fetch the latest token transfers to the burn address
      const transfersResponse: paths["/sales/v4"]["get"]["responses"]["200"]["schema"] = await sdk.getSalesV4({
        contract: [contractAddress],
        includeTokenMetadata: "true",
        limit: "100",
        accept: "*/*",
      });

      const transfers = transfersResponse.sales;

      if (!transfers) {
        logger.error(`Could not pull transfers for contract: ${contractAddress}`);
        continue;
      }

      // Retrieve the last tracked burn event from Redis
      const cachedId: string | null = await redis.get(`burnevent_${contractAddress}`);

      for (const transfer of transfers) {
        // Only track transfers where the recipient is the burn address
        if (transfer.to !== BURN_ADDRESS) {
          continue;
        }

        // Skip if we've already processed this transfer event
        if (transfer.saleId === cachedId) {
          continue;
        }

        // Ensure `saleId` is defined before storing it in Redis
        if (transfer.saleId) {
          // Cache the latest burn event in Redis
          await redis.set(`burnevent_${contractAddress}`, transfer.saleId);
        } else {
          logger.warn(`Transfer event for txHash ${transfer.txHash} does not have a saleId.`);
          continue;
        }

        // Prepare the data for the Discord alert
        const tokenName = transfer.token?.name || "Unknown Token";
        const tokenImage = transfer.token?.image || null;
        const collectionName = transfer.token?.collection?.name || "Unknown Collection";
        const burnTxHash = transfer.txHash;
        const burnPrice = transfer.price?.amount?.native || "N/A";
        const usdPrice = transfer.price?.amount?.usd || "N/A";

        // Create the embed for the Discord alert
        const burnEmbed = new EmbedBuilder()
          .setColor(0xff4500) // Set to a burn-related color
          .setTitle(`${tokenName} has been burned!`)
          .setDescription(`A token from the collection **${collectionName}** has been sent to the burn address.`)
          .addFields(
            { name: "Price", value: `${burnPrice}Ξ ($${usdPrice})`, inline: true },
            { name: "Transaction", value: `[View on Etherscan](https://etherscan.io/tx/${burnTxHash})`, inline: true }
          )
          .setTimestamp()
          .setFooter({ text: "Token Burn Event" });

        if (tokenImage) {
          burnEmbed.setThumbnail(tokenImage);
        }

        // Create a button to view the burn transaction on Etherscan
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel("View Burn Transaction")
            .setStyle(5)
            .setURL(`https://etherscan.io/tx/${burnTxHash}`)
        );

        // Send the burn alert to the Discord channel
        await channel.send({ embeds: [burnEmbed], components: [row] });

        logger.info(`Burn event for token ${tokenName} from collection ${collectionName} reported.`);
      }
    }
  } catch (e) {
    logger.error(`Error tracking burn events: ${JSON.stringify(e)}`);
  }
}
