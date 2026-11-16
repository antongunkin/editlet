// Cloudflare Workers entry (`wrangler deploy`). Configuration comes from the Worker's vars and secrets.
import { handleRequest, type Env } from './handler.ts';

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleRequest(request, env),
};
