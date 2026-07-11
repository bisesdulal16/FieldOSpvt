'use client';

import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, Tooltip } from 'react-leaflet';
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

// Distinct colors per officer.
const COLORS = ['#0B1B3A', '#DC2626', '#16A34A', '#7C3AED', '#EA580C', '#0891B2'];

export default function StaffMap({ officers }: { officers: OfficerLocations[] }) {
  const withPoints = officers.filter(o => o.last_seen);
  // Center on the average of last-seen points, or Kathmandu.
  const center: [number, number] = withPoints.length
    ? [
        withPoints.reduce((s, o) => s + (o.last_seen!.lat || 0), 0) / withPoints.length,
        withPoints.reduce((s, o) => s + (o.last_seen!.lng || 0), 0) / withPoints.length,
      ]
    : [27.71, 85.29];

  return (
    <MapContainer center={center} zoom={13} style={{ height: 480, width: '100%', borderRadius: 12 }} scrollWheelZoom>
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {officers.map((o, idx) => {
        const color = COLORS[idx % COLORS.length];
        const line = o.points.map(p => [p.lat, p.lng] as [number, number]);
        return (
          <span key={o.officer_id}>
            {line.length > 1 && (
              <Polyline positions={line} pathOptions={{ color, weight: 2, opacity: 0.5, dashArray: '4 6' }} />
            )}
            {o.points.map((p, i) => (
              <CircleMarker
                key={i}
                center={[p.lat, p.lng]}
                radius={i === 0 ? 9 : 4}
                pathOptions={{ color, fillColor: color, fillOpacity: i === 0 ? 0.9 : 0.4, weight: i === 0 ? 2 : 1 }}
              >
                {i === 0 && (
                  <>
                    <Tooltip permanent direction="top" offset={[0, -8]}>
                      <span style={{ fontWeight: 600 }}>{o.name.split(' ')[0]}</span>
                    </Tooltip>
                    <Popup>
                      <div style={{ fontSize: 13 }}>
                        <strong>{o.name}</strong> · {o.staff_id}<br />
                        Last seen: {p.address || 'unknown'}<br />
                        {p.at ? `${p.at.slice(0, 10)} ${p.at.slice(11, 16)}` : ''} · {p.type}
                      </div>
                    </Popup>
                  </>
                )}
              </CircleMarker>
            ))}
          </span>
        );
      })}
    </MapContainer>
  );
}
