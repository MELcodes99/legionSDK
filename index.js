"use strict";

const { LegionSDK }                    = require("./src/LegionSDK");
const { LegionError, ErrorCodes }      = require("./src/errors");
const { validateFeeConfig, validatePublicKey } = require("./src/validators");
const {
  loadKeypairFromJSON,
  loadKeypairFromBase58,
  exportKeypairToJSON,
  exportKeypairToBase58,
  generateKeypair,
} = require("./src/wallet");

module.exports = {
  LegionSDK,
  LegionError,
  ErrorCodes,
  loadKeypairFromJSON,
  loadKeypairFromBase58,
  exportKeypairToJSON,
  exportKeypairToBase58,
  generateKeypair,
  validateFeeConfig,
  validatePublicKey,
};
