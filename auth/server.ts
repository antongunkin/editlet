// Entry for Node (via `srvx serve`), Bun (`bun run server.ts`) and Deno (`deno serve server.ts`).
// Configuration comes from environment variables.
import { handleRequest, type Env } from './handler.ts';

export default {
  fetch: (request: Request): Promise<Response> => handleRequest(request, process.env as Env),
};
