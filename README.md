# Torn Race Car Picker

A [Torn City](https://www.torn.com) userscript that shows the **fastest car model for the track of your current race**.

While a race is open, one row shows on the race page (in the **Current car** box) and on the **Change Car** page:

> Fastest car for Speedway: **Stormatti Casteon** (class A) · lap 00:26.19 (record by ToxicMonkeyMZC) — change to it
> Per class — A: Stormatti Casteon 00:26.19 · B: Bavaria M5 00:27.50 · C: Oceania SS 00:28.81 · D: Tabata RM2 00:30.31 · E: Stålhög 860 00:32.14

- **Green** — your current car is already the fastest model.
- **Amber** — another model is faster.

Click the **i** button in the row to open the **car plan**: a table with the car and build for every track. The row of the current track is highlighted, and the exact parts for its build are listed. The footer panel also has a **Car plan** button.

Build codes (from the community guide in the Torn Racing Guide userscript):

- **T** = Tarmac: Track Tires, Adjustable Coilover Suspension, Paddle Shift Gearbox
- **D** = Dirt: Rally Tires, Group N Rally Suspension, Rally Gearbox
- **S** / **L** = gearbox Short Ratio / Long Ratio
- **2** / **3** = Stage Two / Stage Three Turbo kit

All builds also take the same 41 base parts (shown in the popup). Safety-only parts are left out.

When the race has started, the row is hidden (you can no longer change car). The footer menu opens a small panel for the API key.

Works on desktop browsers (Tampermonkey / Violentmonkey) and inside **Torn PDA**.

---

## How the fastest car is picked

The script reads the track's global top-5 lap records for each class (A–E). The model with the best lap wins. The row also shows the fastest model in each class, so you can pick a car you own.

If the race has a car class limit or a car model limit, only records that match the limit are used.

## Data used

All data comes from the Torn API v2:

| Endpoint | Used for | Cache |
|---|---|---|
| `/racing/{trackId}/records?cat=A..E` | top-5 laps per class | 12 h |
| `/racing/{raceId}/race` | track and race limits | 1 min |
| `/user/races` | your open race (when the page has no race id) | 1 min |
| `/racing/tracks` | track names | 7 days |

A **Minimal Access** key is enough. The key is stored only in your browser and is sent only to `api.torn.com`.

## Install

Install `race-car-picker.user.js` in Tampermonkey, Violentmonkey, or Torn PDA. Open the footer menu, then paste your API key.

## Tests

```bash
node --test test/rank.test.js
```

## License

GPL-3.0-or-later. Copyright (C) 2026 lannav.
