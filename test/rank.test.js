const test = require("node:test");
const assert = require("node:assert/strict");
const {
    fastestByClass, fastestCar, formatLap, bestRowState, buildParts, planForTrack, carBuild, purchaseList,
    TRACK_PLAN, PURCHASE_PLAN, BUILD_SURFACE, BUILD_RATIO, BUILD_TURBO,
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

function ownCar(name, parts) {
    return { car_item_name: name, parts };
}

const NSX_TS3_PARTS = [88, 99, 93, 85, 46, 1];
const NSX_DL2_PARTS = [47, 94, 86, 81];

test("carBuild decodes a tarmac short stage three build", () => {
    assert.equal(carBuild(ownCar("Edomondo NSX", NSX_TS3_PARTS)), "TS3");
});

test("carBuild decodes a dirt long stage two build", () => {
    assert.equal(carBuild(ownCar("Edomondo NSX", NSX_DL2_PARTS)), "DL2");
});

test("carBuild decodes the short rally gearbox and the long paddle-shift gearbox", () => {
    assert.equal(carBuild(ownCar("X", [47, 87, 99])), "DS3");
    assert.equal(carBuild(ownCar("X", [46, 84, 99])), "TL3");
});

test("carBuild returns null when a build part is missing", () => {
    assert.equal(carBuild(ownCar("X", [46, 85])), null);
    assert.equal(carBuild(ownCar("X", [46, 99])), null);
    assert.equal(carBuild(ownCar("X", [85, 99])), null);
});

test("carBuild returns null for a car without parts", () => {
    assert.equal(carBuild(ownCar("X", [])), null);
    assert.equal(carBuild(ownCar("X", undefined)), null);
});

test("purchaseList marks a car as owned only when model and build match", () => {
    // Given
    const cars = [
        ownCar("Edomondo NSX", NSX_TS3_PARTS),
        ownCar("Veloria LFA", [47, 87, 99]),
        ownCar("Volt GT", []),
    ];

    // When
    const list = purchaseList(cars);

    // Then
    assert.deepEqual(list.map((i) => [i.car, i.build, !!i.owned]), [
        ["Edomondo NSX", "TS3", true],
        ["Edomondo NSX", "DS3", false],
        ["Veloria LFA", "TL3", false],
        ["Colina Tanprice", "DL3", false],
        ["Echo R8", "DS3", false],
        ["Volt GT", "TL3", false],
        ["Mercia SLR", "TL3", false],
    ]);
});

test("purchaseList matches 2 cars of the same model to 2 different builds", () => {
    const cars = [ownCar("Edomondo NSX", [47, 87, 99]), ownCar("Edomondo NSX", NSX_TS3_PARTS)];

    const list = purchaseList(cars);

    assert.equal(list[0].owned, cars[1]);
    assert.equal(list[1].owned, cars[0]);
});

test("purchaseList uses one owned car for one item only", () => {
    const list = purchaseList([ownCar("Edomondo NSX", NSX_TS3_PARTS)]);

    assert.equal(list.filter((i) => i.owned).length, 1);
});

test("purchaseList shows nothing owned without cars", () => {
    assert.equal(purchaseList(null).some((i) => i.owned), false);
    assert.equal(purchaseList([]).some((i) => i.owned), false);
});

test("purchaseList lists the tracks of each car build", () => {
    const list = purchaseList([]);

    assert.deepEqual(list[1].tracks, ["Hammerhead", "Parkland", "Two Islands"]);
    assert.deepEqual(list[3].tracks, ["Mudpit"]);
});

test("every track in the plan uses a car build from the purchase plan, and every purchase has a track", () => {
    for (const p of TRACK_PLAN) {
        assert.ok(PURCHASE_PLAN.some((i) => i.car === p.car && i.build === p.build), p.track);
    }
    for (const item of purchaseList([])) {
        assert.ok(item.tracks.length > 0, `${item.car} ${item.build}`);
    }
});

test("ideal builds in the plan are valid build codes that differ from the plan build", () => {
    for (const p of TRACK_PLAN.filter((x) => x.ideal)) {
        const [surface, ratio, turbo] = p.ideal;
        assert.ok(BUILD_SURFACE[surface] && BUILD_RATIO[ratio] && BUILD_TURBO[turbo], p.track);
        assert.notEqual(p.ideal, p.build, p.track);
    }
});
