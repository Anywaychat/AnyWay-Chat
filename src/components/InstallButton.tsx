import { Download } from 'lucide-react'
import { useInstall } from '../install'

/** Shows an install button when the app can be installed, or Add to Home Screen steps on iPhone. */
export default function InstallButton({ compact = false }: { compact?: boolean }) {
  const { installed, canInstall, ios, install } = useInstall()
  if (installed) return null
  if (canInstall)
    return (
      <button className={compact ? 'notif-card' : 'btn block'} onClick={() => void install()}>
        <Download size={16} aria-hidden="true" />Install AnyWay as an app
      </button>
    )
  if (ios && !compact)
    return <p className="hint" style={{ textAlign: 'left', margin: 0 }}>To install on iPhone: tap the Share button, then “Add to Home Screen”.</p>
  return null
}
