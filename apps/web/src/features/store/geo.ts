/** Coordinates as "14.599512, 120.984219", the way Google Maps copies them. */
export function parseCoordinates(input: string): { lat: number; lng: number } | null {
  const match = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(input);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Six decimals is about 10 cm: plenty, and short enough to read. */
export const formatCoordinates = (lat: number, lng: number) =>
  `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

export const mapsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

export interface Fix {
  lat: number;
  lng: number;
  /** Metres, as the device reports it. */
  accuracy: number;
}

export class LocationError extends Error {}

/**
 * One reading of this device's location (ATT-05: only when asked, never in the background),
 * with the same settings as clock-in will use: high accuracy, 10 s timeout, no cached fix.
 */
export function currentLocation(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new LocationError('This browser cannot read the location. Type the coordinates.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(
            new LocationError(
              'Location permission is off for this site. Allow it in the browser’s site settings, or type the coordinates.',
            ),
          );
        } else if (error.code === error.TIMEOUT) {
          reject(
            new LocationError('The location took too long. Check that GPS is on and try again.'),
          );
        } else {
          reject(
            new LocationError(
              'The location could not be read. Check that GPS is on and try again.',
            ),
          );
        }
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}
