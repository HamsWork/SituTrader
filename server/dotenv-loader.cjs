"use strict";
// Load .env only when not running on Replit (Replit uses its own secrets/env).
var isReplit = process.env.REPL_ID != null || process.env.REPL_SLUG != null;
if (!isReplit) {
  require("dotenv").config();
}
