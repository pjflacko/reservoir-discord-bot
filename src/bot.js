const { Client, GatewayIntentBits } = require('discord.js');
const dotenv = require('dotenv');
const getTokenFromCollection = require('./getTokenFromCollection'); // The updated script to get tokens from a collection

dotenv.config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('ready', () => {
  console.log('Bot is online!');
});

client.on('messageCreate', async (message) => {
  // Ignore bot messages or DMs
  if (message.author.bot || !message.guild) return;

  // Listen for a command like "!tokenDetails"
  if (message.content.startsWith('!tokenDetails')) {
    const args = message.content.split(' ');
    const contractAddress = args[1]; // The contract address would be passed after the command

    if (!contractAddress) {
      message.reply('Please provide a contract address.');
      return;
    }

    try {
      // Fetch token details
      const tokenDetails = await getTokenFromCollection(contractAddress, 10); // Fetch 10 token details

      // Respond with the token details
      if (tokenDetails.length === 0) {
        message.reply(`No tokens found for contract address: ${contractAddress}`);
      } else {
        const tokenInfo = tokenDetails.map(
          (token, idx) => `#${idx + 1} Token ID: ${token.tokenId} Name: ${token.name || 'N/A'}`
        ).join('\n');
        message.reply(`Token Details:\n${tokenInfo}`);
      }
    } catch (error) {
      console.error('Error fetching token details:', error);
      message.reply('Failed to fetch token details. Please try again later.');
    }
  }
});

// Log in to Discord with the bot token
client.login(process.env.TOKEN);
