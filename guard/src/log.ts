import { redact } from "./model/redact.ts";

export type Logger = (level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) => void;

export const consoleLogger: Logger = (level, msg, extra) => {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
  (level === "error" ? console.error : console.log)(redact(line));
};

export const silentLogger: Logger = () => {};
