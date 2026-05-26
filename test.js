"use strict";

/**
 * Legion SDK — Terminal Test Script
 *
 * Tests the full relay flow with real SPL tokens on mainnet or devnet.
 *
 * HOW TO RUN:
 *   node test.js
 *
 * The script will ask for your private key and other details interactively.
 * Nothing is stored. Your key only lives in memory during the test.
 */

const readline = require("readline");
const { LegionSDK, loadKeypairFromBase58, generateKeypair } = require("./index");
const { PublicKey } = require("@solana/web3.js");

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));

const RPCS = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet:  "https://api.devnet.solana.com",
};

const COMMON_TOKENS = {
  "1": { name: "USDC",  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  "2": { name: "USDT",  mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",  decimals: 6 },
  "3": { name: "BONK",  mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5 },
  "4": { name: "JUP",   mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",  decimals: 6 },
  "5": { name: "Custom (enter mint address manually)", mint: null, decimals: null },
};

function line() { console.log("─".repeat(55)); }
function header(text) { line(); console.log(`  ${text}`); line(); }
function ok(text)   { console.log(`  ✅  ${text}`); }
function fail(text) { console.log(`  ❌  ${text}`); }
function info(text) { console.log(`  ℹ️   ${text}`); }
function warn(text) { console.log(`  ⚠️   ${text}`); }

function solscanLink(sig, network) {
  return network === "devnet"
    ? `https://solscan.io/tx/${sig}?cluster=devnet`
    : `https://solscan.io/tx/${sig}`;
}

// ─────────────────────────────────────────────────────────────
//  Individual test steps
// ─────────────────────────────────────────────────────────────

async function checkConnection(legion, network) {
  header("STEP 1 — Checking RPC connection");
  try {
    const { blockhash } = await legion.connection.getLatestBlockhash();
    const slot = await legion.connection.getSlot();
    ok(`Connected to ${network}`);
    info(`Slot     : ${slot.toLocaleString()}`);
    info(`Blockhash: ${blockhash.slice(0, 20)}...`);
    return true;
  } catch (err) {
    fail("RPC connection failed: " + err.message);
    return false;
  }
}

async function checkRelayerBalance(legion) {
  header("STEP 2 — Checking relayer wallet");
  const address = legion.getRelayerAddress();
  const balance = await legion.getRelayerBalance();
  info(`Relayer address : ${address}`);
  info(`Relayer balance : ${balance} SOL`);
  if (balance < 0.002) {
    warn("Balance is very low. Top up your relayer wallet before sending transactions.");
    warn("Minimum recommended: 0.01 SOL");
  } else {
    ok("Relayer has enough SOL to relay transactions.");
  }
  return balance;
}

async function checkUserTokens(legion, userPublicKey, network) {
  header("STEP 3 — Fetching user token accounts");
  try {
    const tokens = await legion.getTokenAccounts(userPublicKey);
    if (tokens.length === 0) {
      warn("No SPL token accounts found for this wallet on " + network);
    } else {
      ok(`Found ${tokens.length} token account(s):`);
      tokens.forEach((t, i) => {
        console.log(`\n    [${i + 1}] Mint    : ${t.mint}`);
        console.log(`         Balance : ${t.balance}`);
        console.log(`         ATA     : ${t.ata}`);
      });
    }
    return tokens;
  } catch (err) {
    fail("Could not fetch token accounts: " + err.message);
    return [];
  }
}

async function runTokenTransfer(legion, userKeypair, recipient, sendToken, feeToken, network) {
  header("STEP 4 — Relaying SPL token transfer");

  info(`Sending  : ${sendToken.amount} ${sendToken.name}`);
  info(`To       : ${recipient}`);
  if (feeToken) {
    info(`Fee      : ${feeToken.amount} ${feeToken.name} (collected by relayer)`);
  } else {
    info(`Fee      : none (free relay)`);
  }

  const confirm = await ask("\n  Proceed? (y/n): ");
  if (confirm.toLowerCase() !== "y") {
    info("Skipped by user.");
    return;
  }

  console.log("\n  Broadcasting...");
  try {
    const sig = await legion.relayTokenTransfer({
      from:        userKeypair.publicKey,
      to:          recipient,
      mint:        sendToken.mint,
      amount:      sendToken.amount,
      decimals:    sendToken.decimals,
      userKeypair,
      feeOverride: feeToken ? undefined : null,
    });

    ok("Transaction confirmed!");
    info(`Signature : ${sig}`);
    info(`Solscan   : ${solscanLink(sig, network)}`);
  } catch (err) {
    fail("Transaction failed: " + err.message);
    if (err.cause) console.log("  Cause:", err.cause.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  Main interactive flow
// ─────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔═════════════════════════════════════════════════════╗");
  console.log("║           Legion SDK  —  Terminal Test              ║");
  console.log("║      https://github.com/MELcodes99/legionSDK        ║");
  console.log("╚═════════════════════════════════════════════════════╝\n");

  // ── Network ────────────────────────────────────────────────
  console.log("  Which network?");
  console.log("    1. Mainnet (real tokens)");
  console.log("    2. Devnet  (test tokens)\n");
  const netChoice = await ask("  Enter 1 or 2 (default: 1): ");
  const network   = netChoice === "2" ? "devnet" : "mainnet";
  console.log(`\n  Using: ${network}\n`);

  // ── Relayer private key ─────────────────────────────────────
  line();
  console.log("  RELAYER WALLET (your backend wallet that pays gas)");
  console.log("  This is your base-58 private key from Phantom or Solflare.");
  console.log("  It stays in memory only and is never saved.\n");
  const relayerKey = await ask("  Paste relayer private key: ");

  let relayerKeypair;
  try {
    relayerKeypair = loadKeypairFromBase58(relayerKey);
    ok("Relayer keypair loaded.");
  } catch (err) {
    fail("Invalid private key: " + err.message);
    rl.close();
    process.exit(1);
  }

  // ── User private key ────────────────────────────────────────
  console.log("\n  USER WALLET (the wallet that sends tokens and pays the fee)");
  console.log("  This can be the same as the relayer for testing, or a different wallet.\n");
  const userKey = await ask("  Paste user private key: ");

  let userKeypair;
  try {
    userKeypair = loadKeypairFromBase58(userKey);
    ok("User keypair loaded.");
    info("User address: " + userKeypair.publicKey.toBase58());
  } catch (err) {
    fail("Invalid private key: " + err.message);
    rl.close();
    process.exit(1);
  }

  // ── Recipient ───────────────────────────────────────────────
  console.log("\n  RECIPIENT WALLET ADDRESS\n");
  const recipient = await ask("  Paste recipient wallet address: ");
  try {
    new PublicKey(recipient);
    ok("Recipient address valid.");
  } catch {
    fail("Invalid recipient address.");
    rl.close();
    process.exit(1);
  }

  // ── Token to send ───────────────────────────────────────────
  console.log("\n  TOKEN TO SEND\n");
  Object.entries(COMMON_TOKENS).forEach(([k, v]) => console.log(`    ${k}. ${v.name}`));
  const sendChoice = await ask("\n  Enter choice (1-5): ");
  let sendToken = COMMON_TOKENS[sendChoice] || COMMON_TOKENS["1"];
  if (!sendToken.mint) {
    sendToken = { ...sendToken };
    sendToken.mint     = await ask("  Enter mint address: ");
    sendToken.decimals = parseInt(await ask("  Enter decimals: "), 10);
    sendToken.name     = "Custom";
  }
  sendToken.amount = parseFloat(await ask(`  Amount to send (e.g. 0.01): `));

  // ── Fee token ───────────────────────────────────────────────
  console.log("\n  FEE TOKEN (collected by your relayer)\n");
  console.log("    1. Same token as send");
  console.log("    2. Different token");
  console.log("    3. Free (no fee collected)\n");
  const feeChoice = await ask("  Enter choice (1-3): ");

  let feeToken = null;
  if (feeChoice === "1") {
    const feeAmount = parseFloat(await ask(`  Fee amount in ${sendToken.name}: `));
    feeToken = { mint: sendToken.mint, decimals: sendToken.decimals, amount: feeAmount, name: sendToken.name };
  } else if (feeChoice === "2") {
    console.log("\n  Select fee token:");
    Object.entries(COMMON_TOKENS).forEach(([k, v]) => console.log(`    ${k}. ${v.name}`));
    const fc = await ask("\n  Enter choice (1-5): ");
    feeToken = { ...COMMON_TOKENS[fc] || COMMON_TOKENS["1"] };
    if (!feeToken.mint) {
      feeToken.mint     = await ask("  Enter mint address: ");
      feeToken.decimals = parseInt(await ask("  Enter decimals: "), 10);
      feeToken.name     = "Custom";
    }
    feeToken.amount = parseFloat(await ask(`  Fee amount in ${feeToken.name}: `));
  }

  // ── Build Legion instance ───────────────────────────────────
  const legion = new LegionSDK({
    rpcUrl: RPCS[network],
    relayerKeypair,
    fee: feeToken ? { mint: feeToken.mint, amount: feeToken.amount, decimals: feeToken.decimals } : null,
  });

  // ── Run tests ───────────────────────────────────────────────
  console.log("\n");
  const connected = await checkConnection(legion, network);
  if (!connected) { rl.close(); process.exit(1); }

  await checkRelayerBalance(legion);
  await checkUserTokens(legion, userKeypair.publicKey, network);
  await runTokenTransfer(legion, userKeypair, recipient, sendToken, feeToken, network);

  line();
  console.log("  Test complete.\n");
  rl.close();
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err.message);
  rl.close();
  process.exit(1);
});
