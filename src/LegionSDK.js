"use strict";

const {
  Connection,
  PublicKey,
  Transaction,
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

const { LegionError, ErrorCodes } = require("./errors");
const { validateFeeConfig, validatePublicKey } = require("./validators");
const { loadKeypairFromJSON, loadKeypairFromBase58 } = require("./wallet");

class LegionSDK {
  constructor(opts) {
    opts = opts || {};
    if (!opts.rpcUrl) throw new LegionError("rpcUrl is required", ErrorCodes.INVALID_CONFIG);
    if (!opts.relayerKeypair) throw new LegionError("relayerKeypair is required", ErrorCodes.INVALID_CONFIG);

    this.connection = new Connection(opts.rpcUrl, opts.commitment || "confirmed");
    this.relayer    = opts.relayerKeypair;
    this.fee        = opts.fee ? validateFeeConfig(opts.fee) : null;
    this.commitment = opts.commitment || "confirmed";
    this.maxRetries = opts.maxRetries || 3;
  }

  static fromPrivateKey(opts) {
    opts = opts || {};
    if (!opts.relayerPrivateKey) throw new LegionError("relayerPrivateKey is required", ErrorCodes.INVALID_CONFIG);
    var keypair = loadKeypairFromBase58(opts.relayerPrivateKey);
    var rest = Object.assign({}, opts);
    delete rest.relayerPrivateKey;
    rest.relayerKeypair = keypair;
    return new LegionSDK(rest);
  }

  static fromWalletJSON(opts) {
    opts = opts || {};
    if (!opts.relayerWalletJson) throw new LegionError("relayerWalletJson is required", ErrorCodes.INVALID_CONFIG);
    var keypair = loadKeypairFromJSON(opts.relayerWalletJson);
    var rest = Object.assign({}, opts);
    delete rest.relayerWalletJson;
    rest.relayerKeypair = keypair;
    return new LegionSDK(rest);
  }

  async relay(params) {
    var transaction   = params.transaction;
    var userPublicKey = params.userPublicKey;
    var userKeypair   = params.userKeypair || null;
    var feeOverride   = params.feeOverride;

    var userPk = validatePublicKey(userPublicKey, "userPublicKey");
    var fee;
    if (feeOverride !== undefined) {
      fee = feeOverride ? validateFeeConfig(feeOverride) : null;
    } else {
      fee = this.fee;
    }

    var block = await this.connection.getLatestBlockhash(this.commitment);
    transaction.recentBlockhash = block.blockhash;
    transaction.feePayer = this.relayer.publicKey;

    if (fee) {
      var feeInstructions = await this._buildFeeInstructions(userPk, fee);
      for (var i = feeInstructions.length - 1; i >= 0; i--) {
        transaction.instructions.unshift(feeInstructions[i]);
      }
    }

    transaction.partialSign(this.relayer);
    if (userKeypair) transaction.partialSign(userKeypair);

    var rawTx = transaction.serialize();
    return this._sendWithRetry(rawTx, block);
  }

  async relaySolTransfer(params) {
    var fromPk   = validatePublicKey(params.from, "from");
    var toPk     = validatePublicKey(params.to, "to");
    var lamports = Math.round(params.amountSol * LAMPORTS_PER_SOL);

    var tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: fromPk, toPubkey: toPk, lamports: lamports })
    );

    return this.relay({ transaction: tx, userPublicKey: fromPk, userKeypair: params.userKeypair || null });
  }

  async relayTokenTransfer(params) {
    var fromPk    = validatePublicKey(params.from, "from");
    var toPk      = validatePublicKey(params.to, "to");
    var mintPk    = validatePublicKey(params.mint, "mint");
    var rawAmount = BigInt(Math.round(params.amount * Math.pow(10, params.decimals)));

    var fromATA = await getAssociatedTokenAddress(mintPk, fromPk);
    var toATA   = await getAssociatedTokenAddress(mintPk, toPk);

    var tx = new Transaction();

    var toATAInfo = await this.connection.getAccountInfo(toATA);
    if (!toATAInfo) {
      tx.add(createAssociatedTokenAccountInstruction(
        this.relayer.publicKey, toATA, toPk, mintPk
      ));
    }

    tx.add(createTransferInstruction(fromATA, toATA, fromPk, rawAmount, [], TOKEN_PROGRAM_ID));

    var feeOverride = params.feeOverride !== undefined ? params.feeOverride : undefined;
    return this.relay({ transaction: tx, userPublicKey: fromPk, userKeypair: params.userKeypair || null, feeOverride: 
feeOverride });
  }

  async prepareForClientSigning(params) {
    var transaction   = params.transaction;
    var userPublicKey = params.userPublicKey;
    var feeOverride   = params.feeOverride;

    var userPk = validatePublicKey(userPublicKey, "userPublicKey");
    var fee;
    if (feeOverride !== undefined) {
      fee = feeOverride ? validateFeeConfig(feeOverride) : null;
    } else {
      fee = this.fee;
    }

    var block = await this.connection.getLatestBlockhash(this.commitment);
    transaction.recentBlockhash = block.blockhash;
    transaction.feePayer = this.relayer.publicKey;

    if (fee) {
      var feeInstructions = await this._buildFeeInstructions(userPk, fee);
      for (var i = feeInstructions.length - 1; i >= 0; i--) {
        transaction.instructions.unshift(feeInstructions[i]);
      }
    }

    transaction.partialSign(this.relayer);

    return {
      serialized:           transaction.serialize({ requireAllSignatures: false }).toString("base64"),
      blockhash:            block.blockhash,
      lastValidBlockHeight: block.lastValidBlockHeight,
    };
  }

  async submitSigned(serializedBase64, blockhash, lastValidBlockHeight) {
    var rawTx = Buffer.from(serializedBase64, "base64");
    return this._sendWithRetry(rawTx, { blockhash: blockhash, lastValidBlockHeight: lastValidBlockHeight });
  }

  getRelayerAddress() {
    return this.relayer.publicKey.toBase58();
  }

  async getRelayerBalance() {
    var lamports = await this.connection.getBalance(this.relayer.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  async getTokenAccounts(walletAddress) {
    var pk = validatePublicKey(walletAddress, "walletAddress");
    var result = await this.connection.getParsedTokenAccountsByOwner(pk, {
      programId: TOKEN_PROGRAM_ID,
    });
    return result.value.map(function(acc) {
      var info = acc.account.data.parsed.info;
      return {
        mint:     info.mint,
        balance:  info.tokenAmount.uiAmountString,
        decimals: info.tokenAmount.decimals,
        ata:      acc.pubkey.toBase58(),
      };
    });
  }

  async _buildFeeInstructions(userPublicKey, fee) {
    var mintPk     = new PublicKey(fee.mint);
    var userATA    = await getAssociatedTokenAddress(mintPk, userPublicKey);
    var relayerATA = await getAssociatedTokenAddress(mintPk, this.relayer.publicKey);
    var instructions = [];

    var relayerATAInfo = await this.connection.getAccountInfo(relayerATA);
    if (!relayerATAInfo) {
      instructions.push(createAssociatedTokenAccountInstruction(
        this.relayer.publicKey, relayerATA, this.relayer.publicKey, mintPk
      ));
    }

    var rawFee = BigInt(Math.round(fee.amount * Math.pow(10, fee.decimals)));
    instructions.push(
      createTransferInstruction(userATA, relayerATA, userPublicKey, rawFee, [], TOKEN_PROGRAM_ID)
    );

    return instructions;
  }

  async _sendWithRetry(rawTx, block) {
    var blockhash            = block.blockhash;
    var lastValidBlockHeight = block.lastValidBlockHeight;
    var lastError;

    for (var attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await sendAndConfirmRawTransaction(
          this.connection,
          rawTx,
          { blockhash: blockhash, lastValidBlockHeight: lastValidBlockHeight, commitment: this.commitment }
        );
      } catch (err) {
        if (err.message && err.message.includes("already been processed")) {
          var _bs58  = require("bs58");
          var bs58lib = _bs58.default || _bs58;
          var tx  = Transaction.from(rawTx);
          var sig = tx.signatures[0] && tx.signatures[0].signature;
          return sig ? bs58lib.encode(sig) : "confirmed";
        }
        lastError = err;
        if (attempt < this.maxRetries) {
          await new Promise(function(r) { setTimeout(r, 500 * attempt); });
        }
      }
    }

    throw new LegionError(
      "Transaction failed after " + this.maxRetries + " attempts: " + (lastError && lastError.message),
      ErrorCodes.TRANSACTION_FAILED,
      lastError
    );
  }
}

module.exports = { LegionSDK };
