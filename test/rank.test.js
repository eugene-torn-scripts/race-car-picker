const test = require("node:test");
const assert = require("node:assert/strict");
const { rankCars, isEligible, formatLap, median } = require("../race-car-picker.user.js");

function car(id, model, cls, extra = {}) {
    return {
        id, car_item_id: model, car_item_name: `Model ${model}`, car_name: null, class: cls,
        top_speed: 10, acceleration: 10, braking: 10, handling: 10, safety: 10, dirt: 10, tarmac: 10,
        points_spent: 0, parts: [], ...extra,
    };
}

function rec(model, lap, driver = "X") {
    return { model, name: `Model ${model}`, lap, driver };
}

const emptyRecords = { A: [], B: [], C: [], D: [], E: [] };

test("formatLap formats minutes and hundredths", () => {
    assert.equal(formatLap(62.48), "01:02.48");
    assert.equal(formatLap(5.5), "00:05.50");
});

test("formatLap returns dash for missing or invalid values", () => {
    assert.equal(formatLap(null), "—");
    assert.equal(formatLap(undefined), "—");
    assert.equal(formatLap(Infinity), "—");
});

test("median handles empty, odd and even lists", () => {
    assert.equal(median([]), null);
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
});

test("isEligible allows any car without requirements", () => {
    assert.equal(isEligible(car(1, 78, "A"), null), true);
});

test("isEligible rejects a car of the wrong class", () => {
    assert.equal(isEligible(car(1, 78, "A"), { car_class: "B" }), false);
    assert.equal(isEligible(car(1, 87, "B"), { car_class: "B" }), true);
});

test("isEligible rejects a car of the wrong model", () => {
    assert.equal(isEligible(car(1, 78, "A"), { car_item_id: 87 }), false);
    assert.equal(isEligible(car(1, 87, "B"), { car_item_id: 87 }), true);
});

test("isEligible rejects an upgraded car in a stock-car race", () => {
    assert.equal(isEligible(car(1, 78, "A", { parts: [5] }), { requires_stock_car: true }), false);
    assert.equal(isEligible(car(1, 78, "A", { parts: [] }), { requires_stock_car: true }), true);
    assert.equal(isEligible(car(1, 78, "A", { parts: undefined }), { requires_stock_car: true }), true);
});

test("a model with a global record beats a model with only your own lap", () => {
    // Given: Mudpit-like data, own laps only with NSX, Colina holds the record
    const cars = [car(1, 78, "A"), car(2, 511, "B")];
    const records = { ...emptyRecords, A: [rec(78, 39.93)], B: [rec(511, 35.42)] };
    const own = [{ model: 78, lap: 41 }];

    // When
    const { best, rows } = rankCars({ cars, records, own, calibration: [], requirements: null });

    // Then
    assert.equal(best.car.id, 2);
    assert.equal(rows[0].source, "record");
    assert.equal(rows[0].est, 35.42);
    assert.equal(rows[1].ownLap, 41);
});

test("own lap is scaled by the ratio from the same track", () => {
    // Given: NSX has both an own lap and a record, Echo has an own lap only
    const cars = [car(1, 78, "A"), car(2, 87, "B")];
    const records = { ...emptyRecords, A: [rec(78, 50)] };
    const own = [{ model: 78, lap: 55 }, { model: 87, lap: 66 }];

    // When
    const { rows, ratio } = rankCars({ cars, records, own, calibration: [], requirements: null });

    // Then
    assert.equal(ratio, 1.1);
    const echo = rows.find((r) => r.car.id === 2);
    assert.equal(echo.source, "own-calibrated");
    assert.ok(Math.abs(echo.est - 60) < 1e-9);
});

test("own lap uses the ratio from other tracks when the track has no pair", () => {
    // Given
    const cars = [car(1, 87, "B")];
    const own = [{ model: 87, lap: 120 }];
    const calibration = [{ records: { ...emptyRecords, A: [rec(78, 100)] }, own: [{ model: 78, lap: 120 }] }];

    // When
    const { rows, ratio } = rankCars({ cars, records: emptyRecords, own, calibration, requirements: null });

    // Then
    assert.equal(ratio, 1.2);
    assert.equal(rows[0].source, "own-calibrated");
    assert.ok(Math.abs(rows[0].est - 100) < 1e-9);
});

test("own lap is used unscaled when no ratio is available", () => {
    // Given
    const cars = [car(1, 87, "B")];
    const own = [{ model: 87, lap: 70 }];

    // When
    const { rows, ratio } = rankCars({ cars, records: emptyRecords, own, calibration: undefined, requirements: null });

    // Then
    assert.equal(ratio, null);
    assert.equal(rows[0].source, "own");
    assert.equal(rows[0].est, 70);
});

