import dotenv from 'dotenv';
const sdk = require("api")("@reservoirprotocol/v1.0#6e6s1kl9rh5zqg");

/**
 * Retrieve details of a specific token from a collection
 * @param {string} contractAddress The contract address of the collection
 * @param {string} tokenId The token ID to fetch details for
 * @returns {Promise<array>} Array of token details
 */
// Utility function for delay
// Utility function for delay
function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  export default async function getTokenFromCollection(contractAddress: string, tokenId: string) {
    if (!contractAddress || !tokenId) {
      throw new Error("Contract address and Token ID must be provided.");
    }
  
    try {
      dotenv.config();
      await sdk.auth(process.env.RESERVOIR_API_KEY);
  
      let response;
      let tokens: any[] = [];
      let continuationToken: string | null = null;
      let retryCount = 0;
      const maxRetries = 5;
      const retryDelay = 1000; // Start with 1 second delay
  
      do {
        try {
          // Make the API request
          response = await sdk.getTokensV5({
            contract: contractAddress,
            tokenIds: [tokenId],
            continuation: continuationToken || undefined,
            accept: "*/*",
          });
  
          // Add the tokens to the result array
          if (response.tokens && response.tokens.length > 0) {
            tokens.push(...response.tokens);
          }
  
          // Check if there's a continuation token
          continuationToken = response.continuation || null;
        } catch (error) {
          // Type narrowing for error
          if (isAxiosError(error) && error.response?.status === 429) { // Too Many Requests error
            if (retryCount < maxRetries) {
              retryCount++;
              const backoffTime = retryDelay * Math.pow(2, retryCount); // Exponential backoff
              console.log(`Rate limited. Retrying in ${backoffTime / 1000} seconds...`);
              await delay(backoffTime); // Wait before retrying
            } else {
              throw new Error("Max retries reached. Please wait before trying again.");
            }
          } else {
            throw error; // For other errors, just rethrow
          }
        }
      } while (continuationToken && retryCount < maxRetries);
  
      return tokens.length > 0 ? tokens : [];
    } catch (error) {
      console.error(`Error fetching token details for contractAddress=${contractAddress}, tokenId=${tokenId}`, error);
      throw error;
    }
  }
  
  // Utility function to check if error is an Axios error and has a status code
  function isAxiosError(error: any): error is { response: { status: number } } {
    return error && error.response && typeof error.response.status === "number";
  }
  
  
  