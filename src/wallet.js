"use strict";

const { Keypair } = require("@solana/web3.js");
const _bs58       = require("bs58");
const bs58        = _bs58.default || _bs58;
const { LegionError, ErrorCodes } = require("./errors");

/**
 * Load a Keypair from a Solana CLI wallet JSON array.
 * The JSON is an array of 64 numbers: [12, 34, 56, ...]
 *
 * @param {string | number[] | Uint8Array} json
 * @returns {Keypair}
 */
function loadKeypairFromJSON(json) {
  try {
    const arr = typeof json === "string" ? JSON.parse(json) : json;
    if (!Array.isArray(arr) && !(arr instanceof Uint8Array)) {
      throw new Error("Expected an array of bytes");
    }
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch (err) {
    throw new LegionError(
      "Failed to load keypair from JSON: " + err.message,
      ErrorCodes.INVALID_KEYPAIR,
      err
    );
  }
}

/**
 * Load a Keypair from a base-58 encoded private key string.
 * This is the format exported by Phantom and Solflare.
 *
 * @param {string} base58Key
 * @returns {Keypair}
 */
function loadKeypairFromBase58(base58Key) {
  try {
    if (!base58Key || typeof base58Key !== "string") {
      throw new Error("Key must be a non-empty string");
    }
    const decoded = bs58.decode(base58Key.trim());
    return Keypair.fromSecretKey(decoded);
  } catch (err) {
    throw new LegionError(
      "Failed to load keypair from base-58 key: " + err.message,
      ErrorCodes.INVALID_KEYPAIR,
      err
    );
  }
}

/**
 * Export a Keypair as a Solana CLI compatible JSON byte array string.
 * @param {Keypair} keypair
 * @returns {string}
 */
function exportKeypairToJSON(keypair) {
  return JSON.stringify(Array.from(keypair.secretKey));
}

/**
 * Export a Keypair as a base-58 encoded private key string.
 * @param {Keypair} keypair
 * @returns {string}
 */
function exportKeypairToBase58(keypair) {
  return bs58.encode(keypair.secretKey);
}

/**
 * Generate a brand new random Keypair.
 * @returns {{ keypair: Keypair, publicKey: string, secretKeyJSON: string, secretKeyBase58: string }}
 */
function generateKeypair() {
  const keypair = Keypair.generate();
  return {
    keypair,
    publicKey:       keypair.publicKey.toBase58(),
    secretKeyJSON:   exportKeypairToJSON(keypair),
    secretKeyBase58: exportKeypairToBase58(keypair),
  };
}

module.exports = {
  loadKeypairFromJSON,
  loadKeypairFromBase58,
  exportKeypairToJSON,
  exportKeypairToBase58,
  generateKeypair,
};
