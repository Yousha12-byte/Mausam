````markdown
# MAUSAM

### Personalized Weather Interpretation Platform

> **One forecast. Different people. Different decisions.**

MAUSAM is a personalized weather application that goes beyond simply displaying weather data.

Instead of giving every user the same interpretation, MAUSAM combines:

**Weather + Location + Focus + Context → Personalized Insight**

The same weather can mean different things depending on what a person is doing.

---

## 🎯 Problem

Traditional weather apps mainly show information such as temperature, rain probability, wind and humidity.

Users still have to figure out what that information means for their own situation.

MAUSAM adds an interpretation layer between the forecast and the user's decision.

---

## 💡 Core Idea

The underlying weather forecast stays the same, while the interpretation changes according to the user's focus.

MAUSAM supports:

- Daily Life
- Commute / College
- Health
- Travel
- Work
- Agriculture
- Outdoor Activities
- Events

For example, the same rainfall can produce different insights:

- **Commute:** Your 5:30 PM journey may be affected.
- **Agriculture:** 10.9 mm expected in the next 12 hours.
- **Events:** 5.6 mm/h during your event window.
- **Health:** Environmental conditions such as apparent temperature and humidity.

---

## ✨ Key Features

- Personalized weather insights
- Focus-based interpretation
- Focus-specific schedules and context
- Explainable decisions through **Why?**
- Confidence information
- Live weather data
- Cached and simulated weather
- Deterministic demo scenarios
- Air quality information
- Location search and device location
- Responsive PWA
- Dynamic weather atmosphere

---

## 🧠 How It Works

```text
Weather Data
     ↓
Location + Time
     ↓
Selected Focus
     ↓
Relevant Context
     ↓
Decision Engine
     ↓
Personalized Insight
     ↓
Evidence + Confidence
````

Switching focus does not refetch the weather forecast.

The same forecast is interpreted through a different context.

---

## 🎯 Focus-Specific Context

Each focus owns its relevant context.

```text
Commute / College → Commute schedule
Work              → Work schedule
Travel            → Travel window
Agriculture        → Field window
Outdoor Activities → Activity window
Events             → Event window
Daily Life         → No mandatory schedule
Health             → Environmental/activity context
```

This prevents irrelevant information from affecting another focus.

For example, a college commute schedule cannot affect an Agriculture decision.

---

## 🌦️ Weather Data

The current live provider is **Open-Meteo**.

Available weather capabilities include:

* Temperature
* Apparent temperature
* Precipitation
* Precipitation probability
* Wind and gusts
* UV index
* Visibility
* Humidity
* Weather conditions
* Sunrise / sunset
* Rainfall accumulation
* Soil moisture
* Air quality / AQI

An IMD provider adapter is also present for future integration.

> Soil moisture is a numerical model estimate, not a physical field sensor reading.

---

## 🔍 Explainable Decisions

MAUSAM does not simply display a recommendation.

The **Why?** section shows the measurements and time window that contributed to the insight.

The decision engine evaluates:

1. Weather conditions
2. Relevant time window
3. Active focus
4. Focus-specific context
5. Weather thresholds
6. Supporting evidence

This keeps the system deterministic and explainable.

---

## 🌧️ Weather Atmosphere

The interface visually responds to weather conditions using Canvas2D and CSS.

Supported states include:

* Rain
* Thunderstorm
* Fog
* Cloudy
* Sunny
* Clear Night

---

## 🔄 Weather Reliability

MAUSAM distinguishes between:

* **Live** weather
* **Cached** weather
* **Simulated** weather
* **Demo** weather

The application does not silently present cached or simulated weather as live weather.

Demo scenarios are isolated from the user's actual saved location.

---

## 🎭 Demo Scenarios

Deterministic scenarios are included for presentations and testing.

They allow consistent demonstrations of different weather conditions without depending on real-time weather.

---

## 🏗️ Project Structure

```text
src/
├── atmosphere/     Weather visual effects
├── components/     React UI components
├── data/           Weather and provider integrations
├── domain/         Decision and personalization logic
├── lib/            Utilities
├── state/          Application state
└── styles/         Global styles and design tokens
```

---

## 🛠️ Technology Stack

| Technology      | Purpose                 |
| --------------- | ----------------------- |
| React           | User interface          |
| TypeScript      | Application development |
| Vite            | Build tooling           |
| Zustand         | State management        |
| CSS / Tailwind  | Styling                 |
| Canvas2D        | Weather atmosphere      |
| Open-Meteo      | Live weather            |
| Vitest          | Testing                 |
| vite-plugin-pwa | Progressive Web App     |
| Lucide          | Icons                   |

---

## 🧪 Testing

The final implementation includes automated tests covering the weather pipeline, decision engine, personalization, focus contexts, location, geolocation, solar calculations, air quality and scenarios.

Final verification included:

* **310 passing tests**
* TypeScript typecheck
* Production build
* Responsive viewport verification
* Focus switching verification
* Overflow checks
* Live/demo separation
* No forecast refetch when switching focus

---

## 🚀 Run Locally

### Requirements

* Node.js
* npm

### Installation

```bash
git clone https://github.com/Yousha12-byte/Mausam.git
cd Mausam
npm install
```

### Start Development Server

```bash
npm run dev
```

---

## ⚠️ Current Limitations

* The current decision engine is deterministic rather than an ML prediction model.
* Open-Meteo is currently used as the live weather provider.
* IMD integration is prepared but not fully implemented.
* Soil moisture is a model estimate rather than field sensor data.
* AQI depends on a separate source.
* Weather forecasts inherently contain uncertainty.
* MAUSAM is not a replacement for official warnings or professional medical/agricultural advice.

---

## 🔮 Future Scope

* Deeper IMD integration
* ML-based personalization
* Advanced forecasting and nowcasting
* Richer location/context integration
* Notifications and alerts
* Native mobile application
* Additional Indian language support

---

## 🎓 SIH 2026

**Problem Statement:**
Development of personalized homepage for the "Mausam" mobile application.

**Project:** MAUSAM

**Core Concept:**

> **One forecast. Different people. Different decisions.**

---

## 📂 Repository

[https://github.com/Yousha12-byte/Mausam](https://github.com/Yousha12-byte/Mausam)

```
```

