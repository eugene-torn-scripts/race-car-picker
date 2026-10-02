# Torn Race Car Picker

A [Torn City](https://www.torn.com) userscript that picks your **best enlisted car for the track of your current race**.

- On the race page, the **Change Car** button glows green when you own a better car for this track. A label shows the better car.
- On the car selection page, every car gets a rank and an estimated lap time. The best car gets a green frame and a **★ Best** label.
- The footer menu opens a panel where you can see the ranking of your cars for any track.

Works on desktop browsers (Tampermonkey / Violentmonkey) and inside **Torn PDA**.

---

## How the best car is picked

For each of your enlisted cars, the script finds an estimated lap time on the track:

1. **Global record.** If the car's model is in the track's top-5 lap records for any class, the record lap is used. This compares car models at their best. So a model that is faster on this track wins, even if you never raced it there.
2. **Your own lap.** If the model has no record, your own best lap with that model is used. It is scaled by how much slower your laps are than the records, on the same track or on other tracks.
3. **No data.** Cars without any lap data rank last, by class.

The lowest estimate wins. Two cars of the same model are split by points spent, then by total stats.

Race limits are respected: car class, car model, and stock car only.

## Data used

All data comes from the Torn API v2:

| Endpoint | Used for | Cache |
|---|---|---|
| `/user/enlistedcars` | your cars | 5 min |
| `/user/racingrecords` | your best laps per track and model | 15 min |
| `/racing/{trackId}/records?cat=A..E` | top-5 laps per class | 12 h |
| `/racing/{raceId}/race` | track and race limits | 1 min |
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
