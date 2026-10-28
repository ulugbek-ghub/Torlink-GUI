import { useState } from 'react'
import { addMagnet } from '../api.js'
import Modal from './Modal.jsx'

export default function AddMagnet({ triggerLabel = 'Add magnet', triggerClass = 'btn' }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setDone('')
    try {
      const body = value.trim().toLowerCase().startsWith('magnet:')
        ? { magnet: value.trim() }
        : { infoHash: value.trim() }
      await addMagnet(body)
      setDone('Added to downloads.')
      setValue('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className={triggerClass} onClick={() => setOpen(true)}>
        {triggerLabel}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add from magnet link or info hash">
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="magnet-input">Magnet link or 40-char info hash</label>
            <textarea
              id="magnet-input"
              rows={3}
              placeholder="magnet:?xt=urn:btih:..."
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              spellCheck={false}
            />
          </div>
          {error && (
            <div className="banner error-banner" role="alert">
              {error}
            </div>
          )}
          {done && (
            <div className="banner success-banner" role="status">
              {done}
            </div>
          )}
          <div className="form-actions form-actions-end">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}
