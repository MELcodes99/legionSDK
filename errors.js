"use strict";

const ErrorCodes = {
  INVALID_CONFIG:      "INVALID_CONFIG",
  INVALID_WALLET:      "INVALID_WALLET",
  INVALID_FEE_CONFIG:  "INVALID_FEE_CONFIG",
  INVALID_KEYPAIR:     "INVALID_KEYPAIR",
  TRANSACTION_FAILED:  "TRANSACTION_FAILED",
};

class LegionError extends Error {
  constructor(message, code = "UNKNOWN", cause = null) {
    super(message);
    this.name   = "LegionError";
    this.code   = code;
    this.cause  = cause;
  }
}

module.exports = { LegionError, ErrorCodes };
