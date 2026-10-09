import { describe, expect, it } from "vitest";
import { roseDe } from "@mia/shared";
import { at } from "@mia/shared/testing";
import { OpenMeteoWeather, weatherLine, type WeatherProvider } from "../src/weather";
import { connect } from "./helpers";

const okResponse = (max: number, rain: number | null) =>
  new Response(JSON.stringify({ daily: { temperature_2m_max: [max], precipitation_probability_max: [rain] } }), { status: 200 });

describe("OpenMeteoWeather", () => {
  it("asks Open-Meteo for one day and caches the answer", async () => {
    const urls: string[] = [];
    const w = new OpenMeteoWeather((async (url: string | URL | Request) => { urls.push(String(url)); return okResponse(6.5, 20); }) as typeof fetch);
    expect(await w.today(39.9612, -82.9988, "2026-10-12")).toEqual({ maxTempC: 6.5, rainChance: 20 });
    expect(await w.today(39.9612, -82.9988, "2026-10-12")).toEqual({ maxTempC: 6.5, rainChance: 20 });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("https://api.open-meteo.com/v1/forecast?latitude=39.9612&longitude=-82.9988");
    expect(urls[0]).toContain("daily=temperature_2m_max,precipitation_probability_max");
    expect(urls[0]).toContain("start_date=2026-10-12&end_date=2026-10-12");
  });
  it("missing rain chance counts as 0", async () => {
    const w = new OpenMeteoWeather((async () => okResponse(15, null)) as typeof fetch);
    expect(await w.today(1, 2, "2026-10-12")).toEqual({ maxTempC: 15, rainChance: 0 });
  });
  it("network error, HTTP error or odd JSON → null, and nothing is cached", async () => {
    let calls = 0;
    const failing = new OpenMeteoWeather((async () => { calls++; throw new Error("offline"); }) as typeof fetch);
    expect(await failing.today(1, 2, "2026-10-12")).toBeNull();
    expect(await failing.today(1, 2, "2026-10-12")).toBeNull();
    expect(calls).toBe(2);
    expect(await new OpenMeteoWeather((async () => new Response("", { status: 503 })) as typeof fetch).today(1, 2, "d")).toBeNull();
    expect(await new OpenMeteoWeather((async () => new Response("{}", { status: 200 })) as typeof fetch).today(1, 2, "d")).toBeNull();
  });
  it("gives up after the timeout", async () => {
    const slow = (async (_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) =>
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    expect(await new OpenMeteoWeather(slow, 20).today(1, 2, "2026-10-12")).toBeNull();
  });
});

describe("weatherLine", () => {
  it("cold wins over rain; mild and dry says nothing", () => {
    expect(weatherLine({ maxTempC: 5, rainChance: 80 }, "en-US")).toBe("It's cold today. Wear your warm coat.");
    expect(weatherLine({ maxTempC: 15, rainChance: 70 }, "en-US")).toBe("It may rain today. Take your umbrella.");
    expect(weatherLine({ maxTempC: 15, rainChance: 10 }, "en-US")).toBeNull();
    expect(weatherLine({ maxTempC: 5, rainChance: 0 }, "de-DE")).toBe("Heute ist es kalt. Zieh deinen warmen Mantel an.");
    expect(weatherLine(null, "en-US")).toBeNull();
  });
});

describe("get_preparation_steps with weather", () => {
  const cold: WeatherProvider = { today: async () => ({ maxTempC: 4, rainChance: 0 }) };
  it("first step starts with the weather sentence", async () => {
    const m = await connect(at("2026-10-12T09:00:00"), undefined, { weather: cold });
    const r = await m.call("get_preparation_steps");
    expect(r.say).toEqual(["It's cold today. Wear your warm coat.", "Take your keys on the red lanyard and your handbag."]);
    expect(r.facts).toMatchObject({ weather: "It's cold today. Wear your warm coat." });
    expect((await m.call("get_preparation_steps", { step: 1 })).say).toEqual(["Take your glasses and your coat."]);
  });
  it("German", async () => {
    const r = await (await connect(at("2026-10-12T09:00:00"), roseDe(), { weather: cold })).call("get_preparation_steps");
    expect(r.say[0]).toBe("Heute ist es kalt. Zieh deinen warmen Mantel an.");
  });
  it("no weather available: unchanged", async () => {
    const none: WeatherProvider = { today: async () => null };
    const r = await (await connect(at("2026-10-12T09:00:00"), undefined, { weather: none })).call("get_preparation_steps");
    expect(r.say).toEqual(["Take your keys on the red lanyard and your handbag."]);
  });
});
