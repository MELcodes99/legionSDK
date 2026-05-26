"use strict";

const {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmRawTransaction,
} = require("@solana/web3.js");

const {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");

const { LegionError, ErrorCodes }        = require("./errors");
const { validateFeeConfig, validatePublicKey } = require("./validators");
const { loadKeypairFromJSON, loadKeypairFromBase58 } = 
require("./wallet");

class LegionSDK {
  /**
   * Create a LegionSDK instance.
   *
   * @param {object}  opts
   * @param {string}  opts.rpcUrl          - Solana RPC endpoint URL
   * @param {Keypair} opts.relayerKeypair  - Your backend wallet (pays SOL 
gas, receives fee)
   * @param {object}  [opts.fee]           - Fee config. Omit or set null 
for free relaying.
   * @param {string}  opts.fee.mint        - Mint address of the SPL token 
to collect as fee
   * @param {number}  opts.fee.amount      - Human readable fee amount 
e.g. 0.1 for 0.1 USDC
   * @param {number}  opts.fee.decimals    - Decimals of the fee token 
e.g. 6 for USDC
   * @param {string}  [opts.commitment]    - Commitment level. Default: 
"confirmed"
   * @param {number}  [opts.maxRetries]    - Max broadcast retries. 
Default: 3
   */
  constructor(opts = {}) {
    if (!opts.rpcUrl)         throw new LegionError("rpcUrl is required",         
ErrorCodes.INVALID_CONFIG);
    if (!opts.relayerKeypair) throw new LegionError("relayerKeypair is 
required", ErrorCodes.INVALID_CONFIG);

    this.connection  = new Connection(opts.rpcUrl, opts.commitment || 
"confirmed");
    this.relayer     = opts.relayerKeypair;
    this.fee         = opts.fee ? validateFeeConfig(opts.fee) : null;
    this.commitment  = opts.commitment || "confirmed";
    this.maxRetries  = opts.maxRetries || 3;
  }

  //  Static factory methods

  /**
   * Create a LegionSDK instance from a base-58 private key.
   * This is the format Phantom and Solflare export.
   *
   * @param {object} opts
   * @param {string} opts.relayerPrivateKey  - Base-58 encoded private key 
string
   * @param {string} opts.rpcUrl
   * @param {object} [opts.fee]
   */
  static fromPrivateKey(opts = {}) {
    const { relayerPrivateKey, ...rest } = opts;
    if (!relayerPrivateKey) throw new LegionError("relayerPrivateKey is 
required", ErrorCodes.INVALID_CONFIG);
    const keypair = loadKeypairFromBase58(relayerPrivateKey);
    return new LegionSDK({ ...rest, relayerKeypair: keypair });
  }

  /**
   * Create a LegionSDK instance from a Solana CLI wallet JSON array.
   *
   * @param {object}               opts
   * @param {string|number[]|Uint8Array} opts.relayerWalletJson - JSON 
byte array
   * @param {string}               opts.rpcUrl
   * @param {object}               [opts.fee]
   */
  static fromWalletJSON(opts = {}) {
    const { relayerWalletJson, ...rest } = opts;
    if (!relayerWalletJson) throw new LegionError("relayerWalletJson is 
required", ErrorCodes.INVALID_CONFIG);
    const keypair = loadKeypairFromJSON(relayerWalletJson);
    return new LegionSDK({ ...rest, relayerKeypair: keypair });
  }

  //  Core relay method

  /**
   * Relay any Solana transaction on behalf of a user.
   *
   * The relayer:
   *   1. Optionally prepends an SPL token fee instruction
   *   2. Sets itself as feePayer (pays native SOL gas)
   *   3. Co-signs with the user
   *   4. Broadcasts and confirms the transaction
   *
   * @param {object}       params
   * @param {Transaction}  params.transaction      - Pre-built transaction 
with user instructions.
   *                                                 Do NOT set feePayer 
or recentBlockhash.
   * @param {PublicKey}    params.userPublicKey     - User's public key. 
Always required.
   * @param {Keypair}      [params.userKeypair]     - User keypair for 
server-side signing.
   * @param {object}       [params.feeOverride]     - Override instance 
fee for this call.
   *                                                 Pass null to make 
this specific call free.
   * @returns {Promise<string>} Transaction signature
   */
  async relay({ transaction, userPublicKey, userKeypair = null, 
feeOverride }) {
    const userPk = validatePublicKey(userPublicKey, "userPublicKey");
    const fee    = feeOverride !== undefined
      ? (feeOverride ? validateFeeConfig(feeOverride) : null)
      : this.fee;

    const { blockhash, lastValidBlockHeight } = await 
this.connection.getLatestBlockhash(this.commitment);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer        = this.relayer.publicKey;

    if (fee) {
      const feeInstructions = await this._buildFeeInstructions(userPk, 
fee);
      transaction.instructions.unshift(...feeInstructions);
    }

    transaction.partialSign(this.relayer);
    if (userKeypair) transaction.partialSign(userKeypair);

    const rawTx    = transaction.serialize();
    const signature = await this._sendWithRetry(rawTx, { blockhash, 
lastValidBlockHeight });
    return signature;
  }

  //  Convenience methods

  /**
   * Relay a native SOL transfer.
   *
   * @param {object}           params
   * @param {PublicKey|string} params.from        - Sender public key
   * @param {PublicKey|string} params.to          - Recipient public key
   * @param {number}           params.amountSol   - Amount in SOL e.g. 0.5
   * @param {Keypair}          [params.userKeypair]
   * @returns {Promise<string>}
   */
  async relaySolTransfer({ from, to, amountSol, userKeypair = null }) {
    const fromPk  = validatePublicKey(from, "from");
    const toPk    = validatePublicKey(to, "to");
    const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);

    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: fromPk, toPubkey: toPk, 
lamports })
    );

    return this.relay({ transaction: tx, userPublicKey: fromPk, 
userKeypair });
  }

  /**
   * Relay an SPL token transfer.
   * Automatically creates the recipient's Associated Token Account if it 
does not exist.
   * The relayer pays for ATA creation.
   *
   * @param {object}           params
   * @param {PublicKey|string} params.from        - Sender public key
   * @param {PublicKey|string} params.to          - Recipient public key
   * @param {PublicKey|string} params.mint        - Token mint address
   * @param {number}           params.amount      - Human readable amount 
e.g. 5 for 5 USDC
   * @param {number}           params.decimals    - Token decimals e.g. 6 
for USDC
   * @param {Keypair}          [params.userKeypair]
   * @returns {Promise<string>}
   */
  async relayTokenTransfer({ from, to, mint, amount, decimals, userKeypair 
= null }) {
    const fromPk   = validatePublicKey(from, "from");
    const toPk     = validatePublicKey(to, "to");
    const mintPk   = validatePublicKey(mint, "mint");
    const rawAmount = BigInt(Math.round(amount * Math.pow(10, decimals)));

    const fromATA = await getAssociatedTokenAddress(mintPk, fromPk);
    const toATA   = await getAssociatedTokenAddress(mintPk, toPk);

    const tx = new Transaction();

    const toATAInfo = await this.connection.getAccountInfo(toATA);
    if (!toATAInfo) {
      tx.add(createAssociatedTokenAccountInstruction(
        this.relayer.publicKey,
        toATA,
        toPk,
        mintPk
      ));
    }

    tx.add(createTransferInstruction(fromATA, toATA, fromPk, rawAmount, 
[], TOKEN_PROGRAM_ID));

    return this.relay({ transaction: tx, userPublicKey: fromPk, 
userKeypair });
  }

  //  Client-side (browser wallet adapter) two-step flow

  /**
   * Prepare a transaction for browser wallet signing (Phantom, Solflare 
etc).
   * Call this on your backend. Return the result to the frontend.
   * The frontend signs it, then calls submitSigned().
   *
   * @param {object}      params
   * @param {Transaction} params.transaction
   * @param {PublicKey}   params.userPublicKey
   * @param {object}      [params.feeOverride]
   * @returns {Promise<{ serialized: string, blockhash: string, 
lastValidBlockHeight: number }>}
   */
  async prepareForClientSigning({ transaction, userPublicKey, feeOverride 
}) {
    const userPk = validatePublicKey(userPublicKey, "userPublicKey");
    const fee    = feeOverride !== undefined
      ? (feeOverride ? validateFeeConfig(feeOverride) : null)
      : this.fee;

    const { blockhash, lastValidBlockHeight } = await 
this.connection.getLatestBlockhash(this.commitment);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer        = this.relayer.publicKey;

    if (fee) {
      const feeInstructions = await this._buildFeeInstructions(userPk, 
fee);
      transaction.instructions.unshift(...feeInstructions);
    }

    transaction.partialSign(this.relayer);

    return {
      serialized:           transaction.serialize({ requireAllSignatures: 
false }).toString("base64"),
      blockhash,
      lastValidBlockHeight,
    };
  }

  /**
   * Submit a transaction that has been signed by the client wallet.
   *
   * @param {string} serializedBase64
   * @param {string} blockhash
   * @param {number} lastValidBlockHeight
   * @returns {Promise<string>} Transaction signature
   */
  async submitSigned(serializedBase64, blockhash, lastValidBlockHeight) {
    const rawTx = Buffer.from(serializedBase64, "base64");
    return this._sendWithRetry(rawTx, { blockhash, lastValidBlockHeight 
});
  }

  //  Utility methods

  /** Returns the relayer's public key as a base-58 string */
  getRelayerAddress() {
    return this.relayer.publicKey.toBase58();
  }

  /** Returns the relayer's current SOL balance */
  async getRelayerBalance() {
    const lamports = await 
this.connection.getBalance(this.relayer.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  /**
   * Fetch all SPL token accounts owned by a wallet.
   * Useful for building token selectors in your UI.
   *
   * @param {PublicKey|string} walletAddress
   * @returns {Promise<Array<{ mint: string, balance: string, decimals: 
number, ata: string }>>}
   */
  async getTokenAccounts(walletAddress) {
    const pk = validatePublicKey(walletAddress, "walletAddress");
    const { value } = await 
this.connection.getParsedTokenAccountsByOwner(pk, {
      programId: TOKEN_PROGRAM_ID,
    });
    return value.map((acc) => {
      const info = acc.account.data.parsed.info;
      return {
        mint:     info.mint,
        balance:  info.tokenAmount.uiAmountString,
        decimals: info.tokenAmount.decimals,
        ata:      acc.pubkey.toBase58(),
      };
    });
  }

  //  Private helpers

  async _buildFeeInstructions(userPublicKey, fee) {
    const mintPk      = new PublicKey(fee.mint);
    const userATA     = await getAssociatedTokenAddress(mintPk, 
userPublicKey);
    const relayerATA  = await getAssociatedTokenAddress(mintPk, 
this.relayer.publicKey);
    const instructions = [];

    const relayerATAInfo = await 
this.connection.getAccountInfo(relayerATA);
    if (!relayerATAInfo) {
      instructions.push(createAssociatedTokenAccountInstruction(
        this.relayer.publicKey,
        relayerATA,
        this.relayer.publicKey,
        mintPk
      ));
    }

    const rawFee = BigInt(Math.round(fee.amount * Math.pow(10, 
fee.decimals)));
    instructions.push(
      createTransferInstruction(userATA, relayerATA, userPublicKey, 
rawFee, [], TOKEN_PROGRAM_ID)
    );

    return instructions;
  }

  async _sendWithRetry(rawTx, { blockhash, lastValidBlockHeight }) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await sendAndConfirmRawTransaction(
          this.connection,
          rawTx,
          { blockhash, lastValidBlockHeight, commitment: this.commitment }
        );
      } catch (err) {
        // "already processed" means tx succeeded on a previous attempt — 
treat as success
        if (err.message && err.message.includes("already been processed")) 
{
          const { Transaction } = require("@solana/web3.js");
          const _bs58 = require("bs58");
          const bs58lib = _bs58.default || _bs58;
          const tx = Transaction.from(rawTx);
          const sig = tx.signatures[0]?.signature;
          return sig ? bs58lib.encode(sig) : "confirmed";
        }
        lastError = err;
        if (attempt < this.maxRetries) await new Promise((r) => 
setTimeout(r, 500 * attempt));
      }
    }
    throw new LegionError(
      `Transaction failed after ${this.maxRetries} attempts: 
${lastError?.message}`,
      ErrorCodes.TRANSACTION_FAILED,
      lastError
    );
  }
}

module.exports = { LegionSDK };
