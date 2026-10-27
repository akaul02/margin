import { useEffect, useState } from 'react';
import { UsersRound, ArrowDownToLine } from 'lucide-react';
import { useWorkspaceServices } from './WorkspaceContext';
import { Dialog, ErrorBox, Field } from './ui';
import { download, exportProject, type Project } from './model';
import type { CollaborationControls } from './Board';

type Member = { userId: string; role: 'owner' | 'editor' };
export function HostedHandoffDialog({
  project,
  collaboration,
  close,
}: {
  project: Project;
  collaboration: CollaborationControls;
  close: () => void;
}) {
  const { userId, collaboration: api } = useWorkspaceServices();
  const [members, setMembers] = useState<Member[] | null>(null),
    [role, setRole] = useState(''),
    [person, setPerson] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const room = collaboration.connection?.roomId;
  useEffect(() => {
    let active = true;
    if (room)
      void api
        .readRoom(room)
        .then(async r => {
          if (!active) return;
          setRole(r.role ?? '');
          if (r.role === 'owner') {
            const data = await api.members(room);
            if (active) setMembers(data.members);
          }
        })
        .catch(e => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [room]);
  async function membership(method: 'POST' | 'DELETE', id: string) {
    if (!room || busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await api.members(room, method, id);
      setMembers(data.members);
      setPerson('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      wide
      title="Work together"
      close={() => {
        if (!busy) close();
      }}
    >
      <section className="share-option">
        <h3>{room ? 'This project is shared' : 'Share this project'}</h3>
        <p>
          {room
            ? 'Only the people listed below can open it. Their saved changes show up here within a few seconds.'
            : 'Only people you add can see it. They can edit its transcripts, quotes, groups and notes.'}
        </p>
        {room ? (
          <>
            <Field label="Shared room ID">
              <input readOnly value={room} onFocus={e => e.target.select()} />
            </Field>
            <p className="small muted">Send this ID to people you’ve added so they can open the board.</p>
          </>
        ) : (
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await collaboration.create();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <UsersRound size={17} />
            Share this project
          </button>
        )}
        {!room && <p className="small muted">Shared projects can be up to 1.5 MB.</p>}
      </section>
      {room && role === 'owner' && (
        <section className="share-option" aria-label="Project members">
          <h3>People</h3>
          <ul className="member-list">
            {members?.map(m => (
              <li key={m.userId}>
                <span>
                  <code>{m.userId}</code>
                  <small>
                    {m.role}
                    {m.userId === userId ? ' · you' : ''}
                  </small>
                </span>
                {m.role !== 'owner' && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Remove this account’s access? Copies already downloaded cannot be removed.'))
                        void membership('DELETE', m.userId);
                    }}
                  >
                    Remove member
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form
            onSubmit={e => {
              e.preventDefault();
              void membership('POST', person.trim());
            }}
          >
            <Field label="Member account ID">
              <input
                disabled={busy}
                required
                value={person}
                onChange={e => setPerson(e.target.value)}
                placeholder="They can copy it from the top bar after signing in"
              />
            </Field>
            <button disabled={busy} className="primary">
              Add editor
            </button>
          </form>
          <p className="small muted">Removing someone stops their access. Copies they already downloaded stay with them.</p>
        </section>
      )}
      {room && role === 'editor' && <p>You can edit this project. Its owner decides who has access.</p>}
      <ErrorBox error={error} />
      <div className="dialog-actions wrap">
        <button onClick={() => download('margin-project.margin.json', exportProject(project))}>
          <ArrowDownToLine size={16} />
          Download a backup
        </button>
        <button onClick={close} disabled={busy}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
export function HostedJoinDialog({ close, join }: { close: () => void; join: (id: string) => Promise<void> }) {
  const { collaboration: api } = useWorkspaceServices();
  const [rooms, setRooms] = useState<{ id: string; name: string; role: string }[]>([]),
    [id, setId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [more, setMore] = useState(false);
  async function list(after?: string) {
    try {
      const data = await api.listRooms(after);
      setRooms(previous => (after ? [...previous, ...data.rooms] : data.rooms));
      setMore(data.rooms.length === 50);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void list();
  }, []);
  async function open(id: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await join(id);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Shared with you"
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="shared-board-list">
        {rooms.map(room => (
          <button key={room.id} disabled={busy} onClick={() => void open(room.id)}>
            <strong>{room.name}</strong>
            <span>{room.role} · Open board</span>
          </button>
        ))}
      </div>
      {more && <button onClick={() => void list(rooms.at(-1)?.id)}>Load more boards</button>}
      {!rooms.length && (
        <p className="small muted">Nothing yet. Send your account ID (top bar) to the project owner so they can add you.</p>
      )}
      <form
        onSubmit={e => {
          e.preventDefault();
          void open(id.trim());
        }}
      >
        <Field label="Or enter a shared room ID">
          <input disabled={busy} value={id} onChange={e => setId(e.target.value)} required />
        </Field>
        <ErrorBox error={error} />
        <div className="dialog-actions">
          <button type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Open board
          </button>
        </div>
      </form>
    </Dialog>
  );
}
