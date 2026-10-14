const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildParts, planForTrack, carBuild, purchaseList, bestOwnedCar, currentCarState,
    PLANS, NOT_PURCHASABLE, BUILD_SURFACE, BUILD_RATIO, BUILD_TURBO,
} = require("../race-car-picker.user.js");

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

const { recommended, ideal } = PLANS;

test("planForTrack finds a track by title, ignoring case and spaces", () => {
    assert.equal(planForTrack(recommended, " two islands ").build, "DS3");
    assert.equal(planForTrack(ideal, "Two Islands").build, "DL3");
    assert.equal(planForTrack(recommended, "Mudpit").car, "Colina Tanprice");
});

test("planForTrack returns null for an unknown or missing title", () => {
    assert.equal(planForTrack(recommended, "Nowhere"), null);
    assert.equal(planForTrack(recommended, null), null);
    assert.equal(planForTrack(recommended, ""), null);
});

for (const [name, plan] of Object.entries(PLANS)) {
    test(`the ${name} plan covers 16 different tracks with valid build codes`, () => {
        assert.equal(new Set(plan.tracks.map((p) => p.track)).size, 16);
        for (const p of plan.tracks) {
            const [surface, ratio, turbo] = p.build;
            assert.equal(p.build.length, 3, p.track);
            assert.ok(BUILD_SURFACE[surface], p.track);
            assert.ok(BUILD_RATIO[ratio], p.track);
            assert.ok(BUILD_TURBO[turbo], p.track);
        }
    });

    test(`every track in the ${name} plan has its car build in the purchase list`, () => {
        for (const p of plan.tracks) {
            assert.ok(plan.purchase.some((i) => i.car === p.car && i.build === p.build), p.track);
        }
    });

    test(`every purchase in the ${name} plan is used on a track, directly or as an alternative`, () => {
        for (const item of purchaseList([], plan)) {
            assert.ok(item.tracks.length + item.altTracks.length > 0, `${item.car} ${item.build}`);
        }
    });

    test(`every not-purchasable car in the ${name} plan has a purchasable alternative`, () => {
        for (const p of plan.tracks.filter((x) => NOT_PURCHASABLE.includes(x.car))) {
            assert.ok(p.alt && !NOT_PURCHASABLE.includes(p.alt), p.track);
        }
    });
}

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
    const list = purchaseList(cars, recommended);

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

    const list = purchaseList(cars, recommended);

    assert.equal(list[0].owned, cars[1]);
    assert.equal(list[1].owned, cars[0]);
});

test("purchaseList uses one owned car for one item only", () => {
    const list = purchaseList([ownCar("Edomondo NSX", NSX_TS3_PARTS)], recommended);

    assert.equal(list.filter((i) => i.owned).length, 1);
});

test("purchaseList shows nothing owned without cars", () => {
    assert.equal(purchaseList(null, recommended).some((i) => i.owned), false);
    assert.equal(purchaseList([], recommended).some((i) => i.owned), false);
});

test("purchaseList lists the tracks of each car build", () => {
    const list = purchaseList([], recommended);

    assert.deepEqual(list[1].tracks, ["Hammerhead", "Parkland", "Two Islands"]);
    assert.deepEqual(list[3].tracks, ["Mudpit"]);
});

test("purchaseList lists alternative tracks and marks a not-purchasable car", () => {
    // Given
    const list = purchaseList([], ideal);

    // When
    const mercia = list.find((i) => i.car === "Mercia SLR");
    const stormatti = list.find((i) => i.car === "Stormatti Casteon");
    const lfa = list.find((i) => i.car === "Veloria LFA");

    // Then
    assert.deepEqual([mercia.tracks, mercia.altTracks, mercia.purchasable], [[], ["Convict"], true]);
    assert.deepEqual([stormatti.tracks, stormatti.purchasable], [["Speedway", "Uptown", "Convict"], false]);
    assert.deepEqual([lfa.tracks, lfa.altTracks], [["Withdrawal"], ["Speedway", "Uptown"]]);
});

test("purchaseList has no alternative tracks in the recommended plan", () => {
    assert.ok(purchaseList([], recommended).every((i) => i.altTracks.length === 0 && i.purchasable));
});

const TS3 = [46, 85, 99];
const TS2 = [46, 85, 81];
const DS3 = [47, 87, 99];
const TL3 = [46, 84, 99];

function car(name, parts, extra = {}) {
    return { car_item_name: name, parts, class: "A", car_name: null, ...extra };
}

