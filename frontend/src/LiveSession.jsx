import { useEffect, useRef, useState } from 'react'

const FPS_TARGET = 15
const BASELINE_S = 10
const SEGMENTS = 16
const SEVERITIES = ['low', 'medium', 'high', 'critical']

// canvas colours and faces come from the token block, the single source of truth
const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const FONT = cssVar('--font-ui')

const fmtTime = (s) => {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(0).padStart(2, '0')
  return `${m}:${sec}`
}

const SEV_LABEL = { low: 'low', medium: 'med', high: 'high', critical: 'crit' }

function drawBoxes(octx, boxes, ms) {
  octx.clearRect(0, 0, octx.canvas.width, octx.canvas.height)
  if (!ms && !boxes.length) return
  const primary = cssVar('--c-primary')
  const fill = cssVar('--c-primary-soft')
  const ink = cssVar('--c-secondary')
  octx.lineWidth = 3
  octx.strokeStyle = primary
  octx.font = `600 12px ${FONT}`
  for (const b of boxes) {
    octx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1)
    const label = `${b.label} ${Math.round(b.conf * 100)}%`
    const w = octx.measureText(label).width + 12
    octx.fillStyle = fill
    octx.fillRect(b.x1, b.y1 - 24, w, 24)
    octx.fillStyle = ink
    octx.fillText(label, b.x1 + 6, b.y1 - 7)
  }
}

function drawGaze(octx, g) {
  if (!g) return
  const primary = cssVar('--c-primary')
  const W = octx.canvas.width, H = octx.canvas.height
  // mirrored view: base point and horizontal direction are flipped so the
  // ray points where the subject feels they are looking (labels unchanged —
  // they already describe the subject's own left/right)
  const bx = W - g.x * W, by = g.y * H
  const ex = bx - g.dx * W * 0.25
  const ey = by + g.dy * H * 0.32

  octx.beginPath()
  octx.arc(bx, by, 5, 0, Math.PI * 2)
  octx.fillStyle = primary
  octx.fill()

  octx.beginPath()
  octx.moveTo(bx, by)
  octx.lineTo(ex, ey)
  octx.strokeStyle = primary
  octx.lineWidth = 2
  octx.stroke()

  octx.beginPath()
  octx.arc(ex, ey, 6, 0, Math.PI * 2)
  octx.fillStyle = primary
  octx.fill()
}

