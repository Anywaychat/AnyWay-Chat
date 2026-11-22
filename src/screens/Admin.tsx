import { useCallback, useEffect, useState } from 'react'
import { MessageCircle, RefreshCw } from 'lucide-react'

type PublicReview = { rating: number; text: string; lang: string; time: number; mode: string; name: string | null }
type Stats = {
  generatedAt: number
  users: { total: number; activeToday: number; activeWeek: number; newWeek: number; byMode: Record<string, number>; withContacts: number; withPhoto: number }
  groups: { total: number; members: number }
  /** "Try it now" guests (no sign-up), counted apart from accounts. */
  guests?: { total: number; activeToday: number; week: number }
  contacts: number
  calls: { logged: number; week: number; video: number }
  push: number
  blocks: number
  reports: number
  reviews: { count: number; average: number | null; list: PublicReview[] }
  people: { mode: string; createdAt: number; lastSeen: number | null; contacts: number }[]
}
type AdminUser = { id: string; name: string; mode: string; createdAt: number; lastSeen: number | null; contacts: number; suspended: boolean; reviewed: boolean; guest?: boolean }
type AdminReview = { id: string; user: string; name: string; mode?: string; rating: number; text: string; lang: string; showName: boolean; hidden?: boolean; time: number }
type AdminReport = { from: string; about: string; reason: string; time: number; fromName?: string; aboutName?: string }

const MODES: Record<string, string> = { blind: 'Blind or low-vision', deaf: 'Deaf · signs', speech: "Can't speak", standard: 'Talks and types' }
const when = (t: number | null) => (t ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
/** Shows only the first two letters, so the list doesn't expose who people are. */
/** Names and usernames are never shown here: the dashboard is open to anyone. */
/** Like a guest's name ("Guest 1646"): a steady number from the account, never the real name. */
const nameOf = (id?: string) => { let h = 0; for (const c of id ?? '') h = (h * 31 + c.charCodeAt(0)) >>> 0; return `User ${1000 + (h % 9000)}` }
const mask = (t?: string) => (t ? '••••••' : '')
const stars = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n)

