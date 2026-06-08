import type { Express } from "express";
import { dataRouter } from "./data.ts";
import { engineRouter } from "./engine.ts";
import { vizRouter } from "./viz.ts";
import { sharedRouter } from "./shared.ts";

/**
 * 域路由注册器（绞杀者接缝层）。
 *
 * legacy 路由仍在 index.ts（冻结，归总控）。新功能路由一律进各域 slot：
 *   routes/data.ts (D) · routes/engine.ts (E) · routes/viz.ts (V) · routes/shared.ts (总控)
 *
 * index.ts 在 app.listen() 之前调用一次 registerDomainRoutes(app)。
 * 各域 router 路径不得与 legacy 路由冲突（用新路径或迁移后删除 legacy）。
 */
export function registerDomainRoutes(app: Express): void {
  app.use(dataRouter);
  app.use(engineRouter);
  app.use(vizRouter);
  app.use(sharedRouter);
}
