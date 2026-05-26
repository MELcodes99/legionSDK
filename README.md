# Legion SDK

**Gas abstraction for Solana.**

Your backend wallet pays native SOL transaction fees on behalf of users. You optionally collect a fee in any SPL token, or make transactions completely free. Works for any transaction type — token transfers, prediction markets, DEX swaps, payment rails, position opens, NFT mints, program calls, anything.

---

## How it works

```
User builds a transaction
        │
        ▼
Legion prepends an SPL fee instruction (optional)
        │
        ▼
Relayer (your backend wallet) sets itself as feePayer and co-signs
        │
        ▼
Transaction hits Solana
Relayer pays the SOL gas fee
User pays zero SOL
Relayer receives your chosen SPL token fee (or nothing if free)
```

Everything is **atomic**. If the fee transfer fails, the whole transaction fails. There is no way for a user to get their transaction through without paying the configured fee.

---

## Installation

```bash
git clone https://github.com/MELcodes99/legionSDK.git
cd legionSDK
npm install
```

Requirements: Node.js 16 or higher.

---

## Setting up your relayer wallet

The relayer is your backend wallet. It pays SOL gas on behalf of your users and receives any SPL token fees you configure. You need to load it into the SDK using your private key.

This guide uses only the **base-58 private key method**, which works with Phantom and Solflare.

---

### Step 1 — Get your base-58 private key

**From Phantom:**

1. Open Phantom
2. Click the hamburger menu in the top left corner
3. Click **Settings**
4. Click **Security and Privacy**
5. Click **Export Private Key**
6. Enter your password
7. Copy the key shown on screen

It looks like a long string of random characters, for example: `4xKpN7bvHj2...`

**From Solflare:**

1. Open Solflare
2. Click **Settings** in the bottom right
3. Click **Export Wallet**
4. Choose **Private Key**
5. Enter your password and copy the key

---

### Step 2 — Create the wallet loader file

Inside your `legionSDK` folder, create a new file called `load-wallet.js`.

Open it in your text editor and paste this code:

```js
const { LegionSDK } = require("./index");

const legion = LegionSDK.fromPrivateKey({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  relayerPrivateKey: "PASTE_YOUR_PRIVATE_KEY_HERE",
  fee: {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount: 0.01,
    decimals: 6,
  },
});

async function main() {
  console.log("Relayer address:", legion.getRelayerAddress());
  console.log("Relayer SOL balance:", await legion.getRelayerBalance(), "SOL");
  console.log("Wallet loaded successfully.");
}

main().catch(console.error);
```

Replace `PASTE_YOUR_PRIVATE_KEY_HERE` with the key you copied in Step 1. Keep the quotes around it.

---

### Step 3 — Run it

```bash
node load-wallet.js
```

Expected output:

```
Relayer address: 7xKpN7...
Relayer SOL balance: 0.05 SOL
Wallet loaded successfully.
```

If you see your correct wallet address printed, the key loaded correctly and the SDK is ready to use.

---

### Step 4 — Move the key to an environment variable

Hardcoding the key in a file is fine for local testing but you should move it to an environment variable before using the SDK in production.

Create a file called `.env` in the root of your project:

```
RELAYER_PRIVATE_KEY=PASTE_YOUR_PRIVATE_KEY_HERE
```

Install dotenv:

```bash
npm install dotenv
```

Update your code to read from the environment:

```js
require("dotenv").config();
const { LegionSDK } = require("./index");

const legion = LegionSDK.fromPrivateKey({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY,
  fee: {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount: 0.01,
    decimals: 6,
  },
});
```

Add `.env` to your `.gitignore` so the key is never committed to GitHub:

```bash
echo ".env" >> .gitignore
```

> Never share your private key. Never commit it to Git. Anyone who has it has full control of that wallet.

---

## Running the test script

The test script walks you through a full live transaction interactively in your terminal. It asks for your keys at runtime and never saves them anywhere.

```bash
node test.js
```

The script will ask you:

- Which network (mainnet or devnet)
- Your relayer private key
- Your user private key (the wallet sending tokens)
- The recipient wallet address
- Which token to send and how much
- Whether to collect a fee, which token, and how much

It then checks your connection, fetches your token balances, and relays a real transaction on chain.

---

## Fee configuration

### Collect a fee in any SPL token

```js
const legion = new LegionSDK({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  relayerKeypair,
  fee: {
    mint:     "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amount:   0.01,
    decimals: 6,
  },
});
```

Common tokens:

| Token | Mint address | Decimals |
|-------|-------------|----------|
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 6 |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | 6 |
| BONK | `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` | 5 |
| JUP | `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN` | 6 |

### Make transactions free

```js
const legion = new LegionSDK({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  relayerKeypair,
  // omit fee entirely
});
```

### Override fee per call

```js
// Free for this specific call only
await legion.relay({ transaction, userKeypair, userPublicKey, feeOverride: null });

// Different token for this call
await legion.relay({
  transaction,
  userKeypair,
  userPublicKey,
  feeOverride: { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", amount: 1000, decimals: 5 },
});
```

---

## Relay any transaction

### Universal relay method

```js
const { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");

const tx = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: userPublicKey,
    toPubkey:   recipientPublicKey,
    lamports:   0.5 * LAMPORTS_PER_SOL,
  })
);

const signature = await legion.relay({
  transaction:   tx,
  userKeypair,
  userPublicKey,
});
```

### SOL transfer shorthand

```js
const sig = await legion.relaySolTransfer({
  from:      userKeypair.publicKey,
  to:        "RECIPIENT_ADDRESS",
  amountSol: 0.5,
  userKeypair,
});
```

