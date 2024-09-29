export default {
  RESERVOIR_ICON:
    "https://cdn.discordapp.com/icons/872790973309153280/0dc1b70867aeeb2ee32563f575c191c6.webp?size=4096",
  ALERT_COOLDOWN: 60 * 30, // 10-minute cooldown
  PRICE_CHANGE_OVERRIDE: 0.1, // 10% price change
  ALERT_ENABLED: { listings: false, sales: true, floor: false, bid: false, burn: true }, // enable alerts
  TRACKED_CONTRACTS: [
    "0x659A4BdaAaCc62d2bd9Cb18225D9C89b5B697A5A", // First contract
    "0x1d38150f1Fd989Fb89Ab19518A9C4E93C5554634", // Second contract
    "0xE7061488cE937012dadee6F82608cB5becaFF8D9", // Third contract
    // Add more contracts as needed
  ],
  CHANNEL_IDS: {
    mainChannel: "1288723481864962099",
    listingChannel: "1288723481864962099",
    salesChannel: "1288723481864962099",
  },
  // No longer a single contract reference, removing ALERT_CONTRACT.
  APPLICATION_ID: "1282716462355845273",
  REDIS_HOST: "redis",
  REDIS_PORT: 6379,
};
