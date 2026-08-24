// Plain TypeScript domain service — no React or UI imports. resolveCurrentCity
// never throws and never resolves to an unusable value: any failure at any step
// (permission denied, location unavailable, reverse geocoding failed or empty,
// missing city/country) falls back to Amman, Jordan.

import * as Location from 'expo-location';

import { DEFAULT_CITY, DEFAULT_COUNTRY } from './prayerTimesService';

export interface CityLocation {
  city: string;
  country: string;
}

export const DEFAULT_LOCATION: CityLocation = { city: DEFAULT_CITY, country: DEFAULT_COUNTRY };

async function getDeviceCoordinates(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return null;
    }

    const position = await Location.getCurrentPositionAsync();
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch {
    return null;
  }
}

async function reverseGeocodeToCity(coords: {
  latitude: number;
  longitude: number;
}): Promise<CityLocation | null> {
  try {
    const [place] = await Location.reverseGeocodeAsync(coords);
    if (!place?.city || !place?.country) {
      return null;
    }
    return { city: place.city, country: place.country };
  } catch {
    return null;
  }
}

export async function resolveCurrentCity(): Promise<CityLocation> {
  const coords = await getDeviceCoordinates();
  if (!coords) {
    return DEFAULT_LOCATION;
  }

  const place = await reverseGeocodeToCity(coords);
  return place ?? DEFAULT_LOCATION;
}
