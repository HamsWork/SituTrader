"use strict";
// Load .env only when not running on Replit (Replit uses its own secrets/env).
if (!process.env.REPL_ID) {
  require("dotenv").config();
}
