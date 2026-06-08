/** 共享 HTTP 工具。各域 api slot 与 api.ts 统一从此引入，避免循环依赖。 */
export async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}
