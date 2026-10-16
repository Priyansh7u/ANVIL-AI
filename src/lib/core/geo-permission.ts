/** Maps a GeolocationPositionError code to a user-facing next step. Always offers the manual path. */
export type GeoOutcome = "PERMISSION_DENIED" | "POSITION_UNAVAILABLE" | "TIMEOUT" | "UNSUPPORTED";

export function geolocationOutcome(code: number | null): GeoOutcome {
  if (code === null) return "UNSUPPORTED";
  if (code === 1) return "PERMISSION_DENIED";
  if (code === 3) return "TIMEOUT";
  return "POSITION_UNAVAILABLE";
}

export function geolocationMessage(outcome: GeoOutcome): string {
  switch (outcome) {
    case "PERMISSION_DENIED":
      return "Location permission was denied. That's fine — search for your district below, or use demo mode.";
    case "TIMEOUT":
      return "Getting your location timed out. Search for your district below instead.";
    case "UNSUPPORTED":
      return "This browser does not support location. Please search for your district instead.";
    default:
      return "Your location could not be determined. Search for your district below instead.";
  }
}
