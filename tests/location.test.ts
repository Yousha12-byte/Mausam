import { describe, expect, it } from "vitest";
import {
  DEMO_LOCATION,
  coercePlace,
  formatPlace,
  isUsable,
  shortAdmin,
} from "../src/domain/location";
import { placeSubtitle } from "../src/lib/geocode";

describe("demo location", () => {
  it("is pinned to Kochi so a demo is identical everywhere", () => {
    expect(DEMO_LOCATION).toEqual({
      name: "Kochi",
      admin: "Kerala",
      lat: 9.9312,
      lon: 76.2673,
      timezone: "Asia/Kolkata",
    });
  });

  it("carries usable coordinates", () => {
    expect(isUsable(DEMO_LOCATION)).toBe(true);
  });
});

describe("shortAdmin", () => {
  it("shortens the one verbose Indian subdivision", () => {
    expect(shortAdmin("National Capital Territory of Delhi")).toBe("Delhi");
    expect(formatPlace({ ...DEMO_LOCATION, name: "Delhi", admin: "National Capital Territory of Delhi" })).toBe(
      "Delhi · Delhi",
    );
  });

  it("leaves ordinary names alone", () => {
    expect(shortAdmin("Maharashtra")).toBe("Maharashtra");
    expect(shortAdmin("Kerala")).toBe("Kerala");
  });

  it("tolerates surrounding whitespace and empties", () => {
    expect(shortAdmin("  Kerala  ")).toBe("Kerala");
    expect(shortAdmin("")).toBe("");
  });
});

describe("formatPlace", () => {
  it("reads as the header line", () => {
    expect(formatPlace({ name: "Mumbai", admin: "Maharashtra", lat: 19.07, lon: 72.87 })).toBe(
      "Mumbai · Maharashtra",
    );
  });

  it("omits the separator when the region is unknown", () => {
    expect(formatPlace({ name: "Current location", admin: "", lat: 0, lon: 0 })).toBe(
      "Current location",
    );
  });
});

describe("isUsable", () => {
  it("accepts a real place", () => {
    expect(isUsable({ name: "Pune", admin: "Maharashtra", lat: 18.52, lon: 73.86 })).toBe(true);
  });

  it("rejects coordinates outside the globe", () => {
    expect(isUsable({ name: "Nowhere", admin: "", lat: 91, lon: 0 })).toBe(false);
    expect(isUsable({ name: "Nowhere", admin: "", lat: 0, lon: 181 })).toBe(false);
  });

  it("rejects non-finite and missing values", () => {
    expect(isUsable({ name: "NaN", admin: "", lat: Number.NaN, lon: 0 })).toBe(false);
    expect(isUsable({ admin: "", lat: 0, lon: 0 })).toBe(false);
    expect(isUsable({ name: "Blank", admin: "", lat: 0, lon: 0, })).toBe(true);
    expect(isUsable({ name: "   ", admin: "", lat: 0, lon: 0 })).toBe(false);
    expect(isUsable(null)).toBe(false);
    expect(isUsable(undefined)).toBe(false);
  });
});

describe("coercePlace", () => {
  it("keeps a well-formed stored place", () => {
    expect(coercePlace({ name: "Mumbai", admin: "Maharashtra", lat: 19.07, lon: 72.87 })).toEqual({
      name: "Mumbai",
      admin: "Maharashtra",
      lat: 19.07,
      lon: 72.87,
    });
  });

  it("fills in a missing region rather than rejecting the place", () => {
    expect(coercePlace({ name: "Mumbai", lat: 19.07, lon: 72.87 })).toEqual({
      name: "Mumbai",
      admin: "",
      lat: 19.07,
      lon: 72.87,
    });
  });

  it("rejects anything that is not a place", () => {
    expect(coercePlace(null)).toBeNull();
    expect(coercePlace("Kochi")).toBeNull();
    expect(coercePlace({ name: "Kochi", lat: 999, lon: 0 })).toBeNull();
    expect(coercePlace({ admin: "Kerala", lat: 9.93, lon: 76.27 })).toBeNull();
  });

  it("survives a hand-edited or truncated storage entry", () => {
    expect(coercePlace({ name: "Pune" })).toBeNull();
    expect(coercePlace({})).toBeNull();
    expect(coercePlace(undefined)).toBeNull();
  });
});

describe("placeSubtitle", () => {
  const base = { name: "Pune", admin: "Maharashtra", lat: 18.52, lon: 73.86, countryCode: "IN" };

  it("shows region and country so an international namesake is distinguishable", () => {
    expect(placeSubtitle({ ...base, country: "India" })).toBe("Maharashtra · India");
    expect(placeSubtitle({ ...base, admin: "", country: "India" })).toBe("India");
    expect(placeSubtitle({ ...base, country: "" })).toBe("Maharashtra");
  });
});
