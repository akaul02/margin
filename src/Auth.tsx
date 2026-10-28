import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient, isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { LogOut } from 'lucide-react';
import cealLogo from './assets/ceal-logo.png';
import App from './App';
import { Field, ErrorBox } from './ui';
import { WorkspaceContext, type WorkspaceServices } from './WorkspaceContext';
import { createWorkspaceStorage } from './storage';
import { createCollaboration } from './collaboration';

type Config = { mode: 'hosted'; supabaseUrl: string; publishableKey: string };
type Binding = { token: string; controller: AbortController; services: WorkspaceServices; email: string };
export default function HostedApp() {
  const [config, setConfig] = useState<Config | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/config', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok)
          throw new Error('This hosted workspace is waiting for its Supabase setup. Your local Margin app is still available separately.');
        const c = await response.json();
        if (c.mode !== 'hosted' || !c.supabaseUrl || !c.publishableKey)
          throw new Error('The hosted workspace configuration is incomplete.');
        setConfig(c);
      })
      .catch(e => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  return config ? (
    <AccountWorkspace config={config} />
  ) : (
    <>
      <AuthHeader />
      <main className="auth-page">
        <div className="auth-card">
          <h1>{error ? 'Not set up yet' : 'Opening Margin…'}</h1>
          <ErrorBox error={error} />
        </div>
      </main>
    </>
  );
}
function AccountWorkspace({ config }: { config: Config }) {
  const client = useMemo(
    () =>
      createClient(config.supabaseUrl, config.publishableKey, {
        auth: { detectSessionInUrl: false, storageKey: `margin-auth:${config.supabaseUrl}` },
      }),
    [config],
  );
  const verification = useRef(0),
    signingOut = useRef(false);
  const [binding, setBinding] = useState<Binding | null>(null),
    current = useRef<Binding | null>(null);
  const [checking, setChecking] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  useEffect(() => {
    let mounted = true;
    const invalidate = () => {
      current.current?.controller.abort();
      current.current = null;
      if (mounted) setBinding(null);
    };
    async function verify(session: Session | null, epoch: number) {
      if (!session) {
        if (epoch === verification.current && mounted) {
          invalidate();
          setChecking(false);
        }
        return;
      }
      try {
        const { data, error: verificationError } = await client.auth.getUser(session.access_token);
        if (!mounted || verification.current !== epoch) return;
        if (
          verificationError &&
          isAuthRetryableFetchError(verificationError) &&
          current.current?.services.userId === session.user.id &&
          !current.current.controller.signal.aborted
        ) {
          setError('Offline: your writing stays in this browser. Sharing resumes after sign-in can be verified.');
          setChecking(false);
          return;
        }
        if (verificationError || !data.user) throw new Error('Your sign-in could not be verified. Sign in again when connected.');
        const id = data.user.id;
        if (current.current?.services.userId === id && !current.current.controller.signal.aborted) {
          current.current.token = session.access_token;
        } else {
          invalidate();
          const controller = new AbortController(),
            namespace = `${config.supabaseUrl}|${id}`;
          const next: Binding = {
            token: session.access_token,
            controller,
            email: data.user.email ?? '',
            services: { namespace, hosted: true, userId: id, storage: createWorkspaceStorage(namespace), collaboration: null! },
          };
          next.services.collaboration = createCollaboration({
            id,
            signal: controller.signal,
            token: async () => {
              if (controller.signal.aborted) throw new Error('Account changed.');
              return next.token;
            },
          });
          current.current = next;
          setBinding(next);
        }
        setError('');
        setChecking(false);
      } catch (e) {
        if (mounted && verification.current === epoch) {
          invalidate();
          setChecking(false);
          setError((e as Error).message);
        }
      }
    }
    const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
      const epoch = ++verification.current;
      if (signingOut.current && session) return;
      if (event === 'SIGNED_OUT' || !session || (current.current && session.user.id !== current.current.services.userId)) {
        invalidate();
        setChecking(!!session);
      }
      // Auth callbacks hold the SDK lock. Network verification runs afterwards.
      setTimeout(() => {
        if (mounted && epoch === verification.current) void verify(session, epoch);
      }, 0);
    });
    return () => {
      mounted = false;
      verification.current++;
      subscription.subscription.unsubscribe();
      invalidate();
    };
  }, [client, config]);
  async function signOut() {
    signingOut.current = true;
    verification.current++;
    setBusy(true);
    const old = current.current;
    old?.controller.abort();
    current.current = null;
    setBinding(null);
    setChecking(false);
    // Clear this browser's session. No server-wide signout of collaborators.
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) setError('Sign-out could not finish. Reload and check your account before continuing.');
    setBusy(false);
  }
  if (binding)
    return (
      <WorkspaceContext.Provider key={binding.services.namespace} value={binding.services}>
        <div className="account-bar" role="region" aria-label="Signed-in account">
          <span>
            Signed in as <strong>{binding.email || 'your lab account'}</strong>
          </span>
          <CopyId id={binding.services.userId} />
          {error && <span role="status">{error}</span>}
          <button onClick={() => void signOut()}>
            <LogOut size={15} />
            Sign out
          </button>
        </div>
        <App />
      </WorkspaceContext.Provider>
    );
  return (
    <>
      <AuthHeader />
      <main className="auth-page">
        <div className="auth-card">
          <h1>Sign in</h1>
          <p>Use the account your lab set up for you.</p>
          {checking ? (
            <p role="status">Checking your sign-in…</p>
          ) : (
            <form
              onSubmit={async e => {
                e.preventDefault();
                if (busy) return;
                signingOut.current = false;
                setBusy(true);
                setError('');
                const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
                setPassword('');
                if (error) setError('Sign-in failed. Check your email and password, then try again.');
                setBusy(false);
              }}
            >
              <Field label="Email">
                <input
                  autoComplete="username"
                  type="email"
                  required
                  value={email}
                  disabled={busy}
                  onChange={e => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Password">
                <input
                  autoComplete="current-password"
                  type="password"
                  required
                  value={password}
                  disabled={busy}
                  onChange={e => setPassword(e.target.value)}
                />
              </Field>
              <ErrorBox error={error} />
              <button className="primary" disabled={busy}>
                {busy ? (signingOut.current ? 'Signing out…' : 'Signing in…') : 'Sign in'}
              </button>
            </form>
          )}
          <p className="small muted">Projects stay in your browser until you share them with people you invite. No AI analysis.</p>
        </div>
      </main>
    </>
  );
}

function AuthHeader() {
  return (
    <header className="app-header">
      <span className="brand">
        <img className="brand-logo" src={cealLogo} alt="" />
        <span className="brand-name">Margin</span>
      </span>
    </header>
  );
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="text-button"
      title={id}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt('Your account ID', id);
        }
      }}
    >
      {copied ? 'Copied' : 'Copy my account ID'}
    </button>
  );
}
