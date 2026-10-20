import { templates, type Locale } from "@mia/shared";

export interface WeatherToday { maxTempC: number; rainChance: number }
export interface WeatherProvider { today(latitude: number, longitude: number, date: string): Promise<WeatherToday | null> }

export const COLD_BELOW_C = 10;
export const RAIN_FROM_PERCENT = 50;
/** Keeps the tool under the Alexa+ 500 ms limit. */
export const WEATHER_TIMEOUT_MS = 250;

interface OpenMeteoDaily { daily?: { temperature_2m_max?: number[]; precipitation_probability_max?: (number | null)[] } }

/** Free forecast API, no key. Successful answers are cached per place and day; failures are not cached. */
export class OpenMeteoWeather implements WeatherProvider {
  private readonly cache = new Map<string, WeatherToday>();

  constructor(private readonly fetchFn: typeof fetch = fetch, private readonly timeoutMs = WEATHER_TIMEOUT_MS) {}

  async today(latitude: number, longitude: number, date: string): Promise<WeatherToday | null> {
    const key = `${latitude},${longitude},${date}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&daily=temperature_2m_max,precipitation_probability_max&timezone=auto&start_date=${date}&end_date=${date}`;
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return null;
      const body = (await res.json()) as OpenMeteoDaily;
      const maxTempC = body.daily?.temperature_2m_max?.[0];
      if (typeof maxTempC !== "number") return null;
      const w: WeatherToday = { maxTempC, rainChance: body.daily?.precipitation_probability_max?.[0] ?? 0 };
      this.cache.set(key, w);
      return w;
    } catch {
      return null;
    }
  }
}

/** One plain sentence pair for the way out, or nothing. Cold is more important than rain. */
export function weatherLine(w: WeatherToday | null, locale: Locale): string | null {
  if (!w) return null;
  const T = templates(locale);
  if (w.maxTempC < COLD_BELOW_C) return T.weatherCold();
  if (w.rainChance >= RAIN_FROM_PERCENT) return T.weatherRain();
  return null;
}
