import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA, type Options as PWAOptions } from "vite-plugin-pwa";

/**
 * vite-plugin-pwa's ManifestOptions predates the spec's `permissions` member,
 * but the plugin passes the manifest straight through to the generated file.
 * Declaring the one member we need keeps the config type-checked rather than
 * forcing a cast over the whole object.
 */
type AppManifest = Partial<NonNullable<PWAOptions["manifest"]>> & {
  permissions?: string[];
};

    const appManifest: AppManifest = {
      name: "Mausam — What the weather means for you",
      short_name: "Mausam",
      description:
        "Personalized weather decisions for your day: what the weather is doing, what it means for your routine, and what to do about it.",
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      display_override: ["standalone", "minimal-ui"],
      orientation: "portrait",
      background_color: "#0b1220",
      theme_color: "#0b1220",
      categories: ["weather", "lifestyle", "utilities"],
      lang: "en-IN",
      dir: "ltr",
      // An installed app cannot prompt for a fix without this. It only ever
      // shows when the user asks for their location, never on launch.
      permissions: ["geolocation"],
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
      shortcuts: [
        {
          name: "My routine",
          short_name: "Routine",
          url: "/?sheet=routine",
          icons: [{ src: "/icon-192.png", sizes: "192x192" }],
        },
      ],
    }

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon-64.png",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png",
        "icon-maskable-512.png",
      ],
      manifest: appManifest,
      workbox: {
        // The app is a small shell plus a weather API. Precaching the shell is
        // what makes the second launch work with no network at all.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // NetworkOnly, deliberately. A NetworkFirst rule answers from cache
            // after a 6s stall and hands back a 200, so the app cannot tell it
            // happened and a replayed forecast would be labelled live. The app
            // keeps its own snapshot per location instead, and labels it.
            urlPattern: /^https:\/\/api\.open-meteo\.com\/.*/i,
            handler: "NetworkOnly",
          },
          {
            // Place search and reverse lookup. Same reasoning as the forecast:
            // fresh when possible, but a cached answer beats a dead picker. These
            // are stable reference data, so replaying one is harmless.
            urlPattern: /^https:\/\/(geocoding-api\.open-meteo\.com|api\.bigdatacloud\.net)\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "geocode",
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: true, port: 5173 },
});
