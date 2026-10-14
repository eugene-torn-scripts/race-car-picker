const test = require("node:test");
const assert = require("node:assert/strict");
const {
    fastestByClass, fastestCar, formatLap, bestRowState, buildParts, planForTrack,
    TRACK_PLAN, BUILD_SURFACE, BUILD_RATIO, BUILD_TURBO,
} = require("../race-car-picker.user.js");

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

test("fastestByClass picks the fastest record of each class, in class order", () => {
    // Given
    const records = {
        ...emptyRecords,
        A: [rec(519, 26.2, "Storm"), rec(519, 26.19, "Toxic"), rec(78, 26.5)],
        C: [rec(511, 29.1)],
        E: [rec(501, 32.14)],
    };

    // When
    const byClass = fastestByClass(records, null);

    // Then
    assert.deepEqual(byClass.map((r) => [r.cls, r.model, r.lap, r.driver]), [
        ["A", 519, 26.19, "Toxic"],
        ["C", 511, 29.1, "X"],
        ["E", 501, 32.14, "X"],
    ]);
});

test("fastestByClass keeps only the race class when the race has a class limit", () => {
    const records = { ...emptyRecords, A: [rec(519, 26.19)], B: [rec(87, 28)] };

    const byClass = fastestByClass(records, { car_class: "B" });

    assert.deepEqual(byClass.map((r) => [r.cls, r.model]), [["B", 87]]);
});

test("fastestByClass keeps only the race model when the race has a model limit", () => {
    const records = { ...emptyRecords, A: [rec(519, 26.19), rec(78, 26.5)], B: [rec(78, 27)] };

    const byClass = fastestByClass(records, { car_item_id: 78 });

    assert.deepEqual(byClass.map((r) => [r.cls, r.model, r.lap]), [["A", 78, 26.5], ["B", 78, 27]]);
});

test("fastestByClass returns an empty list when no record matches", () => {
    assert.deepEqual(fastestByClass(emptyRecords, null), []);
    assert.deepEqual(fastestByClass({ ...emptyRecords, A: [rec(519, 26.19)] }, { car_item_id: 1 }), []);
    assert.deepEqual(fastestByClass(null, null), []);
    assert.deepEqual(fastestByClass({ A: [rec(519, 26.19)] }, null).map((r) => r.cls), ["A"]);
});

test("fastestCar returns the fastest record across classes", () => {
    const byClass = [
        { ...rec(501, 32.14), cls: "E" },
        { ...rec(519, 26.19), cls: "A" },
        { ...rec(511, 29.1), cls: "C" },
    ];

    assert.equal(fastestCar(byClass).model, 519);
});

test("fastestCar keeps the first record on a tie", () => {
    const byClass = [{ ...rec(1, 30), cls: "A" }, { ...rec(2, 30), cls: "B" }];

    assert.equal(fastestCar(byClass).model, 1);
});

test("fastestCar returns null for an empty list", () => {
    assert.equal(fastestCar([]), null);
});

test("bestRowState is current when the page car is the fastest model", () => {
    assert.equal(bestRowState(rec(519, 26.19), " Model 519 "), "current");
});

test("bestRowState is change when the page car is another model", () => {
    assert.equal(bestRowState(rec(519, 26.19), "Model 78"), "change");
});

test("bestRowState is unknown without a best record or a page car", () => {
    assert.equal(bestRowState(null, "Model 78"), "unknown");
    assert.equal(bestRowState(rec(519, 26.19), null), "unknown");
    assert.equal(bestRowState(rec(519, 26.19), ""), "unknown");
});

test("buildParts gives tarmac parts with a short paddle-shift gearbox and stage two turbo", () => {
    assert.deepEqual(buildParts("TS2"), [
        "Track Tires", "Adjustable Coilover Suspension", "Paddle Shift Gearbox (Short Ratio)", "Stage Two Turbo kit",
    ]);
});

test("buildParts gives dirt parts with a long rally gearbox and stage three turbo", () => {
    assert.deepEqual(buildParts("DL3"), [
        "Rally Tires", "Group N Rally Suspension", "Rally Gearbox (Long Ratio)", "Stage Three Turbo Kit",
    ]);
});

test("planForTrack finds a track by title, ignoring case and spaces", () => {
    assert.equal(planForTrack(" two islands ").car, "Edomondo NSX");
    assert.equal(planForTrack("Mudpit").car, "Colina Tanprice");
});

test("planForTrack returns null for an unknown or missing title", () => {
    assert.equal(planForTrack("Nowhere"), null);
    assert.equal(planForTrack(null), null);
    assert.equal(planForTrack(""), null);
});

test("the track plan covers 16 different tracks with valid build codes", () => {
    assert.equal(new Set(TRACK_PLAN.map((p) => p.track)).size, 16);
    for (const p of TRACK_PLAN) {
        const [surface, ratio, turbo] = p.build;
        assert.equal(p.build.length, 3, p.track);
        assert.ok(BUILD_SURFACE[surface], p.track);
        assert.ok(BUILD_RATIO[ratio], p.track);
        assert.ok(BUILD_TURBO[turbo], p.track);
    }
});
