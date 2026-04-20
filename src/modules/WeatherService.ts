// ─── WEATHER SERVICE ──────────────────────────────────────────────────────────
// Fetches all required fields from Open-Meteo (free, no API key needed).
// Replaces the old WeatherWidget.ts fetch logic.

import type {
  WeatherData, WeatherCurrent, WeatherSun,
  HourlyPoint, DailyPoint, RunAdvice,
  OpenMeteoFull,
} from './WeatherTypes.js';

import type { Coords } from '../types/index.js';

// ── WMO weather code → emoji + description ────────────────────────────────────

interface WmoInfo { icon: string; description: string }

// Day icons
const WMO_DAY: Record<number, WmoInfo> = {
  0:  { icon: '☀️',  description: 'Clear sky' },
  1:  { icon: '🌤️', description: 'Mainly clear' },
  2:  { icon: '⛅',  description: 'Partly cloudy' },
  3:  { icon: '☁️',  description: 'Overcast' },
  45: { icon: '🌫️', description: 'Fog' },
  48: { icon: '🌫️', description: 'Rime fog' },
  51: { icon: '🌦️', description: 'Light drizzle' },
  53: { icon: '🌦️', description: 'Drizzle' },
  55: { icon: '🌧️', description: 'Dense drizzle' },
  61: { icon: '🌧️', description: 'Slight rain' },
  63: { icon: '🌧️', description: 'Moderate rain' },
  65: { icon: '🌧️', description: 'Heavy rain' },
  71: { icon: '🌨️', description: 'Slight snow' },
  73: { icon: '🌨️', description: 'Moderate snow' },
  75: { icon: '❄️',  description: 'Heavy snow' },
  77: { icon: '🌨️', description: 'Snow grains' },
  80: { icon: '🌦️', description: 'Rain showers' },
  81: { icon: '🌧️', description: 'Heavy showers' },
  82: { icon: '⛈️',  description: 'Violent showers' },
  85: { icon: '🌨️', description: 'Snow showers' },
  86: { icon: '❄️',  description: 'Heavy snow showers' },
  95: { icon: '⛈️',  description: 'Thunderstorm' },
  96: { icon: '⛈️',  description: 'Thunderstorm + hail' },
  99: { icon: '⛈️',  description: 'Thunderstorm + heavy hail' },
};

// Night icons — codes 0-2 get moon variants, rest stays the same
const WMO_NIGHT: Record<number, WmoInfo> = {
  ...WMO_DAY,
  0:  { icon: '🌙',  description: 'Clear night' },
  1:  { icon: '🌙',  description: 'Mainly clear' },
  2:  { icon: '🌑',  description: 'Partly cloudy' },
  3:  { icon: '☁️',  description: 'Overcast' },
};

/** Returns icon + description, using night variants when isNight=true */
export function wmoInfo(code: number, isNight = false): WmoInfo {
  const WMO = isNight ? WMO_NIGHT : WMO_DAY;
  if (WMO[code]) return WMO[code];
  if (code <= 1)  return WMO[1];
  if (code <= 3)  return WMO[3];
  if (code <= 48) return WMO[45];
  if (code <= 55) return WMO[55];
  if (code <= 65) return WMO[65];
  if (code <= 77) return WMO[77];
  if (code <= 82) return WMO[82];
  if (code <= 86) return WMO[86];
  return WMO[95];
}

// ── Night detection ───────────────────────────────────────────────────────────

/** Returns true if current time is before sunrise or after sunset */
export function isNightTime(sunriseISO: string, sunsetISO: string): boolean {
  const now  = Date.now();
  const rise = new Date(sunriseISO).getTime();
  const set_ = new Date(sunsetISO).getTime();
  return now < rise || now > set_;
}

// ── UV index label ────────────────────────────────────────────────────────────

export function uvLabel(uv: number): string {
  if (uv <= 2)  return 'Low';
  if (uv <= 5)  return 'Moderate';
  if (uv <= 7)  return 'High';
  if (uv <= 10) return 'Very High';
  return 'Extreme';
}

// ── Sun progress (0–1) ────────────────────────────────────────────────────────

function sunProgress(sunriseISO: string, sunsetISO: string): number {
  const now     = Date.now();
  const rise    = new Date(sunriseISO).getTime();
  const set_    = new Date(sunsetISO).getTime();
  if (now <= rise) return 0;
  if (now >= set_) return 1;
  return (now - rise) / (set_ - rise);
}

// ── Format ISO time → "HH:MM" ─────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ── Day label ─────────────────────────────────────────────────────────────────

function dayLabel(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en', { weekday: 'short' });
}

// ── Run advice ────────────────────────────────────────────────────────────────

