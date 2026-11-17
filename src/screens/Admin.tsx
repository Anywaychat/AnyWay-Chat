import { useEffect, useState } from 'react'
import { MessageCircle, RefreshCw } from 'lucide-react'

type Stats = {
  generatedAt: number
  users: { total: number; activeToday: number; activeWeek: number; newWeek: number; byMode: Record<string, number>; withContacts: number; withPhoto: number }
  signups: { day: string; count: number }[]
  groups: { total: number; members: number }
  contacts: number
  calls: { logged: number; week: number; video: number }
  push: number
  blocks: number
  reports: number
  people: { mode: string; createdAt: number; lastSeen: number | null; contacts: number }[]
}

const MODES: Record<string, string> = { blind: 'Blind or low-vision', deaf: 'Deaf · signs', speech: "Can't speak", deafblind: 'Deaf-blind', standard: 'Talks and types' }
const when = (t: number | null) => (t ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

/** Open usage dashboard: how AnyWay is being used. Numbers only, nothing that identifies a person. */
export default function Admin() {
  const [s, setS] = useState<Stats | null>(null)
  const [err, setErr] = useState('')
  const load = () =>
    fetch('/api/stats')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Error ${r.status}`))))
      .then((d: Stats) => { setS(d); setErr('') })
      .catch((e: Error) => setErr(e.message))
  useEffect(() => {
    void load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  const maxDay = Math.max(1, ...(s?.signups.map((d) => d.count) ?? [1]))
  const maxMode = Math.max(1, ...Object.values(s?.users.byMode ?? { x: 1 }))

  return (
    <main className="admin">
      <header className="admin-head">
        <div className="brand"><span className="brand-mark"><MessageCircle size={18} aria-hidden="true" /></span>AnyWay Chat · Usage</div>
        <button className="btn" onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" />Refresh</button>
      </header>
      {err && <p className="form-error" role="alert">Could not load: {err}</p>}
      {!s ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <p className="muted">Updated {when(s.generatedAt)} · refreshes every 30 seconds · no names or usernames are shown here.</p>

          <section className="admin-cards" aria-label="Totals">
            {[
              ['People signed up', s.users.total],
              ['Active today', s.users.activeToday],
              ['Active this week', s.users.activeWeek],
              ['New this week', s.users.newWeek],
              ['Contacts made', s.contacts],
              ['Groups', s.groups.total],
              ['Calls logged', s.calls.logged],
              ['Push-enabled devices', s.push],
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
              <h2>Sign-ups, last 14 days</h2>
              <div className="cols" role="img" aria-label={s.signups.map((d) => `${d.day}: ${d.count}`).join(', ')}>
                {s.signups.map((d) => (
                  <div key={d.day} className="col-bar" title={`${d.day}: ${d.count}`}>
                    <i style={{ height: `${(d.count / maxDay) * 100}%` }} />
                    <small>{d.day.slice(8)}</small>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="admin-panel">
            <h2>Health</h2>
            <p className="muted">
              {s.users.withContacts} of {s.users.total} people have at least one contact · {s.groups.members} group memberships · {s.calls.video} video calls · {s.blocks} blocks · {s.reports} reports
            </p>
          </section>

          <section className="admin-panel">
            <h2>People (anonymous), most recently active first</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>#</th><th>How they talk</th><th>Joined</th><th>Last active</th><th>Contacts</th></tr></thead>
                <tbody>
                  {s.people.map((p, i) => (
                    <tr key={i}><td>{i + 1}</td><td>{MODES[p.mode] ?? p.mode}</td><td>{when(p.createdAt)}</td><td>{when(p.lastSeen)}</td><td>{p.contacts}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  )
}
