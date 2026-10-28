import { createClient } from '@supabase/supabase-js';
import { createHostedHandler, HOSTED_PROJECT_BYTES, type PublicConfig } from './hosted-service';

export function publicConfiguration(env: Record<string, string | undefined>): PublicConfig {
  const url = new URL(env.SUPABASE_URL ?? '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Invalid Supabase URL.');
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? '';
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publicKey && key.split('.').length === 3) {
    try {
      publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon';
    } catch {
      /* fail closed */
    }
  }
  if (!publicKey || key.length > 3000) throw new Error('A public Supabase publishable or legacy anon key is required.');
  return { mode: 'hosted', supabaseUrl: url.origin, publishableKey: key, projectBytes: HOSTED_PROJECT_BYTES };
}
export function productionHandler(env: Record<string, string | undefined>) {
  const config = publicConfiguration(env),
    secret = env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error('Server storage configuration is missing.');
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const auth = createClient(config.supabaseUrl, config.publishableKey, options);
  const admin = createClient(config.supabaseUrl, secret, options);
  return createHostedHandler({
    config,
    verify: async token => {
      const { data, error } = await auth.auth.getUser(token);
      return error ? null : data.user;
    },
    rpc: async (name, args) => {
      const { data, error } = await admin.rpc(name, args);
      if (error) throw new Error('Storage call failed.');
      return data;
    },
  });
}
