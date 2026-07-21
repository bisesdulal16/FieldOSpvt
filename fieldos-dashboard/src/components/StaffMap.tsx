'use client';

import { MapContainer, TileLayer, CircleMarker, Polyline, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface GeoPoint {
  lat: number;
  lng: number;
  address?: string;
  at?: string;
  type?: string;
}
export interface OfficerLocations {
  officer_id: number;
  name: string;
  staff_id: string;
  last_seen: GeoPoint | null;
  points: GeoPoint[];
}

// Distinct, legible marker colors per officer (brand navy first).
const COLORS = ['#0B1B3A', '#DC2626', '#16A34A', '#7C3AED', '#EA580C', '#0891B2'];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

// A pulsing map pin with the officer's initials, built as a Leaflet divIcon.
function pinIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: 'fieldos-pin-wrap',
    html: `
      <div class="fieldos-pin" style="--pin:${color}">
        <span class="fieldos-pin-pulse"></span>
        <span class="fieldos-pin-dot">${label}</span>
      </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function fmtTime(at?: string): string {
  if (!at) return '';
  return `${at.slice(0, 10)} ${at.slice(11, 16)}`;
}

export default function StaffMap({ officers }: { officers: OfficerLocations[] }) {
  const withPoints = officers.filter((o) => o.last_seen);
  const center: [number, number] = withPoints.length
    ? [
        withPoints.reduce((s, o) => s + (o.last_seen!.lat || 0), 0) / withPoints.length,
        withPoints.reduce((s, o) => s + (o.last_seen!.lng || 0), 0) / withPoints.length,
      ]
    : [27.71, 85.29];

  return (
    <div className="fieldos-map">
      <style>{`
        .fieldos-map { position: relative; border-radius: 14px; overflow: hidden;
          border: 1px solid #e5e7eb; box-shadow: 0 6px 24px rgba(11,27,58,.10); }
        .fieldos-map .leaflet-container { background: #eef2f6; font: inherit; }
        .fieldos-pin-wrap { background: none; border: none; }
        .fieldos-pin { position: relative; width: 34px; height: 34px; }
        .fieldos-pin-dot { position: absolute; inset: 5px; border-radius: 50%;
          background: var(--pin); color: #fff; font-size: 11px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,.35); z-index: 2; }
        .fieldos-pin-pulse { position: absolute; inset: 5px; border-radius: 50%;
          background: var(--pin); opacity: .45; z-index: 1;
          animation: fieldos-pulse 2s ease-out infinite; }
        @keyframes fieldos-pulse {
          0%   { transform: scale(1);   opacity: .45; }
          70%  { transform: scale(2.4); opacity: 0; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) { .fieldos-pin-pulse { animation: none; } }
        .fieldos-legend { position: absolute; top: 12px; right: 12px; z-index: 500;
          background: rgba(255,255,255,.94); backdrop-filter: blur(4px);
          border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px;
          box-shadow: 0 4px 14px rgba(11,27,58,.12); max-width: 220px; }
        .fieldos-legend h4 { margin: 0 0 8px; font-size: 10px; letter-spacing: .08em;
          text-transform: uppercase; color: #6b7280; font-weight: 700; }
        .fieldos-legend-row { display: flex; align-items: center; gap: 8px; margin-top: 6px;
          font-size: 12px; color: #111827; }
        .fieldos-legend-row .sw { width: 10px; height: 10px; border-radius: 50%; flex: none;
          border: 1.5px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.12); }
        .fieldos-legend-row .who { font-weight: 600; }
        .fieldos-legend-row .when { color: #9ca3af; margin-left: auto; font-variant-numeric: tabular-nums; }
        .leaflet-popup-content-wrapper { border-radius: 10px; }
      `}</style>

      {withPoints.length > 0 && (
        <div className="fieldos-legend">
          <h4>{withPoints.length} officer{withPoints.length > 1 ? 's' : ''} active</h4>
          {officers.map((o, idx) =>
            o.last_seen ? (
              <div className="fieldos-legend-row" key={o.officer_id}>
                <span className="sw" style={{ background: COLORS[idx % COLORS.length] }} />
                <span className="who">{o.name.split(' ')[0]}</span>
                <span className="when">{o.last_seen.at ? o.last_seen.at.slice(11, 16) : ''}</span>
              </div>
            ) : null,
          )}
        </div>
      )}

      <MapContainer center={center} zoom={13} style={{ height: 480, width: '100%' }} scrollWheelZoom>
        {/* CARTO Voyager — cleaner, lighter basemap than default OSM (free, no key). */}
        <TileLayer
          attribution='&copy; OpenStreetMap &copy; CARTO'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        {officers.map((o, idx) => {
          const color = COLORS[idx % COLORS.length];
          const line = o.points.map((p) => [p.lat, p.lng] as [number, number]);
          const last = o.last_seen;
          return (
            <span key={o.officer_id}>
              {/* Movement trail — smooth rounded line. */}
              {line.length > 1 && (
                <Polyline
                  positions={line}
                  pathOptions={{ color, weight: 3, opacity: 0.35, lineCap: 'round', lineJoin: 'round' }}
                />
              )}
              {/* Faded trail dots (older = fainter). */}
              {o.points.slice(1).map((p, i) => (
                <CircleMarker
                  key={i}
                  center={[p.lat, p.lng]}
                  radius={3}
                  pathOptions={{
                    color,
                    fillColor: color,
                    fillOpacity: Math.max(0.15, 0.5 - i * 0.06),
                    weight: 0,
                  }}
                />
              ))}
              {/* Last-seen pin with pulse + initials. */}
              {last && (
                <Marker position={[last.lat, last.lng]} icon={pinIcon(color, initials(o.name))}>
                  <Popup>
                    <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                      <strong>{o.name}</strong> · {o.staff_id}
                      <br />
                      {last.address || 'Location unknown'}
                      <br />
                      <span style={{ color: '#6b7280' }}>
                        {fmtTime(last.at)}
                        {last.type ? ` · ${last.type}` : ''}
                      </span>
                    </div>
                  </Popup>
                </Marker>
              )}
            </span>
          );
        })}
      </MapContainer>
    </div>
  );
}