### SPL token transfer shorthand

Automatically creates the recipient's Associated Token Account if it does not exist. The relayer pays for account creation.

```js
const sig = await legion.relayTokenTransfer({
  from:        userKeypair.publicKey,
  to:          "RECIPIENT_ADDRESS",
  mint:        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amount:      5,
  decimals:    6,
  userKeypair,
});
```

### Any arbitrary transaction

```js
const tx = new Transaction();
tx.add(myProtocolInstruction1);
tx.add(myProtocolInstruction2);

const sig = await legion.relay({
  transaction:   tx,
  userKeypair,
  userPublicKey: userKeypair.publicKey,
});
```

---

## Browser wallet adapter flow

Use this when the user's wallet lives in the browser (Phantom, Solflare, etc).

**Backend — prepare the transaction:**

```js
const prepared = await legion.prepareForClientSigning({
  transaction:   tx,
  userPublicKey: new PublicKey(req.body.userPublicKey),
});

res.json({
  serialized:           prepared.serialized,
  blockhash:            prepared.blockhash,
  lastValidBlockHeight: prepared.lastValidBlockHeight,
});
```

**Frontend — sign and submit:**

```js
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";

const { signTransaction } = useWallet();

const { serialized, blockhash, lastValidBlockHeight } = await fetch("/api/prepare", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userPublicKey: publicKey.toBase58() }),
}).then(r => r.json());

const tx = Transaction.from(Buffer.from(serialized, "base64"));

const signedTx = await signTransaction(tx);

const { signature } = await fetch("/api/submit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    serializedBase64:     signedTx.serialize().toString("base64"),
    blockhash,
    lastValidBlockHeight,
  }),
}).then(r => r.json());

console.log("Confirmed:", signature);
```

**Backend — submit:**

```js
const signature = await legion.submitSigned(
  req.body.serializedBase64,
  req.body.blockhash,
  req.body.lastValidBlockHeight
);

res.json({ signature });
```

---

## API reference

### `new LegionSDK(opts)`

| Option | Type | Required | Description |
|---|---|---|---|
| `rpcUrl` | string | yes | Solana RPC endpoint |
| `relayerKeypair` | Keypair | yes | Backend wallet that pays gas |
| `fee` | object or null | no | Fee config. Omit for free relay. |
| `fee.mint` | string | yes if fee | SPL token mint address |
| `fee.amount` | number | yes if fee | Human readable amount e.g. 0.1 |
| `fee.decimals` | number | yes if fee | Token decimals e.g. 6 for USDC |
| `commitment` | string | no | Default: confirmed |
| `maxRetries` | number | no | Default: 3 |

### `LegionSDK.fromPrivateKey(opts)`

Same as constructor but accepts `relayerPrivateKey` (base-58 string) instead of `relayerKeypair`.

### `LegionSDK.fromWalletJSON(opts)`

Same as constructor but accepts `relayerWalletJson` (JSON byte array) instead of `relayerKeypair`.

### `legion.relay(params)` → `Promise<string>`

| Param | Type | Description |
|---|---|---|
| `transaction` | Transaction | Pre-built transaction. Do not set feePayer or recentBlockhash. |
| `userPublicKey` | PublicKey or string | Always required. |
| `userKeypair` | Keypair | For server-side signing. |
| `feeOverride` | object or null | Override fee for this call. null means free. |

### `legion.relaySolTransfer(params)` → `Promise<string>`

Relay a native SOL transfer.

### `legion.relayTokenTransfer(params)` → `Promise<string>`

Relay an SPL token transfer. Auto-creates recipient ATA if missing.

### `legion.prepareForClientSigning(params)` → `Promise<object>`

Prepare a transaction for browser wallet signing. Returns `{ serialized, blockhash, lastValidBlockHeight }`.

### `legion.submitSigned(serializedBase64, blockhash, lastValidBlockHeight)` → `Promise<string>`

Broadcast a transaction already signed by the client wallet.

### `legion.getRelayerAddress()` → `string`

Returns the relayer's public key as a base-58 string.

### `legion.getRelayerBalance()` → `Promise<number>`

Returns the relayer's SOL balance. Keep this funded or relaying stops.

### `legion.getTokenAccounts(walletAddress)` → `Promise<Array>`

Returns all SPL token accounts for a wallet. Each entry contains `mint`, `balance`, `decimals`, and `ata`.

### Wallet utilities

```js
const {
  loadKeypairFromBase58,   // (base58: string) => Keypair
  loadKeypairFromJSON,     // (json: string | number[]) => Keypair
  exportKeypairToBase58,   // (keypair: Keypair) => string
  exportKeypairToJSON,     // (keypair: Keypair) => string
  generateKeypair,         // () => { keypair, publicKey, secretKeyJSON, secretKeyBase58 }
} = require("./index");
```

---

## Examples

| File | What it shows |
|---|---|
| `examples/01-free-relay.js` | Relay with no fee collected |
| `examples/02-spl-fee-relay.js` | Relay with USDC fee |
| `examples/03-browser-wallet-adapter.js` | Phantom and Solflare signing flow |

---

## Security

- Never expose your relayer private key on the frontend. All Legion logic runs on your backend server.
- Keep your relayer wallet funded with SOL. If it runs dry, relaying stops.
- Use environment variables for private keys in production.
- Add your `.env` file to `.gitignore` before your first commit.
- The fee instruction is atomic with the user transaction. A user cannot bypass the fee.
- Consider rate limiting your relay API endpoints to prevent abuse.

---
