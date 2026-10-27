import { productionHandler } from '../server/supabase';
let handler: ReturnType<typeof productionHandler> | undefined;
export default {
  async fetch(request: Request) {
    try { handler ??= productionHandler(process.env); return await handler(request); }
    catch { return Response.json({ error: 'hosted_setup_required' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  },
};
