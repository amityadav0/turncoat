import express, { type Request, type Response } from "express";
import type { GuardService, Reply } from "./service.ts";
import type { ModelAdapter } from "./model/index.ts";
import type { RateLimiter } from "./ratelimit.ts";
import { practice, type PracticeLevel } from "./practice.ts";
import { redact } from "./model/redact.ts";
import type { Logger } from "./log.ts";

export interface AppDeps {
  service: GuardService;
  model: ModelAdapter;
  practiceLevels: Map<number, PracticeLevel>;
  practiceLimiter: RateLimiter;
  maxTurns: number;
  trustProxy?: string | boolean | number;
  /** Origins allowed by CORS (the public site). Empty = no CORS headers. "*" allows any. */
  corsOrigins?: string[];
  log: Logger;
}

export function createApp(d: AppDeps) {
  const app = express();
  if (d.trustProxy !== undefined) app.set("trust proxy", d.trustProxy);
  app.disable("x-powered-by");
  const origins = d.corsOrigins ?? [];
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (origins.includes("*") || origins.includes(origin))) {
      res.set("Access-Control-Allow-Origin", origins.includes("*") ? "*" : origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Methods", "GET, POST");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.set("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    next();
  });
  app.use(express.json({ limit: "32kb" }));

  const handle = (fn: (req: Request) => Promise<Reply>) => async (req: Request, res: Response) => {
    try {
      const r = await fn(req);
      res.status(r.code).json(r.body);
    } catch (e) {
      d.log("error", "request failed", { path: req.path, error: redact(String((e as Error)?.message ?? e)) });
      res.status(500).json({ error: "internal error" });
    }
  };

  app.get("/health", (_req, res) => { res.json({ ok: true, model: d.model.id }); });
  app.post("/attempts", handle((req) => d.service.submit(req.body)));
  app.get("/attempts/:roundId/:attemptId", handle((req) => d.service.getAttempt(String(req.params.roundId), String(req.params.attemptId))));
  app.get("/rounds", handle(() => d.service.listRounds()));
  app.get("/rounds/current", handle(() => d.service.currentRound()));
  app.get("/rounds/live", handle(() => d.service.liveRounds()));
  app.get("/rounds/:id", handle((req) => d.service.getRound(String(req.params.id))));
  app.get("/rounds/:id/attempts", handle((req) => d.service.listAttempts(String(req.params.id), typeof req.query.after === "string" ? req.query.after : undefined)));
  app.get("/attackers/:address", handle((req) => d.service.getAttacker(String(req.params.address))));
  app.post("/practice", async (req, res) => {
    const wait = d.practiceLimiter.take(req.ip ?? "unknown");
    if (wait > 0) { res.set("Retry-After", String(wait)).status(429).json({ error: "practice rate limit reached", retryAfterSeconds: wait }); return; }
    return handle((r) => practice(r.body, d.practiceLevels, d.model, d.maxTurns))(req, res);
  });

  // Malformed JSON and other body-parser errors.
  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: unknown) => {
    res.status(err.status && err.status < 500 ? err.status : 500).json({ error: err.status && err.status < 500 ? "bad request body" : "internal error" });
  });
  return app;
}
