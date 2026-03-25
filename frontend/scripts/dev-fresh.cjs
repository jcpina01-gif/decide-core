/** Apaga `.next`, liberta 4701 e arranca dev (quando o cache bloqueia em "Starting..."). */
"use strict";
process.env.DECIDE_DEV_CLEAR_NEXT = "1";
require("./dev-4701.cjs");
