"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface RouteData {
  coordinates: [number, number][];
  distance: number;
  duration: number;
  cost: number;
  mode: string;
}

interface TransportMode {
  value: string;
  label: string;
  icon: any;
  color: string;
}

interface MapComponentProps {
  routes: RouteData[];
  transportModes: TransportMode[];
}

// Fix for default marker icons in Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

function MapUpdater({ routes }: { routes: RouteData[] }) {
  const map = useMap();

  useEffect(() => {
    if (routes.length > 0) {
      const allCoordinates = routes.flatMap(route => route.coordinates);
      if (allCoordinates.length > 0) {
        const bounds = L.latLngBounds(allCoordinates);
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [routes, map]);

  return null;
}

export default function MapComponent({ routes, transportModes }: MapComponentProps) {
  const mapRef = useRef<L.Map | null>(null);

  const getMarkerIcon = (color: string) => {
    return L.divIcon({
      className: "custom-marker",
      html: `
        <div style="
          background-color: ${color};
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 3px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        "></div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  };

  return (
    <MapContainer
      center={[39.8283, -98.5795]} // Center of USA
      zoom={4}
      style={{ height: "100%", width: "100%" }}
      ref={mapRef}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      
      {routes.map((route, index) => {
        const mode = transportModes.find(m => m.value === route.mode);
        const color = mode?.color || "#3b82f6";
        
        return (
          <div key={index}>
            {route.coordinates.length > 0 && (
              <>
                {/* Route line */}
                <Polyline
                  positions={route.coordinates}
                  pathOptions={{
                    color: color,
                    weight: 4,
                    opacity: 0.7,
                  }}
                />
                
                {/* Start marker */}
                <Marker
                  position={route.coordinates[0]}
                  icon={getMarkerIcon(color)}
                >
                  <Popup>
                    <div className="text-sm">
                      <strong>Start Point</strong>
                      <br />
                      Mode: {route.mode}
                    </div>
                  </Popup>
                </Marker>
                
                {/* End marker */}
                <Marker
                  position={route.coordinates[route.coordinates.length - 1]}
                  icon={getMarkerIcon(color)}
                >
                  <Popup>
                    <div className="text-sm">
                      <strong>Destination</strong>
                      <br />
                      Mode: {route.mode}
                      <br />
                      Distance: {(route.distance / 1000).toFixed(2)}km
                      <br />
                      Duration: {Math.floor(route.duration / 60)}min
                    </div>
                  </Popup>
                </Marker>
              </>
            )}
          </div>
        );
      })}
      
      <MapUpdater routes={routes} />
    </MapContainer>
  );
}
