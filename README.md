# Torn Race Car Picker

A [Torn City](https://www.torn.com) userscript that shows the **best car you own for the track of your current race**, and a **car plan** with the best car and build for every track.

## Race row

On the race page (in the **Current car** box) and on the **Change Car** page, one row shows:

> Sewage: best car you own — **Edomondo NSX** TS3 — ✓ you use it (i)
> Ideal: Edomondo NSX TS2

- **Green** — you already use the best car you own.
- **Amber** — change to the car in the row. If you own 2 cars of the same model, the row asks you to check that you use the one with the correct build. Give your cars custom names to remove this check: the row then compares the names.
- **Ideal** shows the best car and build for the track, if you do not own it.

The track name and the current car come from the page. The Torn API has no data for a race before it ends.

How the best owned car is picked, in this order:

1. The ideal car and build for the track (or its purchasable alternative).
2. The recommended car and build.
3. Any of your cars with the correct surface build (tarmac or dirt). Planned models first, then by class.
4. A planned model with the wrong surface build.

## Car plan

The footer icon opens the **car plan** directly (once the API key is set). The **i** button in the row opens it too. It starts with a **list of cars to buy, in priority order**. Cars you already own with the correct build are marked ✓ owned. A part change deletes the old part, so each build is a separate car. A toggle switches between 2 plans:

- **Recommended (7 cars)** — one NSX build per surface, so you need fewer cars.
- **Ideal (11 cars)** — the best car and build for each track. Stormatti Casteon (Speedway, Uptown, Convict) is not purchasable, so it is marked as such, with a purchasable alternative in brackets (Veloria LFA, Mercia SLR).

Below the list, a table gives the car and build for every track. The row of the current track is highlighted, and the exact parts for its build are listed.

Build codes (from the community guide in the Torn Racing Guide userscript):

- **T** = Tarmac: Track Tires, Adjustable Coilover Suspension, Paddle Shift Gearbox
- **D** = Dirt: Rally Tires, Group N Rally Suspension, Rally Gearbox
- **S** / **L** = gearbox Short Ratio / Long Ratio
- **2** / **3** = Stage Two / Stage Three Turbo kit

All builds also take the same 41 base parts (shown in the popup). Safety-only parts are left out.

## Data used

Only one Torn API v2 endpoint: `/user/enlistedcars` (your cars and their parts), cached for 5 minutes. The build of each car is read from its tyre, gearbox and turbo parts.

A **Minimal Access** key is enough. The key is stored only in your browser and is sent only to `api.torn.com`.

## Install

Install `race-car-picker.user.js` in Tampermonkey, Violentmonkey, or Torn PDA. Open the footer menu, then paste your API key.

## Tests

```bash
node --test test/rank.test.js
```

## License

GPL-3.0-or-later. Copyright (C) 2026 lannav.