function buildAdvice(current: WeatherCurrent): RunAdvice {
  const { weatherCode, windSpeed, uvIndex, temp } = current;
  const isRain   = weatherCode >= 51;
  const isWindy  = windSpeed > 30;
  const isTooHot = temp > 32;
  const isTooCold= temp < 2;

  if (!isRain && !isWindy && !isTooHot && !isTooCold) {
    const uvOk = uvIndex <= 5;
    return {
      ideal:   true,
      message: '🏃 Great conditions for a run!',
      detail:  `${uvOk ? 'Moderate UV' : 'High UV — use sunscreen'}, light wind, no rain expected.`,
    };
  }

  const reasons: string[] = [];
  if (isRain)    reasons.push('rain expected');
  if (isWindy)   reasons.push('strong winds');
  if (isTooHot)  reasons.push('high temperature');
  if (isTooCold) reasons.push('very cold');

  return {
    ideal:   false,
    message: '⚠️ Not ideal for outdoor activity',
    detail:  `Conditions: ${reasons.join(', ')}.`,
  };
}

// ── Reverse geocoding (Nominatim) ─────────────────────────────────────────────

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url  = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json() as {
      address?: { city?: string; town?: string; village?: string; country?: string }
    };
    const city    = data.address?.city ?? data.address?.town ?? data.address?.village ?? 'Unknown';
    const country = data.address?.country ?? '';
    return country ? `${city}, ${country}` : city;
  } catch {
    return 'Unknown location';
  }
}

// ── Main fetch function ───────────────────────────────────────────────────────

export async function fetchWeatherFull(coords: Coords): Promise<WeatherData> {
  const [lat, lon] = coords;

  const params = new URLSearchParams({
    latitude:  String(lat),
    longitude: String(lon),
    current: [
      'temperature_2m',
      'apparent_temperature',
      'weathercode',
      'wind_speed_10m',
      'relative_humidity_2m',
      'visibility',
      'pressure_msl',
      'uv_index',
      'dew_point_2m',
    ].join(','),
    hourly: 'temperature_2m,weathercode',
    daily: [
      'weathercode',
      'temperature_2m_max',
      'temperature_2m_min',
      'sunrise',
      'sunset',
    ].join(','),
    timezone:      'auto',
    forecast_days: '4',
  });

  const [meteoRes, location] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?${params}`),
    reverseGeocode(lat, lon),
  ]);

  if (!meteoRes.ok) throw new Error(`Open-Meteo error: ${meteoRes.status}`);
  const raw = await meteoRes.json() as OpenMeteoFull;

  const c = raw.current;
  // Detect night using today's sunrise/sunset
  const night = isNightTime(raw.daily.sunrise[0], raw.daily.sunset[0]);
  const info  = wmoInfo(c.weathercode, night);

  const current: WeatherCurrent = {
    temp:        Math.round(c.temperature_2m),
    feelsLike:   Math.round(c.apparent_temperature),
    description: info.description,
    icon:        info.icon,
    windSpeed:   Math.round(c.wind_speed_10m),
    humidity:    Math.round(c.relative_humidity_2m),
    visibility:  Math.round((c.visibility ?? 10000) / 1000),
    pressure:    Math.round(c.pressure_msl),
    uvIndex:     Math.round(c.uv_index ?? 0),
    dewPoint:    Math.round(c.dew_point_2m),
    weatherCode: c.weathercode,
  };

  // Sun
  const sun: WeatherSun = {
    sunrise:  fmtTime(raw.daily.sunrise[0]),
    sunset:   fmtTime(raw.daily.sunset[0]),
    progress: sunProgress(raw.daily.sunrise[0], raw.daily.sunset[0]),
  };

  // Hourly — next 6 hours from now
  const nowHour  = new Date().getHours();
  const hourly: HourlyPoint[] = [];
  for (let i = 0; i < raw.hourly.time.length && hourly.length < 6; i++) {
    const h = new Date(raw.hourly.time[i]).getHours();
    if (new Date(raw.hourly.time[i]) > new Date()) {
      const hNight = isNightTime(raw.daily.sunrise[0], raw.daily.sunset[0]);
      hourly.push({
        time:        fmtTime(raw.hourly.time[i]),
        temp:        Math.round(raw.hourly.temperature_2m[i]),
        icon:        wmoInfo(raw.hourly.weathercode[i], hNight).icon,
        weatherCode: raw.hourly.weathercode[i],
      });
    }
  }

  // Daily — skip today (index 0), take next 3
  const daily: DailyPoint[] = raw.daily.time.slice(1, 4).map((date, i) => ({
    label:       dayLabel(date),
    icon:        wmoInfo(raw.daily.weathercode[i + 1]).icon,
    tempMax:     Math.round(raw.daily.temperature_2m_max[i + 1]),
    tempMin:     Math.round(raw.daily.temperature_2m_min[i + 1]),
    weatherCode: raw.daily.weathercode[i + 1],
  }));

  return {
    location,
    current,
    sun,
    hourly,
    daily,
    advice: buildAdvice(current),
  };
}

// ── Singleton cache (refresh every 30 min) ────────────────────────────────────

let _cache:     WeatherData | null = null;
let _cacheTime: number             = 0;
const CACHE_TTL = 30 * 60 * 1000;

export async function getWeather(coords: Coords): Promise<WeatherData> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
  _cache     = await fetchWeatherFull(coords);
  _cacheTime = Date.now();
  return _cache;
}
