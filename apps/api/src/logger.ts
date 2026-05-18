import { pino } from "pino";
import { env, isProd } from "./env.js";

export const logger = pino({
  level: isProd ? "info" : "debug",
  transport: isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
      },
  base: { service: "fbm-api", env: env.NODE_ENV },
});
