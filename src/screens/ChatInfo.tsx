import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ban, Flag, LogOut, Pencil, UserMinus, UserPlus, X } from 'lucide-react'
import { contactById, toContact, useAuth, type Group } from '../state'
import { Avatar } from '../components/ui'

export default function ChatInfo({ kind, id, onClose }: { kind: 'direct' | 'group'; id: string; onClose: () => void }) {
  return (
    <div className="modal-back" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={kind === 'group' ? 'Group info' : 'Contact info'} onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <h2>{kind === 'group' ? 'Group info' : 'Contact info'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={20} aria-hidden="true" /></button>
        </div>
        {kind === 'group' ? <GroupInfo id={id} onClose={onClose} /> : <PersonInfo id={id} />}
      </div>
    </div>
  )
}

function PersonInfo({ id }: { id: string }) {
  const { blocked, setBlocked, report, setNickname, contacts } = useAuth()
  const c = contacts.find((x) => x.id === id) ?? contactById(id)
  const [naming, setNaming] = useState(false)
  const [nick, setNick] = useState('')
  const isBlocked = blocked.includes(id)
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  return (
    <>
      <div className="info-head">
        <Avatar c={c} size="xl" />
        <strong>{c.name}</strong>
        <span className="muted">{c.nickname ? `${c.realName} · ` : ''}@{c.id}</span>
      </div>
      {naming ? (
        <form
          className="name-edit"
          onSubmit={async (e) => {
            e.preventDefault()
            const err = await setNickname(id, nick)
            setMsg(err ?? (nick.trim() ? `You'll see them as ${nick.trim()}. Only you see this name.` : `Nickname removed.`))
            if (!err) setNaming(false)
          }}
        >
          <input className="input" aria-label={`Nickname for ${c.realName}`} placeholder={c.realName} value={nick} onChange={(e) => setNick(e.target.value)} maxLength={40} autoFocus />
          <button className="btn primary" style={{ height: 40 }}>Save</button>
          <button type="button" className="btn" style={{ height: 40 }} onClick={() => setNaming(false)}>Cancel</button>
        </form>
      ) : (
        <button className="btn block" onClick={() => { setNick(c.nickname ?? ''); setNaming(true); setMsg(null) }}>
          <Pencil size={16} aria-hidden="true" />{c.nickname ? 'Change nickname' : 'Give a nickname'}
        </button>
      )}
      <button className={`btn block${isBlocked ? '' : ' danger-btn'}`} onClick={async () => setMsg((await setBlocked(id, !isBlocked)) ?? (isBlocked ? `${c.name} is unblocked.` : `${c.name} is blocked. They can't message or call you.`))}>
        <Ban size={16} aria-hidden="true" />{isBlocked ? `Unblock ${c.name}` : `Block ${c.name}`}
      </button>
      {!reporting ? (
        <button className="btn block" onClick={() => setReporting(true)}><Flag size={16} aria-hidden="true" />Report {c.name}</button>
      ) : (
        <form
          className="report-form"
          onSubmit={async (e) => {
            e.preventDefault()
            const err = await report(id, reason)
            setMsg(err ?? 'Thanks. Your report was sent.')
            setReporting(false)
            setReason('')
          }}
        >
          <label className="field-label">What happened?
            <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} />
          </label>
          <button className="btn primary block">Send report</button>
        </form>
      )}
      {msg && <p className="form-ok" role="status">{msg}</p>}
    </>
  )
}

function GroupInfo({ id, onClose }: { id: string; onClose: () => void }) {
  const { groups, contacts, user, api, refreshContacts } = useAuth()
  const nav = useNavigate()
  const g = groups.find((x) => x.id === id)
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  if (!g || !user) return <p className="muted">This group is no longer available.</p>
  const admin = g.owner === user.id
  const candidates = contacts.filter((c) => !g.members.some((m) => m.id === c.id))

  const change = async (body: { add?: string[]; remove?: string[] }) => {
    setError(null)
    try {
      await api<{ group: Group }>(`/groups/${id}/members`, { method: 'POST', body })
      await refreshContacts()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <div className="info-head">
        <strong>{g.name}</strong>
        <span className="muted">{g.members.length} members</span>
      </div>
      <div className="modal-list">
        {g.members.map((m) => {
          const c = toContact(m)
          return (
            <div key={m.id} className="chat-row" style={{ padding: '8px 4px' }}>
              <Avatar c={c} size="sm" />
              <div className="chat-row-main">
                <strong>{m.id === user.id ? 'You' : m.name}</strong>
                <span className="muted">@{m.id}{m.id === g.owner ? ' · Admin' : ''}</span>
              </div>
              {admin && m.id !== user.id && (
                <button className="icon-btn" aria-label={`Remove ${m.name}`} onClick={() => change({ remove: [m.id] })}><UserMinus size={18} aria-hidden="true" /></button>
              )}
            </div>
          )
        })}
      </div>

      {admin && !adding && candidates.length > 0 && (
        <button className="btn block" onClick={() => setAdding(true)}><UserPlus size={16} aria-hidden="true" />Add people</button>
      )}
      {admin && adding && (
        <div className="add-people">
          {candidates.map((c) => (
            <label key={c.id} className="chat-row pick-row">
              <input type="checkbox" checked={picked.includes(c.id)} onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))} />
              <Avatar c={c} size="sm" />
              <span className="chat-row-main"><strong>{c.name}</strong></span>
            </label>
          ))}
          <button className="btn primary block" disabled={!picked.length} onClick={async () => { await change({ add: picked }); setPicked([]); setAdding(false) }}>
            Add {picked.length || ''}
          </button>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      <button
        className="btn block danger-btn"
        onClick={async () => {
          if (!confirm(`Leave ${g.name}?`)) return
          try {
            await api(`/groups/${id}/leave`, { method: 'POST' })
            await refreshContacts()
            onClose()
            nav('/home')
          } catch (e) {
            setError((e as Error).message)
          }
        }}
      >
        <LogOut size={16} aria-hidden="true" />Leave group
      </button>
    </>
  )
}
