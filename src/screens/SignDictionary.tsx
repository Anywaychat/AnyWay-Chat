import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import SignWordPicker from '../components/SignWordPicker'

/** Common Indian Sign Language words, grouped, drawn from real Deaf signers' movements. */
export default function SignDictionary() {
  const nav = useNavigate()
  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn back-btn" style={{ display: 'grid' }} aria-label="Back" onClick={() => nav(-1)}><ArrowLeft size={20} aria-hidden="true" /></button>
        <div className="topbar-title"><strong>Sign dictionary</strong><span>Everyday words in Indian Sign Language</span></div>
      </header>
      <div className="scroll">
        <div className="section">
          <SignWordPicker />
          <p className="hint" style={{ textAlign: 'left' }}>Signs from the INCLUDE dataset by AI4Bharat (CC BY 4.0), signed by Deaf signers in Chennai.</p>
        </div>
      </div>
    </div>
  )
}