test("bestOwnedCar picks the ideal car and build when you own it", () => {
    // Given
    const cars = [car("Edomondo NSX", TS3), car("Edomondo NSX", TS2)];

    // When
    const best = bestOwnedCar(cars, "Sewage");

    // Then
    assert.equal(best.car, cars[1]);
    assert.deepEqual([best.build, best.match], ["TS2", "plan"]);
});

test("bestOwnedCar falls back to the recommended build", () => {
    const cars = [car("Edomondo NSX", TS3)];

    const best = bestOwnedCar(cars, "Sewage");

    assert.deepEqual([best.car, best.build, best.match, best.ideal.build], [cars[0], "TS3", "plan", "TS2"]);
});

test("bestOwnedCar uses the alternative car when the ideal car is not purchasable", () => {
    const cars = [car("Edomondo NSX", TS3), car("Mercia SLR", TL3)];

    const best = bestOwnedCar(cars, "Convict");

    assert.deepEqual([best.car, best.match, best.ideal.car], [cars[1], "plan", "Stormatti Casteon"]);
});

test("bestOwnedCar falls back to a car with the correct surface build, planned model and class first", () => {
    // Given
    const cars = [
        car("Volt GT", TS3, { class: "A" }),
        car("Echo S4", TL3, { class: "B" }),
        car("Edomondo NSX", DS3),
    ];

    // When
    const docks = bestOwnedCar(cars, "Docks");
    const speedway = bestOwnedCar([cars[1], car("Bavaria Z8", TL3, { class: "C" })], "Speedway");

    // Then
    assert.deepEqual([docks.car, docks.build, docks.match], [cars[0], "TS3", "surface"]);
    assert.equal(speedway.car, cars[1]);
});

test("bestOwnedCar prefers a planned model with the correct surface over another class A car", () => {
    const other = car("Lambrini Torobravo", TS3);
    const lfa = car("Veloria LFA", [46, 85, 81]);

    const best = bestOwnedCar([other, lfa], "Speedway");

    assert.deepEqual([best.car, best.match], [lfa, "surface"]);
});

test("bestOwnedCar falls back to a planned model with the wrong surface build", () => {
    const cars = [car("Edomondo NSX", TS3)];

    const best = bestOwnedCar(cars, "Parkland");

    assert.deepEqual([best.car, best.build, best.match], [cars[0], "TS3", "model"]);
});

test("bestOwnedCar reports no car when you own nothing useful", () => {
    const best = bestOwnedCar([car("Nano Pioneer", [])], "Mudpit");

    assert.deepEqual([best.car, best.match, best.ideal.car], [null, "none", "Colina Tanprice"]);
    assert.equal(bestOwnedCar(null, "Mudpit").match, "none");
});

test("bestOwnedCar returns null for an unknown track", () => {
    assert.equal(bestOwnedCar([car("Edomondo NSX", TS3)], "Nowhere"), null);
    assert.equal(bestOwnedCar([], ""), null);
});

test("currentCarState is unknown without a best car or a current model", () => {
    const best = { car: car("Edomondo NSX", TS3) };
    assert.equal(currentCarState(null, [], { model: "Edomondo NSX" }), "unknown");
    assert.equal(currentCarState({ car: null }, [], { model: "Edomondo NSX" }), "unknown");
    assert.equal(currentCarState(best, [], null), "unknown");
    assert.equal(currentCarState(best, [], { model: undefined }), "unknown");
});

test("currentCarState compares custom car names when both are known", () => {
    const best = { car: car("Edomondo NSX", DS3, { car_name: "NSX dirt" }) };

    assert.equal(currentCarState(best, [], { model: "Edomondo NSX", name: "NSX dirt" }), "current");
    assert.equal(currentCarState(best, [], { model: "Edomondo NSX", name: "NSX tarmac" }), "change");
});

test("currentCarState compares models when names are not known", () => {
    const nsx = car("Edomondo NSX", TS3);
    const best = { car: nsx };

    assert.equal(currentCarState(best, [nsx], { model: "Edomondo NSX", name: null }), "current");
    assert.equal(currentCarState(best, [nsx], { model: "Veloria LFA", name: null }), "change");
});

test("currentCarState asks to check the build when you own 2 cars of the same model", () => {
    const a = car("Edomondo NSX", TS3);
    const b = car("Edomondo NSX", DS3);

    assert.equal(currentCarState({ car: a }, [a, b], { model: "Edomondo NSX", name: null }), "check");
});
