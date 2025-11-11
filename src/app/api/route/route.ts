import { NextRequest, NextResponse } from "next/server";

type TransportMode = "car" | "cycling" | "walking" | "bus" | "train" | "flight";
type OptimizationMode = "shortest" | "cheapest" | "fastest";

interface RouteRequest {
  boardingPoints: string[];
  destination: string;
  transportMode: TransportMode;
  optimizationMode: OptimizationMode;
}

interface RouteData {
  coordinates: [number, number][];
  distance: number;
  duration: number;
  cost: number;
  mode: TransportMode;
  instructions?: Array<{
    distance: number;
    duration: number;
    instruction: string;
    name: string;
    type: string;
  }>;
}

// Map transport modes to OSRM profiles
function mapToOSRMProfile(mode: TransportMode): string {
  const profileMap: Record<TransportMode, string> = {
    car: 'car',
    cycling: 'bike',
    walking: 'foot',
    bus: 'car', // Fallback to car for bus
    train: 'car', // Fallback to car for train
    flight: 'car', // Fallback to car for flight
  };
  return profileMap[mode] || 'car';
}

// Geocoding function using Nominatim (OpenStreetMap)
async function geocode(location: string): Promise<[number, number] | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1`,
      {
        headers: {
          'User-Agent': 'TravelCompanionApp/1.0',
        },
      }
    );

    const data = await response.json();
    
    if (data && data.length > 0) {
      const { lat, lon } = data[0];
      return [parseFloat(lon), parseFloat(lat)];
    }
    return null;
  } catch (error) {
    console.error("Geocoding error:", error);
    return null;
  }
}

// Calculate route using OSRM (Open Source Routing Machine)
async function calculateRoute(
  start: [number, number],
  end: [number, number],
  mode: TransportMode
): Promise<{ coordinates: [number, number][]; distance: number; duration: number; instructions?: any[] } | null> {
  try {
    const profile = mapToOSRMProfile(mode);
    const coords = `${start[0]},${start[1]};${end[0]},${end[1]}`;
    
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=true&alternatives=false`,
      {
        headers: {
          'User-Agent': 'TravelCompanionApp/1.0',
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('OSRM API error:', response.status, error);
      return null;
    }

    const data = await response.json();
    
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      console.error('No routes found in OSRM response:', data.code);
      return null;
    }

    const route = data.routes[0];
    
    // Extract coordinates from GeoJSON geometry (already in [lon, lat] format)
    const coordinates: [number, number][] = route.geometry.coordinates.map(
      (coord: number[]) => [coord[1], coord[0]] // Convert [lon, lat] to [lat, lon] for Leaflet
    );
    
    // Extract turn-by-turn instructions from legs
    const instructions: any[] = [];
    if (route.legs && route.legs[0]?.steps) {
      route.legs[0].steps.forEach((step: any) => {
        if (step.maneuver) {
          const instruction = formatManeuver(step.maneuver, step.name);
          instructions.push({
            distance: step.distance,
            duration: step.duration,
            instruction: instruction,
            name: step.name || 'Unnamed road',
            type: step.maneuver.type,
          });
        }
      });
    }

    return {
      coordinates: coordinates,
      distance: route.distance, // in meters
      duration: route.duration, // in seconds
      instructions: instructions,
    };
  } catch (error) {
    console.error("Route calculation error:", error);
    return null;
  }
}