test("a scaled own lap is never faster than the class top-5 floor", () => {
    // Given: the B list is full, so a model outside it is at least as slow as 5th place
    const cars = [car(1, 87, "B")];
    const records = { ...emptyRecords, B: [rec(511, 30), rec(511, 31), rec(511, 32), rec(511, 33), rec(511, 34)] };
    const own = [{ model: 87, lap: 31 }];

    // When
    const { rows } = rankCars({ cars, records, own, calibration: [], requirements: null });

    // Then
    assert.equal(rows[0].floor, 34);
    assert.equal(rows[0].est, 34);
});

test("the floor is not applied when the class list has fewer than 5 records", () => {
    // Given
    const cars = [car(1, 87, "B")];
    const records = { ...emptyRecords, B: [rec(511, 30)] };
    const own = [{ model: 87, lap: 25 }];

    // When
    const { rows } = rankCars({ cars, records, own, calibration: [], requirements: null });

    // Then
    assert.equal(rows[0].floor, null);
    assert.equal(rows[0].est, 25);
});

test("the fastest record of a model is used across classes and duplicates", () => {
    // Given
    const cars = [car(1, 78, "A")];
    const records = { ...emptyRecords, A: [rec(78, 50.2, "slow"), rec(78, 49.9, "fast")] };

    // When
    const { rows } = rankCars({ cars, records, own: [], calibration: [], requirements: null });

    // Then
    assert.equal(rows[0].est, 49.9);
    assert.equal(rows[0].record.driver, "fast");
});

test("cars without data rank after cars with data, ordered by class", () => {
    // Given
    const cars = [car(1, 500, "E"), car(2, 77, "D"), car(3, 87, "B")];
    const own = [{ model: 87, lap: 80 }];

    // When
    const { rows, best } = rankCars({ cars, records: emptyRecords, own, calibration: [], requirements: null });

    // Then
    assert.deepEqual(rows.map((r) => r.car.id), [3, 2, 1]);
    assert.equal(rows[1].source, "none");
    assert.equal(best.car.id, 3);
});

test("ineligible cars rank last and are never picked", () => {
    // Given
    const cars = [car(1, 78, "A"), car(2, 87, "B")];
    const records = { ...emptyRecords, A: [rec(78, 40)], B: [rec(87, 45)] };

    // When
    const { rows, best } = rankCars({ cars, records, own: [], calibration: [], requirements: { car_class: "B" } });

    // Then
    assert.equal(best.car.id, 2);
    assert.equal(rows[1].car.id, 1);
    assert.equal(rows[1].eligible, false);
});

test("best falls back to an eligible car without data", () => {
    // Given
    const cars = [car(1, 78, "A"), car(2, 500, "E")];
    const records = { ...emptyRecords, A: [rec(78, 40)] };

    // When
    const { best } = rankCars({ cars, records, own: [], calibration: [], requirements: { car_class: "E" } });

    // Then
    assert.equal(best.car.id, 2);
    assert.equal(best.est, null);
});

test("best is null when no car is eligible", () => {
    // Given
    const cars = [car(1, 78, "A")];

    // When
    const { best } = rankCars({ cars, records: emptyRecords, own: [], calibration: [], requirements: { car_class: "C" } });

    // Then
    assert.equal(best, null);
});

test("two cars of the same model are split by points spent, then by stats", () => {
    // Given
    const records = { ...emptyRecords, A: [rec(78, 40)] };
    const cars = [
        car(1, 78, "A", { points_spent: 10 }),
        car(2, 78, "A", { points_spent: 50 }),
        car(3, 78, "A", { points_spent: 10, top_speed: 90 }),
    ];

    // When
    const { rows } = rankCars({ cars, records, own: [], calibration: [], requirements: null });

    // Then
    assert.deepEqual(rows.map((r) => r.car.id), [2, 3, 1]);
});

test("missing points spent counts as zero", () => {
    // Given
    const records = { ...emptyRecords, A: [rec(78, 40)] };
    const cars = [car(1, 78, "A", { points_spent: undefined }), car(2, 78, "A", { points_spent: 5 })];

    // When
    const { rows } = rankCars({ cars, records, own: [], calibration: [], requirements: null });

    // Then
    assert.deepEqual(rows.map((r) => r.car.id), [2, 1]);
});

test("the best own lap of a model is used when there are several", () => {
    // Given
    const cars = [car(1, 87, "B")];
    const own = [{ model: 87, lap: 63 }, { model: 87, lap: 62.48 }, { model: 87, lap: 64 }];

    // When
    const { rows } = rankCars({ cars, records: emptyRecords, own, calibration: [], requirements: null });

    // Then
    assert.equal(rows[0].ownLap, 62.48);
});
