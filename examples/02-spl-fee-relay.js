"use strict";

/**
 * Example 2 — Relay with SPL token fee (USDC)
 * Run: node examples/02-spl-fee-relay.js
 */

const { LegionSDK, loadKeypairFromBase58 } = require("../index");

async function main() {
  const relayerKeypair = loadKeypairFromBase58("YOUR_RELAYER_PRIVATE_KEY");
  const userKeypair    = loadKeypairFromBase58("YOUR_USER_PRIVATE_KEY");

  const legion = new LegionSDK({
    rpcUrl:          "https://api.mainnet-beta.solana.com",
    relayerKeypair,
    fee: {
      mint:     "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount:   0.01,
      decimals: 6,
    },
  });

  const sig = await legion.relayTokenTransfer({
    from:        userKeypair.publicKey,
    to:          "RECIPIENT_PUBLIC_KEY",
    mint:        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount:      0.1,
    decimals:    6,
    userKeypair,
  });

  console.log("Confirmed:", sig);
  console.log("Solscan:", `https://solscan.io/tx/${sig}`);
}

main().catch(console.error);
