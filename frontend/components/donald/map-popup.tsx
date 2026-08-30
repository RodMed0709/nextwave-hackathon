'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

export type MapPopupData = {
  title: string
  origin: string
  destination: string
  note: string | null
}

/**
 * The route as a picture: two ports, the planned line, the deviation that
 * opened the case. Stylized on purpose — it is a situational sketch a room
 * reads in two seconds, not a chart plotter. Opens as a popup from any card
 * that talks about a vessel, so the graph never has to make room for it.
 */
export function MapPopup({ data, onClose }: { data: MapPopupData; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="email-popup-backdrop" onClick={onClose} role="presentation">
      <article aria-label={data.title} className="map-popup" onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>{data.title}</strong>
          <button aria-label="Close map" onClick={onClose} type="button"><X size={16} /></button>
        </header>
        <svg className="map-popup-canvas" viewBox="0 0 900 400" role="img" aria-label={`Route from ${data.origin} to ${data.destination}`}>
          <defs>
            <radialGradient id="map-ocean" cx="50%" cy="30%" r="90%">
              <stop offset="0%" stopColor="#0d2845" />
              <stop offset="100%" stopColor="#051321" />
            </radialGradient>
          </defs>
          <rect width="900" height="400" fill="url(#map-ocean)" />
          {/* Stylised continents so it reads as a WORLD map at a glance:
              Asia/SEA on the left, the Pacific in the middle, the Americas on
              the right — matching the demo's east-to-west voyages. */}
          <g fill="#12365c" stroke="#1d4a75" strokeWidth="1.5">
            <path d="M 20 40 Q 120 10 210 45 Q 265 70 245 120 Q 220 165 165 195 Q 120 230 95 205 Q 40 175 30 120 Z" />
            <path d="M 140 215 Q 175 205 190 235 Q 200 270 175 285 Q 145 290 135 260 Z" />
            <path d="M 640 20 Q 740 5 830 35 Q 880 60 875 115 Q 850 150 800 155 Q 755 175 735 150 Q 690 130 675 90 Q 650 60 640 20 Z" />
            <path d="M 760 170 Q 805 165 830 195 Q 850 230 830 265 Q 800 275 785 250 Q 765 215 760 170 Z" />
            <path d="M 800 280 Q 840 285 850 325 Q 850 370 820 385 Q 795 380 792 340 Q 790 305 800 280 Z" />
            <path d="M 350 300 Q 400 285 440 305 Q 455 335 425 355 Q 380 365 355 340 Z" />
          </g>
          {[80, 160, 240, 320].map((y) => (
            <line key={y} x1="0" y1={y} x2="900" y2={y} stroke="#6990b3" strokeOpacity=".1" />
          ))}
          {[150, 300, 450, 600, 750].map((x) => (
            <line key={x} x1={x} y1="0" x2={x} y2="400" stroke="#6990b3" strokeOpacity=".1" />
          ))}

          {/* planned route */}
          <path id="planned-route" d="M 110 240 C 300 90, 600 90, 790 250" fill="none" stroke="#8ea8c1" strokeDasharray="7 7" strokeWidth="2.5" opacity=".55" />
          {/* actual route with the unplanned stop */}
          <path id="actual-route" d="M 110 240 C 250 120, 400 100, 470 140 C 520 168, 640 180, 790 250" fill="none" stroke="#d7f24c" strokeWidth="3" />

          {/* origin */}
          <circle cx="110" cy="240" r="9" fill="#d7f24c" />
          <text x="110" y="276" fill="#eef4f5" fontSize="16" fontWeight="800" textAnchor="middle">{data.origin}</text>

          {/* unplanned stop */}
          <circle cx="470" cy="140" r="9" fill="#e8a23d" />
          <circle cx="470" cy="140" r="16" fill="none" stroke="#e8a23d" strokeOpacity=".5">
            <animate attributeName="r" values="12;22;12" dur="1.8s" repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values=".6;0;.6" dur="1.8s" repeatCount="indefinite" />
          </circle>
          <text x="470" y="108" fill="#ffd9a0" fontSize="14" fontWeight="800" textAnchor="middle">Unplanned stop</text>

          {/* destination */}
          <circle cx="790" cy="250" r="9" fill="#d7f24c" />
          <text x="790" y="286" fill="#eef4f5" fontSize="16" fontWeight="800" textAnchor="middle">{data.destination}</text>

          {/* the vessel, sailing the actual route */}
          <g>
            <path d="M -12 4 L 12 4 L 7 12 L -7 12 Z M -2 4 L -2 -8 L 6 -2 L -2 -2" fill="#fbfaf4" stroke="#0a1c32" strokeWidth="1" />
            <animateMotion dur="7s" repeatCount="indefinite" rotate="auto">
              <mpath href="#actual-route" />
            </animateMotion>
          </g>
        </svg>
        {data.note && <p className="map-popup-note">{data.note}</p>}
      </article>
    </div>
  )
}
