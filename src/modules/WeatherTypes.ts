// ─── WEATHER TYPES ────────────────────────────────────────────────────────────

export interface WeatherCurrent {
  temp:          number;       // °C
  feelsLike:     number;       // °C
  description:   string;       // e.g. "Sunny"
  icon:          string;       // emoji
  windSpeed:     number;       // km/h
  humidity:      number;       // %
  visibility:    number;       // km
  pressure:      number;       // hPa
  uvIndex:       number;
  dewPoint:      number;       // °C
  weatherCode:   number;
}

export interface WeatherSun {
  sunrise: string;   // "05:42"
  sunset:  string;   // "19:42"
  /** 0–1 progress of current time between sunrise and sunset */
  progress: number;
}

export interface HourlyPoint {
  time:        string;   // "13:00"
  temp:        number;
  icon:        string;
  weatherCode: number;
}

export interface DailyPoint {
  label:       string;   // "Tue"
  icon:        string;
  tempMax:     number;
  tempMin:     number;
  weatherCode: number;
}

export interface RunAdvice {
  ideal:   boolean;
  message: string;
  detail:  string;
}

export interface WeatherData {
  location:  string;       // "Gdańsk, Poland"
  current:   WeatherCurrent;
  sun:       WeatherSun;
  hourly:    HourlyPoint[];  // next 6 hours
  daily:     DailyPoint[];   // next 3 days
  advice:    RunAdvice;
}

/** Minimal subset used by the top bar */
export type WeatherTopBarData = Pick<WeatherData, 'location' | 'current'>;

/** Raw Open-Meteo API response shape (partial) */
export interface OpenMeteoFull {
  current: {
    time:                   string;
    temperature_2m:         number;
    apparent_temperature:   number;
    weathercode:            number;
    wind_speed_10m:         number;
    relative_humidity_2m:   number;
    visibility:             number;
    pressure_msl:           number;
    uv_index:               number;
    dew_point_2m:           number;
  };
  daily: {
    time:              string[];
    weathercode:       number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    sunrise:           string[];
    sunset:            string[];
  };
  hourly: {
    time:           string[];
    temperature_2m: number[];
    weathercode:    number[];
  };
}