export default function LiveSession({ sessionToken = null }) {
  const viewRef = useRef(null)
  const overlayRef = useRef(null)
  const wsRef = useRef(null)
  const [events, setEvents] = useState([])
  const [calib, setCalib] = useState({ state: 'calibrating', remaining: BASELINE_S })
  const [status, setStatus] = useState({ fps: 0, ms: 0, det: 0, conn: 'connecting', gaze: null })
  const [camError, setCamError] = useState(null)
  const [videoReady, setVideoReady] = useState(false)
  const [size, setSize] = useState(null) // { W, H } set once the camera resolves

  useEffect(() => {
    let disposed = false
    let raf = 0, awaiting = false, lastSend = 0
    let frames = 0, fps = 0, lastFpsT = performance.now()
    let stream = null
    let video = null

    function connect() {
      const qs = sessionToken ? `?session=${encodeURIComponent(sessionToken)}` : ''
      const ws = new WebSocket(`ws://${location.host}/ws${qs}`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws
      ws.onmessage = (e) => {
        const d = JSON.parse(e.data)
        const octx = overlayRef.current?.getContext('2d')
        if (octx) {
          drawBoxes(octx, d.boxes, d.ms)
          drawGaze(octx, d.gaze)
        }
        setCalib({ state: d.state, remaining: d.seconds_remaining })
        if (d.events?.length) setEvents((prev) => [...prev, ...d.events])
        setStatus((s) => ({ ...s, ms: d.ms, det: d.boxes.length, conn: 'open',
                            gaze: d.gaze ? `${d.gaze.dx >= 0 ? 'right' : 'left'} ${d.gaze.dy >= 0 ? 'down' : 'up'}` : null }))
        awaiting = false // results for the shown frame are in; allow the next redraw
      }
      ws.onclose = () => {
        if (!disposed) {
          setStatus((s) => ({ ...s, conn: 'retrying' }))
          setTimeout(connect, 1000)
        }
      }
    }

    function loop(t) {
      raf = requestAnimationFrame(loop)
      // wait for the previous frame's results before redrawing the video —
      // otherwise the overlay (computed on an older frame) detaches from the
      // head whenever the subject moves
      if (awaiting || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
      if (t - lastSend < 1000 / FPS_TARGET) return
      lastSend = t
      const ctx = viewRef.current.getContext('2d')
      // selfie mirror: draw the video flipped horizontally so left/right feels natural
      ctx.save()
      ctx.translate(viewRef.current.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, 0, 0, viewRef.current.width, viewRef.current.height)
      ctx.restore()
      awaiting = true
      viewRef.current.toBlob(async (blob) => {
        try { wsRef.current.send(await blob.arrayBuffer()) } catch { awaiting = false }
      }, 'image/jpeg', 0.7)

      frames++
      if (t - lastFpsT >= 1000) { fps = frames; frames = 0; lastFpsT = t; setStatus((s) => ({ ...s, fps })) }
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        })
      } catch (err) {
        setCamError(err.message)
        setStatus((s) => ({ ...s, conn: 'error' }))
        return
      }
      video = document.createElement('video')
      video.srcObject = stream
      video.autoplay = true
      video.playsInline = true
      await video.play()
      const vw = video.videoWidth || 1280, vh = video.videoHeight || 720
      const scale = Math.min(1, 960 / vw)
      setSize({ W: Math.round(vw * scale), H: Math.round(vh * scale) })
      setVideoReady(true)
      connect()
      raf = requestAnimationFrame(loop)
    }

    start()
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      wsRef.current?.close()
      stream?.getTracks().forEach((tr) => tr.stop())
    }
  }, [sessionToken])

  const segFilled = calib.state === 'live'
    ? SEGMENTS
    : Math.max(0, Math.min(SEGMENTS, Math.floor(SEGMENTS * (1 - calib.remaining / BASELINE_S))))

  return (
    <>
      <div className="chips" style={{ marginBottom: 16 }}>
        {camError ? (
          <span className="hchip err" role="status"><span className="dot err"></span>camera denied</span>
        ) : (
          <span className={`hchip ${status.conn === 'open' ? 'live' : status.conn === 'error' ? 'err' : ''}`} role="status">
            <span className={`dot ${status.conn !== 'open' ? 'dim' : ''}`}></span>
            {status.conn}
          </span>
        )}
        <span className="hchip">ws | {status.fps} fps</span>
      </div>

      <div className="grid">
        <section className="glass cam">
          <div className="viewport">
            <div className="note-float" hidden={videoReady}>
              <span className="note">
                {camError ? `camera error: ${camError}` : 'starting camera, allow the prompt'}
              </span>
            </div>
            {videoReady && size && (
              <>
                <canvas ref={viewRef} width={size.W} height={size.H} aria-label="mirrored camera view"></canvas>
                <canvas ref={overlayRef} width={size.W} height={size.H} aria-label="detection and gaze overlay"></canvas>
              </>
            )}
            {videoReady && (
              <>
                <div className="hud tl">cam 01 | 1280×720 | mirrored</div>
                <div className="hud br">{status.gaze ? `gaze ${status.gaze}` : 'gaze searching'}</div>
              </>
            )}
          </div>
          {videoReady && (
            <div className="calib">
              <div className={`calib-label ${calib.state !== 'live' ? 'calibrating' : ''}`} role="status">
                {calib.state === 'live'
                  ? 'calibration ● live'
                  : `calibrating ${calib.remaining.toFixed(1)}s, sit still`}
              </div>
              <div className="segrow">
                {Array.from({ length: SEGMENTS }, (_, i) => (
                  <div key={i}
                    className={`seg ${i < segFilled ? (calib.state === 'live' ? '' : 'amber') : 'dim'}`}></div>
                ))}
              </div>
              <div className="calib-cap">baseline 10.0s | drift ±12°</div>
            </div>
          )}
          <div className="status">
            <span>fps <b>{status.fps}</b></span>
            <span>inf <b>{status.ms.toFixed(1)} ms</b></span>
            <span>det <b>{status.det}</b></span>
            <span>policy <b>pose_v2</b></span>
            <span>model <b>train-4 @ 960</b></span>
          </div>
        </section>

        <aside className="rail">
          <div className="glass panel events">
            <h2>Event feed</h2>
            <div className="legend">
              {SEVERITIES.map((s) => (
                <span key={s} className={`leg sev-${s}`}>
                  {s === 'critical' && <span className="sev-mark" aria-hidden="true">!</span>}
                  {s}
                </span>
              ))}
            </div>
            <div className="event-scroll" role="log" aria-live="polite" aria-label="event feed">
              {events.length === 0
                ? <div className="e-none">
                    {camError ? 'camera denied, no feed to flag'
                      : status.conn === 'open' ? 'waiting for next flag' : `waiting for server (${status.conn})`}
                  </div>
                : events.map((ev, i) => (
                    <div className="event" key={i}>
                      <span className="e-time">{fmtTime(ev.start_s)}</span>
                      <span className="e-type">{ev.event_type}</span>
                      <span className={`leg sev-${ev.severity}`}>
                        {ev.severity === 'critical' && <span className="sev-mark" aria-hidden="true">!</span>}
                        {SEV_LABEL[ev.severity]}
                      </span>
                    </div>
                  ))}
            </div>
            <div className="cursor-row">▮</div>
          </div>
          <div className="glass panel">
            <h2>Policy: single source</h2>
            <dl className="kv">
              <dt>policy_ref</dt><dd><b>pose_v2</b></dd>
              <dt>conf_phone</dt><dd>0.35</dd>
              <dt>conf_person</dt><dd>0.35</dd>
              <dt>imgsz</dt><dd>960</dd>
              <dt>detector</dt><dd>yolo11n | train-4</dd>
              <dt>pose channels</dt><dd>iris + head, indep.</dd>
            </dl>
          </div>
        </aside>
      </div>
    </>
  )
}
