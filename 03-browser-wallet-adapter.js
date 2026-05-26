"use strict";

/**
 * Example 3 — Browser wallet adapter flow (Phantom / Solflare)
 *
 * Use this pattern when the user signs in the browser.
 * Your backend prepares the transaction, the frontend signs it,
 * then your backend submits it.
 */

// ── BACKEND (Node.js / Express) ──────────────────────────────────────────────

const { LegionSDK, loadKeypairFromBase58 } = require("../index");
const { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");

async function backendPrepare({ userPublicKey, recipientAddress, amountSol }) {
  const legion = LegionSDK.fromPrivateKey({
    rpcUrl:            "https://api.mainnet-beta.solana.com",
    relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY,
    fee: {
      mint:     "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount:   0.01,
      decimals: 6,
    },
  });

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(userPublicKey),
      toPubkey:   new PublicKey(recipientAddress),
      lamports:   Math.round(amountSol * LAMPORTS_PER_SOL),
    })
  );

  // Relayer pre-signs. Fee instruction prepended.
  return legion.prepareForClientSigning({
    transaction:   tx,
    userPublicKey: new PublicKey(userPublicKey),
  });
}

async function backendSubmit({ serializedBase64, blockhash, lastValidBlockHeight }) {
  const legion = LegionSDK.fromPrivateKey({
    rpcUrl:            "https://api.mainnet-beta.solana.com",
    relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY,
  });
  return legion.submitSigned(serializedBase64, blockhash, lastValidBlockHeight);
}

// ── FRONTEND (React + wallet adapter) ───────────────────────────────────────
//
// import { useWallet } from "@solana/wallet-adapter-react";
// import { Transaction } from "@solana/web3.js";
//
// const { signTransaction } = useWallet();
//
// async function handleSend() {
//   // 1. Backend prepares
//   const { serialized, blockhash, lastValidBlockHeight } = await fetch("/api/prepare", {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ userPublicKey: publicKey.toBase58(), recipientAddress, amountSol }),
//   }).then(r => r.json());
//
//   // 2. Deserialise
//   const tx = Transaction.from(Buffer.from(serialized, "base64"));
//
//   // 3. Wallet popup — user approves (shows fee + main tx)
//   const signedTx = await signTransaction(tx);
//
//   // 4. Backend submits
//   const { signature } = await fetch("/api/submit", {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({
//       serializedBase64: signedTx.serialize().toString("base64"),
//       blockhash,
//       lastValidBlockHeight,
//     }),
//   }).then(r => r.json());
//
//   console.log("Confirmed:", signature);
// }

module.exports = { backendPrepare, backendSubmit };
