"use strict";

/**
 * Example 1 — Free relay (relayer pays gas, no fee collected from user)
 * Run: node examples/01-free-relay.js
 */

const { LegionSDK } = require("../index");

async function main() {
  const legion = LegionSDK.fromPrivateKey({
    rpcUrl:            "https://api.devnet.solana.com",
    relayerPrivateKey: "YOUR_RELAYER_PRIVATE_KEY",
    // no fee config = free relay
  });

  const sig = await legion.relaySolTransfer({
    from:      "USER_PUBLIC_KEY",
    to:        "RECIPIENT_PUBLIC_KEY",
    amountSol: 0.001,
    // userKeypair: pass the user Keypair object for server-side signing
  });

  console.log("Confirmed:", sig);
  console.log("Solscan:", `https://solscan.io/tx/${sig}?cluster=devnet`);
}

main().catch(console.error);
