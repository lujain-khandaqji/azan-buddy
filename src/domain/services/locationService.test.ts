import * as Location from 'expo-location';
import { resolveCurrentCity, DEFAULT_LOCATION } from './locationService';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

const mockedLocation = Location as jest.Mocked<typeof Location>;

describe('resolveCurrentCity', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('resolves the device city and country on a full success path', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 30.0444, longitude: 31.2357 },
    } as any);
    mockedLocation.reverseGeocodeAsync.mockResolvedValue([{ city: 'Cairo', country: 'Egypt' }] as any);

    const result = await resolveCurrentCity();

    expect(result).toEqual({ city: 'Cairo', country: 'Egypt' });
    expect(mockedLocation.reverseGeocodeAsync).toHaveBeenCalledWith({
      latitude: 30.0444,
      longitude: 31.2357,
    });
  });

  it('falls back to Amman, Jordan when permission is denied', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as any);

    const result = await resolveCurrentCity();

    expect(result).toEqual(DEFAULT_LOCATION);
    expect(mockedLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('falls back to Amman, Jordan when requesting permission itself throws', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockRejectedValue(new Error('Permissions API error'));

    const result = await resolveCurrentCity();

    expect(result).toEqual(DEFAULT_LOCATION);
  });

  it('falls back to Amman, Jordan when the device location is unavailable (getCurrentPositionAsync throws)', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
    mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error('Location unavailable'));

    const result = await resolveCurrentCity();

    expect(result).toEqual(DEFAULT_LOCATION);
    expect(mockedLocation.reverseGeocodeAsync).not.toHaveBeenCalled();
  });

  it('falls back to Amman, Jordan when reverse geocoding throws', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 30.0444, longitude: 31.2357 },
    } as any);
    mockedLocation.reverseGeocodeAsync.mockRejectedValue(new Error('Geocoder failed'));

    const result = await resolveCurrentCity();

    expect(result).toEqual(DEFAULT_LOCATION);
  });

  it('falls back to Amman, Jordan when reverse geocoding returns no results', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 30.0444, longitude: 31.2357 },
    } as any);
    mockedLocation.reverseGeocodeAsync.mockResolvedValue([]);

    const result = await resolveCurrentCity();

    expect(result).toEqual(DEFAULT_LOCATION);
  });

  it('falls back to Amman, Jordan when the reverse-geocoded result is missing a city', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 30.0444, longitude: 31.2357 },
    } as any);
    mockedLocation.reverseGeocodeAsync.mockResolvedValue([{ city: null, country: 'Egypt' }] as any);

    const result = await resolveCurrentCity();

    expect(result).toEqual(DEFAULT_LOCATION);
  });

  it('falls back to Amman, Jordan when the reverse-geocoded result is missing a country', async () => {
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 30.0444, longitude: 31.2357 },
    } as any);
    mockedLocation.reverseGeocodeAsync.mockResolvedValue([{ city: 'Cairo', country: null }] as any);

    const result = await resolveCurrentCity();

    expect(result).toEqual(DEFAULT_LOCATION);
  });
});
