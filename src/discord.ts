import {
  Client,
  GatewayIntentBits,
  ChannelType,
  Events,
  TextChannel,
  Message,
  EmbedBuilder,
} from "discord.js";
import logger from "./utils/logger";
import { floorPoll } from "./handlers/floorPoll";
import { bidPoll } from "./handlers/bidPoll";
import { listingPoll } from "./handlers/listingPoll";
import { burnAddressPoll } from "./handlers/burnAddressPool";
import { salePoll } from "./handlers/salesPoll";
import replyChatInteraction from "./interactions/chatInteractions";
import { replySelectInteraction } from "./interactions/selectInteractions";
import commandBuilder from "./utils/commands";
import Redis from "ioredis";
import constants from "./utils/constants";
import dotenv from 'dotenv';
import getTokenFromCollection from './handlers/getTokenFromCollection'; // Adjust the path based on your folder structure

interface Trait {
  key?: string;      // The key property might exist
  trait_type?: string; // The trait_type property might exist
  value: string;     // Value is mandatory
}

export default class Discord {
  private token: string;
  private apiKey: string;
  private redisURL: {};
  
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  constructor(token: string, apiKey: string, redisURL: {}) {
    this.token = token;
    this.apiKey = apiKey;
    this.redisURL = redisURL;
  }

  async poll(
    listingChannel: TextChannel,
    salesChannel: TextChannel,
    mainChannel: TextChannel,
    redis: Redis
  ): Promise<void> {
    await Promise.allSettled([
      listingPoll(listingChannel, constants.TRACKED_CONTRACTS, this.apiKey, redis),
      salePoll(salesChannel, constants.TRACKED_CONTRACTS, this.apiKey, redis),
      floorPoll(mainChannel, constants.TRACKED_CONTRACTS, this.apiKey, redis),
      bidPoll(mainChannel, constants.TRACKED_CONTRACTS, this.apiKey, redis),
      burnAddressPoll(mainChannel, constants.TRACKED_CONTRACTS, this.apiKey, redis),
    ]).then(() => {
      setTimeout(() => this.poll(listingChannel, salesChannel, mainChannel, redis), 1000);
    });
  }

  async handleEvents(): Promise<void> {
    await commandBuilder(constants.APPLICATION_ID, this.token);
    
    let redis: Redis;
    try {
      redis = new Redis(this.redisURL);
      logger.info("Redis connection established");
    } catch (error) {
      logger.error("Failed to connect to Redis", error);
      throw new Error("Redis connection failed");
    }

    this.client.on(Events.ClientReady, async () => {
      logger.info(`Discord bot is connected as ${this.client.user?.tag}`);

      const mainChannel = this.client.channels.cache.get(constants.CHANNEL_IDS.mainChannel) as TextChannel;
      const listingChannel = this.client.channels.cache.get(constants.CHANNEL_IDS.listingChannel) as TextChannel;
      const salesChannel = this.client.channels.cache.get(constants.CHANNEL_IDS.salesChannel) as TextChannel;

      if (!mainChannel || !listingChannel || !salesChannel) {
        logger.error("One or more channels could not be found");
        throw new Error("Channels not found");
      }

      this.poll(listingChannel, salesChannel, mainChannel, redis);
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      // Getting bot channel
      if (!interaction.channelId) {
        logger.error("Could not connect to channel");
        throw new Error("Could not connect to channel");
      }
      await this.client.channels.fetch(interaction.channelId);
      const channel = this.client.channels.cache.get(interaction.channelId);
      // Log failure + throw on channel not found
      if (!channel) {
        logger.error("Could not connect to channel");
        throw new Error("Could not connect to channel");
      }

      // Log failure + throw on incorrect channel type
      if (
        channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.DM
      ) {
        logger.error(
          `interaction called in unsupported ChannelType ${channel.type}`
        );
        return;
      }
      
      if (interaction.isChatInputCommand()) {
        // Handle user chat interaction
        await replyChatInteraction(interaction);
      } else if (interaction.isSelectMenu()) {
        // Handle user select menu interaction
        await replySelectInteraction(interaction, redis, channel);
      } else {
        // Log unknown interaction
        logger.error(`Unknown interaction passed: ${interaction}`);
      }
    });

    this.client.on('messageCreate', async (message: Message) => {
      if (message.author.bot || !message.guild) return; // Ignore bot messages and DMs
    
      // Listen for the "!tokenDetails" command
      if (message.content.startsWith('!tokenDetails')) {
        const args = message.content.split(' ');
        const contractAddress: string | undefined = args[1]; // Contract address passed after command
        const tokenId: string | undefined = args[2]; // Token ID passed after contract address
    
        // Check if contractAddress and tokenId are provided
        if (!contractAddress || !tokenId) {
          message.reply(
            'Please provide both a contract address and a token ID. Example: !tokenDetails <contractAddress> <tokenId>'
          );
          return;
        }
    
        try {
          console.log(`Fetching details for Contract: ${contractAddress}, Token ID: ${tokenId}`);
    
          // Fetch token details using the handler
          const tokenDetails = await getTokenFromCollection(contractAddress, tokenId);
          console.log('API Response:', tokenDetails);
    
          // Filter the response for the specific token ID
          const filteredTokens = tokenDetails.filter((token: any) => token.token.tokenId === tokenId);
    
          // Check if tokenDetails is undefined or an empty array
          if (!filteredTokens || filteredTokens.length === 0) {
            message.reply(
              `No details found for Token ID ${tokenId} in contract address ${contractAddress}`
            );
          } else {
            const tokenData = filteredTokens[0]; // Fetch only the token that matches the requested token ID
    
            // Check if tokenData.token exists
            if (!tokenData.token) {
              message.reply(`No details found for Token ID ${tokenId} in contract address ${contractAddress}`);
              return;
            }
    
            // Fetch the traits (if available)
            const traits: Trait[] = tokenData.token.attributes || []; // Assuming traits are in attributes array
            const traitsString = traits
              .map((trait: Trait) => `${trait.key || trait.trait_type}: ${trait.value}`) // Use either key or trait_type
              .join('\n') || 'None'; // If no traits, display 'None'
    
            // Extract the collection name if available
            const collectionName = tokenData.token.collection?.name || 'Unknown Collection';
    
            // Create the Embed message
            const embed = new EmbedBuilder()
              .setColor(0x808080)  // Set the color of the embed
              .setTitle(collectionName)
              .setDescription(`${tokenData.token.name || 'N/A'}`)
              /* .setDescription(`Token ID: ${tokenData.token.tokenId}`) */
              .addFields(
                { name: 'Story', value: tokenData.token.description || 'N/A' },
                { name: 'Traits', value: traitsString || 'None' }
              )
              .setImage(tokenData.token.image || '')  // Add the image if available
              .setFooter({ text: `Contract Address: ${contractAddress}` });
    
            // Send the embed as a reply
            message.reply({ embeds: [embed] });
          }
        } catch (error) {
          // Log the error and inform the user of the failure
          logger.error('Error fetching token details:', error);
          message.reply('Failed to fetch token details. Please check the contract address and token ID.');
        }
      }
    });
    
    await this.client.login(this.token);
  }
}