/** Usage dashboard and people management, open to everyone (no key). */
export default function Admin() {
  const [s, setS] = useState<Stats | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => {
    fetch('/api/stats')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Error ${r.status}`))))
      .then((d: Stats) => { setS(d); setErr('') })
      .catch((e: Error) => setErr(e.message))
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const maxMode = Math.max(1, ...Object.values(s?.users.byMode ?? { x: 1 }))

  return (
    <main className="admin">
      <header className="admin-head">
        <div className="brand"><span className="brand-mark"><MessageCircle size={18} aria-hidden="true" /></span>AnyWay Chat · Dashboard</div>
        <button className="btn" onClick={load}><RefreshCw size={16} aria-hidden="true" />Refresh</button>
      </header>
      {err && <p className="form-error" role="alert">Could not load: {err}</p>}
      {!s ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <p className="muted">Updated {when(s.generatedAt)} · refreshes every 30 seconds.</p>

          <section className="admin-cards" aria-label="Totals">
            {[
              ['People signed up', s.users.total],
              ['Active today', s.users.activeToday],
              ['Active this week', s.users.activeWeek],
              ['Reviews', s.reviews.count],
              ['Average rating', s.reviews.average ?? '—'],
              ['Contacts made', s.contacts],
              ['Groups', s.groups.total],
              ['Calls logged', s.calls.logged],
              ...(s.guests ? [['Tried it as a guest (no sign-up, not counted above)', s.guests.total]] : []),
            ].map(([label, n]) => (
              <div key={label} className="admin-card"><b>{n}</b><span>{label}</span></div>
            ))}
          </section>

          <div className="admin-grid">
            <section className="admin-panel">
              <h2>How people talk</h2>
              {Object.entries(MODES).map(([m, label]) => {
                const n = s.users.byMode[m] ?? 0
                return (
                  <div key={m} className="bar-row">
                    <span>{label}</span>
                    <div className="bar"><i style={{ width: `${(n / maxMode) * 100}%` }} /></div>
                    <b>{n}</b>
                  </div>
                )
              })}
            </section>
            <section className="admin-panel">
              <h2>Health</h2>
              <p className="muted" style={{ lineHeight: 1.8 }}>
                {s.users.withContacts} of {s.users.total} people have at least one contact<br />
                {s.groups.members} group memberships · {s.calls.video} video calls<br />
                {s.push} devices with notifications · {s.blocks} blocks · {s.reports} reports
              </p>
            </section>
          </div>

          <section className="admin-panel">
            <h2>What people say ({s.reviews.count})</h2>
            {s.reviews.list.length === 0 ? (
              <p className="muted">No reviews yet. People can add one from Me → Give a review.</p>
            ) : (
              <div className="review-list">
                {s.reviews.list.map((r, i) => (
                  <article key={i} className="review-card">
                    <div className="row-between"><span className="review-stars" aria-label={`${r.rating} out of 5`}>{stars(r.rating)}</span><small className="muted">{when(r.time)}</small></div>
                    <p dir="auto">{r.text}</p>
                    <small className="muted">{r.name ?? 'Anonymous'} · {MODES[r.mode] ?? r.mode} · {r.lang}</small>
                  </article>
                ))}
              </div>
            )}
          </section>

          <Manage onChange={load} />
        </>
      )}
    </main>
  )
}

/** Managing people and reviews: open to anyone, no key. */
function Manage({ onChange }: { onChange: () => void }) {
  const [tab, setTab] = useState<'users' | 'reviews' | 'reports'>('users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [reviews, setReviews] = useState<AdminReview[]>([])
  const [reports, setReports] = useState<AdminReport[]>([])
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')

  const call = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const r = await fetch(`/api/admin${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`)
    return j as T
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [u, rv, rp] = await Promise.all([call<{ users: AdminUser[] }>('/users'), call<{ reviews: AdminReview[] }>('/reviews'), call<{ reports: AdminReport[] }>('/reports')])
      setUsers(u.users); setReviews(rv.reviews); setReports(rp.reports); setMsg('')
    } catch (e) {
      setMsg((e as Error).message)
    }
  }, [call])
  useEffect(() => { void refresh() }, [refresh])

  const act = async (path: string, body: unknown, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return
    try { await call(path, body); await refresh(); onChange() } catch (e) { setMsg((e as Error).message) }
  }

  const shown = users.filter((u) => `${u.name} ${u.id}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <section className="admin-panel">
      <h2 style={{ margin: 0 }}>Manage</h2>
      <div className="filters" style={{ margin: '12px 0' }} role="group" aria-label="Sections">
        {(['users', 'reviews', 'reports'] as const).map((t) => (
          <button key={t} className="chip-btn" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === 'users' ? `People (${users.length})` : t === 'reviews' ? `Reviews (${reviews.length})` : `Reports (${reports.length})`}
          </button>
        ))}
      </div>
      {msg && <p className="form-error" role="alert">{msg}</p>}

      {tab === 'users' && (
        <>
          <input className="input" style={{ marginBottom: 10, width: '100%' }} placeholder="Search by name or username" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Name</th><th>Username</th><th>How they talk</th><th>Joined</th><th>Last active</th><th>Contacts</th><th>Review</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id} className={u.suspended ? 'off' : ''}>
                    <td>{u.guest ? u.name : nameOf(u.id)}{u.guest ? ' (guest)' : ''}</td><td>@{mask(u.id)}</td><td>{MODES[u.mode] ?? u.mode}</td><td>{when(u.createdAt)}</td><td>{when(u.lastSeen)}</td><td>{u.contacts}</td>
                    <td>{u.reviewed ? '✓' : ''}</td><td>{u.suspended ? 'Turned off' : 'Active'}</td>
                    <td className="actions">
                      <button className="btn" onClick={() => void act(`/users/${u.id}/suspend`, { suspended: !u.suspended }, u.suspended ? undefined : `Turn off @${mask(u.id)}? They won't be able to log in.`)}>{u.suspended ? 'Turn on' : 'Turn off'}</button>
                      <button className="btn danger-btn" onClick={() => void act(`/users/${u.id}/delete`, {}, `Delete @${mask(u.id)} for good? This removes their account, contacts and review. It can't be undone.`)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'reviews' && (
        reviews.length === 0 ? <p className="muted">No reviews yet.</p> : (
          <div className="review-list">
            {reviews.map((r) => (
              <article key={r.id} className={`review-card${r.hidden ? ' off' : ''}`}>
                <div className="row-between"><span className="review-stars">{stars(r.rating)}</span><small className="muted">{when(r.time)}</small></div>
                <p dir="auto">{r.text}</p>
                <small className="muted">{nameOf(r.user)} (@{mask(r.user)}) · {MODES[r.mode ?? ''] ?? r.mode} · {r.lang} · {r.showName ? 'name shown' : 'anonymous'}{r.hidden ? ' · hidden' : ''}</small>
                <div className="actions" style={{ marginTop: 8 }}>
                  <button className="btn" onClick={() => void act(`/reviews/${r.id}/hide`, { hidden: !r.hidden })}>{r.hidden ? 'Show' : 'Hide'}</button>
                  <button className="btn danger-btn" onClick={() => void act(`/reviews/${r.id}/delete`, {}, 'Delete this review for good?')}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        )
      )}

      {tab === 'reports' && (
        reports.length === 0 ? <p className="muted">No reports.</p> : (
          <div className="review-list">
            {reports.map((r, i) => (
              <article key={i} className="review-card">
                <small className="muted">{when(r.time)} · {nameOf(r.from)} (@{mask(r.from)}) reported {nameOf(r.about)} (@{mask(r.about)})</small>
                <p dir="auto">{r.reason}</p>
              </article>
            ))}
          </div>
        )
      )}
    </section>
  )
}