// Format OSRM maneuver into human-readable instruction
function formatManeuver(maneuver: any, roadName: string): string {
  const name = roadName || 'the road';
  
  switch (maneuver.type) {
    case 'depart':
      return `Head ${getDirection(maneuver.bearing_after)} on ${name}`;
    case 'arrive':
      return `Arrive at your destination`;
    case 'turn':
      if (maneuver.modifier === 'left') return `Turn left onto ${name}`;
      if (maneuver.modifier === 'right') return `Turn right onto ${name}`;
      if (maneuver.modifier === 'sharp left') return `Sharp left onto ${name}`;
      if (maneuver.modifier === 'sharp right') return `Sharp right onto ${name}`;
      if (maneuver.modifier === 'slight left') return `Slight left onto ${name}`;
      if (maneuver.modifier === 'slight right') return `Slight right onto ${name}`;
      return `Turn onto ${name}`;
    case 'continue':
      return `Continue on ${name}`;
    case 'merge':
      return `Merge onto ${name}`;
    case 'on ramp':
      return `Take the ramp onto ${name}`;
    case 'off ramp':
      return `Take the exit onto ${name}`;
    case 'fork':
      if (maneuver.modifier === 'left') return `Keep left at the fork onto ${name}`;
      if (maneuver.modifier === 'right') return `Keep right at the fork onto ${name}`;
      return `Continue at the fork onto ${name}`;
    case 'roundabout':
    case 'rotary':
      const exit = maneuver.exit || 1;
      return `At the roundabout, take exit ${exit} onto ${name}`;
    case 'end of road':
      if (maneuver.modifier === 'left') return `At the end of the road, turn left onto ${name}`;
      if (maneuver.modifier === 'right') return `At the end of the road, turn right onto ${name}`;
      return `At the end of the road, continue onto ${name}`;
    default:
      return `Continue on ${name}`;
  }
}

// Get cardinal direction from bearing
function getDirection(bearing: number): string {
  const directions = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
}

// Estimate cost based on distance and mode
function estimateCost(distanceKm: number, mode: TransportMode): number {
  const costPerKm: Record<TransportMode, number> = {
    car: 0.5,
    cycling: 0,
    walking: 0,
    bus: 0.15,
    train: 0.25,
    flight: 0.8,
  };
  
  const rate = costPerKm[mode] || 0.3;
  return distanceKm * rate;
}

export async function POST(request: NextRequest) {
  try {
    const body: RouteRequest = await request.json();
    const { boardingPoints, destination, transportMode, optimizationMode } = body;

    // Validate input
    if (!boardingPoints || boardingPoints.length === 0) {
      return NextResponse.json(
        { error: "At least one boarding point is required" },
        { status: 400 }
      );
    }

    if (!destination) {
      return NextResponse.json(
        { error: "Destination is required" },
        { status: 400 }
      );
    }

    // Geocode all locations
    const startCoords = await geocode(boardingPoints[0]);
    const destCoords = await geocode(destination);

    if (!startCoords || !destCoords) {
      return NextResponse.json(
        { error: "Unable to find one or more locations. Please use more specific addresses (e.g., 'New York, NY, USA')" },
        { status: 400 }
      );
    }

    // Calculate routes for the selected transport mode
    const routes: RouteData[] = [];

    // Main route
    const mainRoute = await calculateRoute(startCoords, destCoords, transportMode);
    if (mainRoute) {
      const distance = mainRoute.distance;
      const duration = mainRoute.duration;
      let cost = estimateCost(distance / 1000, transportMode);

      // Adjust based on optimization mode
      if (optimizationMode === "cheapest") {
        cost = cost * 0.8; // Apply discount for cheapest route
      }

      routes.push({
        coordinates: mainRoute.coordinates,
        distance: mainRoute.distance,
        duration: mainRoute.duration,
        cost,
        mode: transportMode,
        instructions: mainRoute.instructions,
      });
    }

    // If multiple boarding points, calculate additional routes
    for (let i = 1; i < boardingPoints.length; i++) {
      const pointCoords = await geocode(boardingPoints[i]);
      if (pointCoords) {
        const route = await calculateRoute(pointCoords, destCoords, transportMode);
        if (route) {
          routes.push({
            coordinates: route.coordinates,
            distance: route.distance,
            duration: route.duration,
            cost: estimateCost(route.distance / 1000, transportMode),
            mode: transportMode,
            instructions: route.instructions,
          });
        }
      }
    }

    if (routes.length === 0) {
      return NextResponse.json(
        { error: "Unable to calculate route. Please try different locations or transport mode." },
        { status: 400 }
      );
    }

    return NextResponse.json({ routes });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "An error occurred while calculating the route" },
      { status: 500 }
    );
  }
}