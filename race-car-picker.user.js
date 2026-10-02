// ==UserScript==
// @name         Torn Race Car Picker
// @namespace    https://github.com/eugene-torn-scripts/race-car-picker
// @version      1.0.0
// @description  Picks your best enlisted car for the current race track from global lap records and your own lap times. Highlights the Change Car button when a better car is available, and the best car on the car selection page.
// @author       lannav
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.torn.com
// @license      GPL-3.0-or-later
// ==/UserScript==

/*
 * Torn Race Car Picker
 * Copyright (C) 2026 lannav
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details: https://www.gnu.org/licenses/gpl-3.0.html
 *
 * Source: https://github.com/eugene-torn-scripts/race-car-picker
 */

/* eslint-disable no-undef */

(function () {
    "use strict";

    const VERSION = "1.0.0";

    const API_BASE = "https://api.torn.com/v2";
    const API_DELAY_MS = 700;
    const PDA_TIMEOUT_MS = 20_000;
    const RATE_LIMIT_COOLDOWN_MS = 60_000;
    const RATE_LIMIT_ERROR_CODE = 5;
    const RECORDS_PER_CLASS = 5;
    const CAR_CLASSES = ["A", "B", "C", "D", "E"];
    const KEY_RE = /^[A-Za-z0-9]{16}$/;

    const TTL = {
        tracks: 7 * 24 * 3600_000,
        records: 12 * 3600_000,
        cars: 5 * 60_000,
        ownLaps: 15 * 60_000,
        race: 60_000,
        activeRace: 60_000,
        lastRace: 6 * 3600_000,
    };

    const LS = {
        apiKey: "rcp_apiKey",
        cachePrefix: "rcp_cache_",
        currentCar: "rcp_currentCar",
        lastRace: "rcp_lastRace",
    };

    const IS_PDA = typeof PDA_httpGet === "function";
    const GM_XHR = (typeof GM_xmlhttpRequest !== "undefined") ? GM_xmlhttpRequest : null;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function escapeHtml(s) {
        return String(s ?? "").replace(/[&<>"']/g, (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function formatLap(seconds) {
        if (seconds == null || !isFinite(seconds)) return "—";
        const m = Math.floor(seconds / 60);
        const s = seconds - m * 60;
        return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
    }

    function median(values) {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function readJson(key) {
        try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    }

    function writeJson(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
    }

    const Cache = {
        get(name, ttl) {
            const entry = readJson(LS.cachePrefix + name);
            if (entry && Date.now() - entry.ts < ttl) return entry.data;
            return undefined;
        },
        peek(name) {
            const entry = readJson(LS.cachePrefix + name);
            return entry ? entry.data : undefined;
        },
        set(name, data) { writeJson(LS.cachePrefix + name, { ts: Date.now(), data }); },
        names() {
            return Object.keys(localStorage)
                .filter((k) => k.startsWith(LS.cachePrefix))
                .map((k) => k.slice(LS.cachePrefix.length));
        },
        clear() { this.names().forEach((n) => localStorage.removeItem(LS.cachePrefix + n)); },
    };

    const KeyResolver = {
        resolve() {
            const PDA_KEY = "###PDA-APIKEY###";
            const PLACEHOLDER = "###" + "PDA-APIKEY" + "###";
            if (PDA_KEY !== PLACEHOLDER && KEY_RE.test(PDA_KEY)) return PDA_KEY;
            const own = (localStorage.getItem(LS.apiKey) || "").trim();
            return KEY_RE.test(own) ? own : "";
        },
        save(key) {
            const t = (key || "").trim();
            if (!KEY_RE.test(t)) throw new Error("Torn API key must be 16 alphanumeric characters");
            localStorage.setItem(LS.apiKey, t);
        },
        clear() { localStorage.removeItem(LS.apiKey); },
    };

    class TornAPI {
        constructor(key) {
            this.key = key;
            this._queue = Promise.resolve();
            this._lastReq = 0;
        }

        setKey(k) { this.key = k; }

        _enqueue(fn) {
            const next = this._queue.then(async () => {
                const wait = API_DELAY_MS - (Date.now() - this._lastReq);
                if (wait > 0) await sleep(wait);
                this._lastReq = Date.now();
                return fn();
            });
            this._queue = next.catch(() => {});
            return next;
        }

        async _getJson(url) {
            if (IS_PDA && !GM_XHR) {
                const raw = await Promise.race([
                    PDA_httpGet(url),
                    sleep(PDA_TIMEOUT_MS).then(() => { throw new Error("pda-timeout"); }),
                ]);
                const text = typeof raw === "string" ? raw : (raw && raw.responseText) || "";
                return JSON.parse(text);
            }
            if (GM_XHR) {
                return new Promise((resolve, reject) => {
                    GM_XHR({
                        method: "GET",
                        url,
                        timeout: PDA_TIMEOUT_MS,
                        onload: (res) => {
                            try { resolve(JSON.parse(res.responseText)); } catch (e) { reject(e); }
                        },
                        onerror: () => reject(new Error("network error")),
                        ontimeout: () => reject(new Error("timeout")),
                    });
                });
            }
            const res = await fetch(url);
            return res.json();
        }

        async get(path, params = {}) {
            if (!this.key) throw new Error("No API key");
            return this._enqueue(async () => {
                const url = new URL(API_BASE + path);
                for (const [k, v] of Object.entries(params)) {
                    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
                }
                url.searchParams.set("key", this.key);
                while (true) {
                    const data = await this._getJson(url.toString());
                    if (data && data.error && data.error.code === RATE_LIMIT_ERROR_CODE) {
                        await sleep(RATE_LIMIT_COOLDOWN_MS);
                        continue;
                    }
                    if (data && data.error) {
                        const err = new Error(`${data.error.code}: ${data.error.error}`);
                        err.code = data.error.code;
                        throw err;
                    }
                    return data;
                }
            });
        }
    }

    class RaceData {
        constructor(api) { this.api = api; }

        async _cached(name, ttl, loader) {
            const hit = Cache.get(name, ttl);
            if (hit !== undefined) return hit;
            const data = await loader();
            Cache.set(name, data);
            return data;
        }

        tracks() {
            return this._cached("tracks", TTL.tracks, async () => {
                const d = await this.api.get("/racing/tracks");
                return (d.tracks || []).map((t) => ({ id: t.id, title: t.title, description: t.description }));
            });
        }

        async trackByTitle(title) {
            const wanted = (title || "").trim().toLowerCase();
            if (!wanted) return null;
            const tracks = await this.tracks();
            return tracks.find((t) => t.title.toLowerCase() === wanted) || null;
        }

        cars() {
            return this._cached("cars", TTL.cars, async () => {
                const d = await this.api.get("/user/enlistedcars");
                return (d.enlistedcars || []).filter((c) => !c.is_removed);
            });
        }

        ownLaps() {
            return this._cached("ownLaps", TTL.ownLaps, async () => {
                const d = await this.api.get("/user/racingrecords");
                const byTrack = {};
                for (const t of d.racingrecords || []) {
                    byTrack[t.track.id] = (t.records || []).map((r) => ({
                        model: r.car_id,
                        name: r.car_name,
                        lap: r.lap_time / 100,
                    }));
                }
                return byTrack;
            });
        }

        trackRecords(trackId) {
            return this._cached(`records_${trackId}`, TTL.records, async () => {
                const byClass = {};
                for (const cls of CAR_CLASSES) {
                    const d = await this.api.get(`/racing/${trackId}/records`, { cat: cls });
                    byClass[cls] = (d.records || []).map((r) => ({
                        model: r.car_item_id,
                        name: r.car_item_name,
                        lap: r.lap_time,
                        driver: r.driver_name,
                    }));
                }
                return byClass;
            });
        }

        cachedTrackRecords() {
            const out = {};
            for (const name of Cache.names()) {
                const m = /^records_(\d+)$/.exec(name);
                if (m) out[m[1]] = Cache.peek(name);
            }
            return out;
        }

        race(raceId) {
            return this._cached(`race_${raceId}`, TTL.race, async () => (await this.api.get(`/racing/${raceId}/race`)).race);
        }

        activeRace() {
            return this._cached("activeRace", TTL.activeRace, async () => {
                const d = await this.api.get("/user/races", { limit: 5, sort: "DESC" });
                return (d.races || []).find((r) => r.status !== "finished") || null;
            });
        }

        async rankForTrack(trackId, requirements) {
            const [cars, ownLaps, records] = await Promise.all([
                this.cars(), this.ownLaps(), this.trackRecords(trackId),
            ]);
            const calibration = Object.entries(this.cachedTrackRecords())
                .filter(([id]) => Number(id) !== Number(trackId))
                .map(([id, recs]) => ({ records: recs, own: ownLaps[id] || [] }));
            return rankCars({
                cars,
                records,
                own: ownLaps[trackId] || [],
                calibration,
                requirements,
            });
        }
    }

    function bestRecordByModel(records) {
        const best = new Map();
        for (const list of Object.values(records || {})) {
            for (const r of list || []) {
                const prev = best.get(r.model);
                if (!prev || r.lap < prev.lap) best.set(r.model, r);
            }
        }
        return best;
    }

    function classFloors(records) {
        const floors = {};
        for (const [cls, list] of Object.entries(records || {})) {
            if ((list || []).length >= RECORDS_PER_CLASS) floors[cls] = Math.max(...list.map((r) => r.lap));
        }
        return floors;
    }

    function bestOwnByModel(own) {
        const best = new Map();
        for (const r of own || []) {
            const prev = best.get(r.model);
            if (prev == null || r.lap < prev) best.set(r.model, r.lap);
        }
        return best;
    }

    function ownToRecordRatios(records, own) {
        const recordBest = bestRecordByModel(records);
        const ratios = [];
        for (const [model, lap] of bestOwnByModel(own)) {
            const rec = recordBest.get(model);
            if (rec) ratios.push(lap / rec.lap);
        }
        return ratios;
    }

    function isEligible(car, req) {
        if (!req) return true;
        if (req.car_class && car.class !== req.car_class) return false;
        if (req.car_item_id && car.car_item_id !== req.car_item_id) return false;
        if (req.requires_stock_car && (car.parts || []).length > 0) return false;
        return true;
    }

    function statSum(car) {
        return (car.top_speed || 0) + (car.acceleration || 0) + (car.braking || 0)
            + (car.handling || 0) + (car.safety || 0) + (car.dirt || 0) + (car.tarmac || 0);
    }

    function rankCars({ cars, records, own, calibration, requirements }) {
        const recordBest = bestRecordByModel(records);
        const floors = classFloors(records);
        const ownBest = bestOwnByModel(own);

        let ratios = ownToRecordRatios(records, own);
        if (!ratios.length) ratios = (calibration || []).flatMap((c) => ownToRecordRatios(c.records, c.own));
        const ratio = median(ratios);

        const rows = cars.map((car) => {
            const record = recordBest.get(car.car_item_id) || null;
            const ownLap = ownBest.has(car.car_item_id) ? ownBest.get(car.car_item_id) : null;
            const floor = floors[car.class] ?? null;
            let est = null;
            let source = "none";
            if (record) {
                est = record.lap;
                source = "record";
            } else if (ownLap != null) {
                est = ratio ? ownLap / ratio : ownLap;
                source = ratio ? "own-calibrated" : "own";
                if (floor != null && est < floor) est = floor;
            }
            return { car, eligible: isEligible(car, requirements), est, source, ownLap, record, floor };
        });

        rows.sort((a, b) => {
            if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
            if ((a.est == null) !== (b.est == null)) return a.est == null ? 1 : -1;
            if (a.est != null && a.est !== b.est) return a.est - b.est;
            if (a.est == null && a.car.class !== b.car.class) return a.car.class < b.car.class ? -1 : 1;
            if ((b.car.points_spent || 0) !== (a.car.points_spent || 0)) return (b.car.points_spent || 0) - (a.car.points_spent || 0);
            return statSum(b.car) - statSum(a.car);
        });

        const best = rows.find((r) => r.eligible && r.est != null) || rows.find((r) => r.eligible) || null;
        return { rows, best, ratio, recordBest };
    }

    function sourceLabel(row) {
        switch (row.source) {
            case "record": return `global record (${row.record.driver})`;
            case "own-calibrated": return "your lap, scaled to records";
            case "own": return "your lap";
            default: return "no lap data";
        }
    }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = { rankCars, isEligible, formatLap, median };
        return;
    }

    (function setupEugFooterMenu() {
        const W = (typeof unsafeWindow !== "undefined") ? unsafeWindow : window;
        if (W.__eugFooterMenuLoaded) return;
        W.__eugFooterMenuLoaded = true;
        W.__eugeneScripts = W.__eugeneScripts || [];

        const ROW_ID = "eug-footer-row";

        function injectCSS() {
            if (document.getElementById("eug-footer-style")) return;
            const style = document.createElement("style");
            style.id = "eug-footer-style";
            style.textContent = `
[data-eug="menu"]{background:linear-gradient(to bottom,#444,#2a2a2a)!important}
[data-eug="menu"]:hover{background:linear-gradient(to bottom,#555,#333)!important}
#${ROW_ID}{display:none;position:fixed;padding:4px;
  background:rgba(20,20,20,0.96);border:1px solid #444;border-radius:6px;
  gap:4px;z-index:2147483647;white-space:nowrap;pointer-events:auto}
#${ROW_ID}.eug-open{display:flex;flex-direction:row}
`;
            document.head.appendChild(style);
        }

        function injectEntryCSS(entry) {
            if (!entry.color) return;
            const id = `eug-color-${entry.id}`;
            const existing = document.getElementById(id);
            const dark = entry.colorDark || "#222";
            const hover = entry.hoverColor || entry.color;
            const css = `
[data-eug-id="${entry.id}"]{background:linear-gradient(to bottom, ${entry.color}, ${dark})!important}
[data-eug-id="${entry.id}"]:hover{background:linear-gradient(to bottom, ${hover}, ${entry.color})!important}
`;
            if (existing) { existing.textContent = css; return; }
            const el = document.createElement("style");
            el.id = id;
            el.textContent = css;
            document.head.appendChild(el);
        }

        function findRefBtn() {
            return document.getElementById("notes_panel_button")
                || document.getElementById("people_panel_button");
        }

        function getRow() { return document.getElementById(ROW_ID); }
        function closeRow() { const r = getRow(); if (r) r.classList.remove("eug-open"); }

        function openRow(menuBtn) {
            const row = getRow();
            if (!row) return;
            const rect = menuBtn.getBoundingClientRect();
            row.classList.add("eug-open");
            const rowRect = row.getBoundingClientRect();
            const gap = 6;
            const centerX = rect.left + rect.width / 2;
            let left = centerX - rowRect.width / 2;
            const maxLeft = window.innerWidth - rowRect.width - 4;
            left = Math.max(4, Math.min(left, maxLeft));
            row.style.left = left + "px";
            row.style.bottom = (window.innerHeight - rect.top + gap) + "px";
        }

        function makeScriptBtn(entry, refBtn, role) {
            const iconClasses = refBtn.querySelector("svg")?.className?.baseVal || "";
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = refBtn.className;
            btn.title = entry.name;
            btn.setAttribute("data-eug", role);
            btn.setAttribute("data-eug-id", entry.id);
            const svg = (entry.iconSVG || "").replace(/<svg\b([^>]*)>/, (match, attrs) =>
                /\sclass\s*=/.test(attrs) ? match : `<svg${attrs} class="${iconClasses}">`);
            btn.innerHTML = svg;
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeRow();
                try { entry.onClick(); } catch { /* noop */ }
            });
            injectEntryCSS(entry);
            return btn;
        }

        function makeMenuBtn(refBtn) {
            const iconClasses = refBtn.querySelector("svg")?.className?.baseVal || "";
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = refBtn.className;
            btn.title = "My userscripts";
            btn.setAttribute("data-eug", "menu");
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" class="${iconClasses}">
                <defs><linearGradient id="eug_menu_grad" x1="0.5" x2="0.5" y2="1" gradientUnits="objectBoundingBox">
                    <stop offset="0" stop-color="#ddd"/><stop offset="1" stop-color="#999"/>
                </linearGradient></defs>
                <g fill="url(#eug_menu_grad)">
                    <circle cx="5" cy="12" r="2"/>
                    <circle cx="12" cy="12" r="2"/>
                    <circle cx="19" cy="12" r="2"/>
                </g>
            </svg>`;
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const row = getRow();
                if (row && row.classList.contains("eug-open")) closeRow();
                else openRow(btn);
            });
            return btn;
        }

        const LEGACY_BUTTON_IDS = ["tat-footer-btn", "spa-footer-btn"];

        function render() {
            const refBtn = findRefBtn();
            if (!refBtn) return false;
            injectCSS();

            const parent = refBtn.parentNode;
            parent.querySelectorAll('[data-eug]').forEach((el) => el.remove());
            LEGACY_BUTTON_IDS.forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.remove();
            });
            const oldRow = getRow();
            if (oldRow) oldRow.remove();

            const scripts = W.__eugeneScripts || [];
            if (scripts.length === 0) return true;

            if (scripts.length === 1) {
                parent.insertBefore(makeScriptBtn(scripts[0], refBtn, "solo"), refBtn);
            } else {
                const menuBtn = makeMenuBtn(refBtn);
                parent.insertBefore(menuBtn, refBtn);
                const row = document.createElement("div");
                row.id = ROW_ID;
                row.setAttribute("data-eug-row", "");
                for (const s of scripts) row.appendChild(makeScriptBtn(s, refBtn, "item"));
                document.body.appendChild(row);
            }
            return true;
        }

        function mount() {
            render();
            let pending = false;
            const obs = new MutationObserver(() => {
                if (pending) return;
                pending = true;
                requestAnimationFrame(() => {
                    pending = false;
                    const refBtn = findRefBtn();
                    if (refBtn && !refBtn.parentNode.querySelector('[data-eug]')) render();
                });
            });
            obs.observe(document.body, { childList: true, subtree: true });
        }

        W.addEventListener("eugene-scripts-updated", render);
        document.addEventListener("click", (e) => {
            const row = getRow();
            if (!row || !row.classList.contains("eug-open")) return;
            const menuBtn = document.querySelector('[data-eug="menu"]');
            if (menuBtn && menuBtn.contains(e.target)) return;
            if (row.contains(e.target)) return;
            closeRow();
        });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeRow(); });
        W.addEventListener("scroll", closeRow, { passive: true });
        W.addEventListener("resize", closeRow);

        W.registerEugeneScript = function (entry) {
            const list = W.__eugeneScripts;
            const i = list.findIndex((s) => s.id === entry.id);
            if (i >= 0) list[i] = entry;
            else list.push(entry);
            W.dispatchEvent(new CustomEvent("eugene-scripts-updated"));
        };
        W.mountEugeneFooterMenu = mount;
    })();

    const PAGE_CSS = `
@keyframes rcp-pulse{0%,100%{box-shadow:0 0 4px 1px rgba(46,204,113,.6)}50%{box-shadow:0 0 12px 4px rgba(46,204,113,1)}}
@keyframes rcp-pulse-warn{0%,100%{box-shadow:0 0 4px 1px rgba(230,160,40,.6)}50%{box-shadow:0 0 12px 4px rgba(230,160,40,1)}}
.rcp-hl{outline:2px solid #2ecc71!important;border-radius:4px;animation:rcp-pulse 1.4s ease-in-out infinite}
.rcp-hl.rcp-warn{outline-color:#e6a028!important;animation-name:rcp-pulse-warn}
.rcp-tag{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:9px;font-size:11px;font-weight:600;
    background:#1e4620;color:#8fe08f;vertical-align:middle;white-space:nowrap}
.rcp-tag.rcp-warn{background:#3d2e10;color:#e6c27a}
.rcp-tag.rcp-ok{background:#253025;color:#9cc89c;font-weight:400}
.enlist-list>li.rcp-best{outline:2px solid #2ecc71;outline-offset:-2px;box-shadow:inset 0 0 16px rgba(46,204,113,.35)}
.rcp-badge{margin:6px 0 2px;font-size:11px;color:#ccc;line-height:1.5}
.rcp-badge .rcp-rank{display:inline-block;min-width:22px;padding:0 6px;margin-right:6px;border-radius:9px;background:#333;color:#fff;font-weight:700;text-align:center}
.rcp-best .rcp-badge .rcp-rank{background:#2ecc71;color:#102010}
.rcp-badge .rcp-dim{color:#888}
.rcp-badge .rcp-no{color:#e08f8f}
`;

    function injectPageCss() {
        if (document.getElementById("rcp-page-style")) return;
        const s = document.createElement("style");
        s.id = "rcp-page-style";
        s.textContent = PAGE_CSS;
        document.head.appendChild(s);
    }

    class RacingPage {
        constructor(data) {
            this.data = data;
            this._timer = null;
        }

        start() {
            injectPageCss();
            const obs = new MutationObserver(() => {
                clearTimeout(this._timer);
                this._timer = setTimeout(() => this.scan(), 300);
            });
            obs.observe(document.body, { childList: true, subtree: true });
            this.scan();
        }

        rescan() {
            document.querySelectorAll("[data-rcp]").forEach((el) => el.removeAttribute("data-rcp"));
            document.querySelectorAll(".rcp-badge,.rcp-tag").forEach((el) => el.remove());
            document.querySelectorAll(".rcp-hl").forEach((el) => el.classList.remove("rcp-hl", "rcp-warn"));
            document.querySelectorAll(".rcp-best").forEach((el) => el.classList.remove("rcp-best"));
            this.scan();
        }

        scan() {
            if (!this.data.api.key) return;
            const list = document.querySelector(".enlist-list");
            if (list && !list.dataset.rcp && list.querySelector('a[step-value="changeRacingCar"]')) {
                list.dataset.rcp = "1";
                this.handleChangePage(list).catch((e) => console.warn("[RCP] change page:", e));
            }
            const btn = document.querySelector('.change-link a[href*="changeRacingCar"]');
            if (btn && !btn.dataset.rcp) {
                btn.dataset.rcp = "1";
                this.handleChangeButton(btn).catch((e) => console.warn("[RCP] change button:", e));
            }
        }

        _currentRaceTitle() {
            for (const title of document.querySelectorAll(".enlist-wrap .title-black")) {
                if (title.textContent.trim().toLowerCase() !== "current race") continue;
                const text = title.nextElementSibling?.querySelector(".enlisted-btn-wrap")?.textContent || "";
                return text.split(" - ")[0].trim();
            }
            return "";
        }

        async _requirementsFor(trackId) {
            const last = readJson(LS.lastRace);
            if (last && last.trackId === trackId && Date.now() - last.ts < TTL.lastRace) return last.requirements;
            const active = await this.data.activeRace().catch(() => null);
            if (active && active.track_id === trackId) return active.requirements;
            return null;
        }

        async handleChangePage(list) {
            const items = [...list.querySelectorAll(":scope > li")];
            const byCarId = new Map();
            for (const li of items) {
                const link = li.querySelector('a[step-value="changeRacingCar"]');
                if (link) byCarId.set(Number(link.getAttribute("id-value")), { li, link });
            }

            const track = await this.data.trackByTitle(this._currentRaceTitle());
            if (!track) return;

            for (const [carId, { li, link }] of byCarId) {
                if (li.querySelector(".icon-in-race")) {
                    writeJson(LS.currentCar, { carId, trackId: track.id, ts: Date.now() });
                }
                link.addEventListener("click", () => {
                    writeJson(LS.currentCar, { carId, trackId: track.id, ts: Date.now() });
                }, { capture: true });
            }

            const requirements = await this._requirementsFor(track.id);
            const { rows, best } = await this.data.rankForTrack(track.id, requirements);

            rows.forEach((row, i) => {
                const entry = byCarId.get(row.car.id);
                if (!entry) return;
                const { li } = entry;
                li.querySelector(".rcp-badge")?.remove();
                const isBest = best && best.car.id === row.car.id;
                li.classList.toggle("rcp-best", !!isBest);
                const badge = document.createElement("div");
                badge.className = "rcp-badge";
                const rank = row.eligible ? `#${i + 1}` : "—";
                const lap = row.est != null
                    ? `est. lap <b>${formatLap(row.est)}</b> <span class="rcp-dim">· ${escapeHtml(sourceLabel(row))}</span>`
                    : `<span class="rcp-dim">no lap data for ${escapeHtml(track.title)}</span>`;
                const own = row.ownLap != null ? ` <span class="rcp-dim">· your best ${formatLap(row.ownLap)}</span>` : "";
                const blocked = row.eligible ? "" : ` <span class="rcp-no">· not allowed in this race</span>`;
                const label = isBest ? ` <b style="color:#8fe08f">★ Best for ${escapeHtml(track.title)}</b>` : "";
                badge.innerHTML = `<span class="rcp-rank">${rank}</span>${lap}${own}${blocked}${label}`;
                const host = li.querySelector(".enlist-info") || li;
                host.appendChild(badge);
            });
        }

        _myCarInResults(race, cars) {
            const ids = new Set(cars.map((c) => c.id));
            const mine = (race.results || []).find((r) => ids.has(r.car_id));
            return mine ? mine.car_id : null;
        }

        _storedCurrentCar(race) {
            const stored = readJson(LS.currentCar);
            if (!stored || stored.trackId !== race.track_id) return null;
            const joinFrom = (race.schedule?.join_from || 0) * 1000;
            return stored.ts >= joinFrom ? stored.carId : null;
        }

        async handleChangeButton(btn) {
            const raceId = new URLSearchParams(location.search).get("raceID");
            const race = raceId
                ? await this.data.race(raceId).catch(() => null)
                : await this.data.activeRace().catch(() => null);
            if (!race || race.status !== "open") return;

            writeJson(LS.lastRace, {
                raceId: race.id, trackId: race.track_id, requirements: race.requirements, ts: Date.now(),
            });

            const [{ best }, cars, tracks] = await Promise.all([
                this.data.rankForTrack(race.track_id, race.requirements),
                this.data.cars(),
                this.data.tracks(),
            ]);
            if (!best) return;
            const trackTitle = tracks.find((t) => t.id === race.track_id)?.title || "this track";
            const currentId = this._myCarInResults(race, cars) ?? this._storedCurrentCar(race);
            const bestName = best.car.car_name || best.car.car_item_name;

            btn.parentNode.querySelector(".rcp-tag")?.remove();
            const tag = document.createElement("span");
            tag.className = "rcp-tag";
            if (currentId === best.car.id) {
                tag.classList.add("rcp-ok");
                tag.textContent = `✓ best car for ${trackTitle}`;
            } else if (currentId == null) {
                btn.classList.add("rcp-hl", "rcp-warn");
                tag.classList.add("rcp-warn");
                tag.textContent = `Best: ${bestName} — check your car`;
            } else {
                btn.classList.add("rcp-hl");
                tag.textContent = `Better car: ${bestName}`;
            }
            tag.title = best.est != null
                ? `${bestName}: est. lap ${formatLap(best.est)} (${sourceLabel(best)})`
                : `${bestName}: no lap data, picked by class`;
            btn.insertAdjacentElement("afterend", tag);
        }
    }

    const UI_CSS = `
#rcp-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:2147483646;display:none}
#rcp-overlay.rcp-open{display:flex;align-items:flex-start;justify-content:center;padding:40px 16px 16px}
#rcp-panel{background:#1b1b1b;color:#ddd;border:1px solid #333;border-radius:8px;
    width:min(860px,100%);max-height:calc(100vh - 56px);display:flex;flex-direction:column;
    font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,0.5)}
#rcp-panel h2{margin:0;padding:12px 16px;border-bottom:1px solid #333;display:flex;align-items:center;gap:8px;font-size:15px;flex-wrap:wrap}
#rcp-panel .rcp-close{margin-left:auto;background:none;border:0;color:#aaa;font-size:20px;cursor:pointer}
#rcp-tabs{display:flex;border-bottom:1px solid #333;background:#141414}
#rcp-tabs button{padding:10px 16px;background:none;border:0;color:#aaa;cursor:pointer;border-bottom:2px solid transparent;font-size:13px}
#rcp-tabs button.rcp-active{color:#fff;border-bottom-color:#2ecc71}
#rcp-body{flex:1;overflow:auto;padding:12px 16px}
#rcp-body table{width:100%;border-collapse:collapse;font-size:12px;color:#ddd}
#rcp-body th,#rcp-body td{text-align:left;padding:6px 8px;border-bottom:1px solid #2a2a2a;white-space:nowrap;color:#ddd}
#rcp-body th{background:#222;color:#bbb;position:sticky;top:0}
#rcp-body .rcp-num{text-align:right}
#rcp-body tr.rcp-row-best td{background:#16301c}
#rcp-body tr.rcp-row-blocked td{color:#777}
.rcp-controls{display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
.rcp-controls select{background:#141414;color:#ddd;border:1px solid #333;padding:6px 8px;border-radius:4px;min-width:200px}
.rcp-btn{background:#2a2a2a;color:#ddd;border:1px solid #444;padding:6px 12px;border-radius:4px;cursor:pointer}
.rcp-btn:hover{background:#333}
.rcp-btn.rcp-primary{background:#1f8a4c;border-color:#1f8a4c;color:#fff}
.rcp-sub{color:#888;font-size:11px}
.rcp-empty{padding:40px;text-align:center;color:#888}
.rcp-auth{max-width:520px;margin:24px auto;text-align:center}
.rcp-auth h3{margin:0 0 8px;color:#fff}
.rcp-auth p{color:#bbb;margin:8px 0}
.rcp-auth input{width:100%;box-sizing:border-box;background:#141414;color:#ddd;border:1px solid #333;padding:8px 10px;border-radius:4px;margin:8px 0}
.rcp-err{color:#e08f8f;min-height:16px;font-size:12px}
.rcp-note{color:#888;font-size:11px;margin-top:12px;text-align:left;background:#141414;border:1px solid #2a2a2a;border-radius:4px;padding:10px}
.rcp-status{font-size:11px;color:#888;padding:4px 16px;border-top:1px solid #333;background:#141414}
`;

    class UI {
        constructor(data, page) {
            this.data = data;
            this.api = data.api;
            this.page = page;
            this.activeTab = "picker";
            this.trackId = null;
            this._el = null;
        }

        inject() {
            if (document.getElementById("rcp-style")) return;
            const s = document.createElement("style");
            s.id = "rcp-style";
            s.textContent = UI_CSS;
            document.head.appendChild(s);

            const overlay = document.createElement("div");
            overlay.id = "rcp-overlay";
            overlay.innerHTML = `
                <div id="rcp-panel" role="dialog" aria-modal="true">
                    <h2>
                        Race Car Picker
                        <span style="color:#888;font-size:11px;font-weight:400">v${VERSION}</span>
                        <span style="color:#888;font-size:11px;font-weight:400;margin-left:10px">
                            Like the script? Send a Xanax to
                            <a href="https://www.torn.com/profiles.php?XID=4192025" target="_blank"
                               style="color:#cc3333;text-decoration:none">eugene_s [4192025]</a>
                        </span>
                        <button class="rcp-close" aria-label="close">&times;</button>
                    </h2>
                    <div id="rcp-tabs">
                        <button data-tab="picker" class="rcp-active">Best car</button>
                        <button data-tab="settings">Settings</button>
                    </div>
                    <div id="rcp-body"></div>
                    <div class="rcp-status" id="rcp-status">—</div>
                </div>`;
            overlay.addEventListener("click", (e) => { if (e.target === overlay) this.toggle(false); });
            overlay.querySelector(".rcp-close").addEventListener("click", () => this.toggle(false));
            overlay.querySelectorAll("#rcp-tabs button").forEach((b) => {
                b.addEventListener("click", () => this.switchTab(b.dataset.tab));
            });
            document.body.appendChild(overlay);
            this._el = overlay;
        }

        toggle(open) {
            const should = open ?? !this._el.classList.contains("rcp-open");
            this._el.classList.toggle("rcp-open", should);
            if (should) this.render();
        }

        setStatus(t) { this._el.querySelector("#rcp-status").textContent = t; }

        switchTab(tab) {
            this.activeTab = tab;
            this._el.querySelectorAll("#rcp-tabs button").forEach((b) => {
                b.classList.toggle("rcp-active", b.dataset.tab === tab);
            });
            this.render();
        }

        render() {
            const body = this._el.querySelector("#rcp-body");
            if (!this.api.key) return this._renderAuth(body);
            if (this.activeTab === "settings") return this._renderSettings(body);
            return this._renderPicker(body).catch((e) => {
                body.innerHTML = `<div class="rcp-empty">Failed to load: ${escapeHtml(e.message)}</div>`;
                this.setStatus("Error.");
            });
        }

        _renderAuth(body) {
            body.innerHTML = `
                <div class="rcp-auth">
                    <h3>Connect your Torn account</h3>
                    <p>Paste an API key to read your enlisted cars and lap records.</p>
                    <input type="text" id="rcp-key" maxlength="20" placeholder="16-character API key"
                           autocomplete="off" spellcheck="false">
                    <div class="rcp-err" id="rcp-key-err"></div>
                    <button class="rcp-btn rcp-primary" id="rcp-key-save">Connect</button>
                    <div class="rcp-note">
                        <b>Key level:</b> a <b>Minimal Access</b> key (or higher) is enough.
                        Get a key at <b>Settings → API</b> on torn.com. The key is stored only in this
                        browser and is sent only to <b>api.torn.com</b>. No backend, no telemetry.
                    </div>
                </div>`;
            const input = body.querySelector("#rcp-key");
            const err = body.querySelector("#rcp-key-err");
            const save = () => {
                try {
                    KeyResolver.save(input.value);
                    this.api.setKey(KeyResolver.resolve());
                    err.textContent = "";
                    this.render();
                    this.page?.rescan();
                } catch (ex) { err.textContent = ex.message; }
            };
            body.querySelector("#rcp-key-save").addEventListener("click", save);
            input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
        }

        _renderSettings(body) {
            const key = this.api.key;
            const masked = key ? key.slice(0, 4) + "…" + key.slice(-2) : "(none)";
            body.innerHTML = `
                <p>API key: <b>${escapeHtml(masked)}</b></p>
                <button class="rcp-btn" id="rcp-key-change">Change key</button>
                <button class="rcp-btn" id="rcp-cache-clear">Clear cached data</button>
                <div class="rcp-note">
                    <b>How the best car is picked</b><br>
                    1. If your car's model is in the track's top-5 lap records (any class), its record
                    lap is used. This compares car models at their best, so a model that is faster on
                    this track wins even if you never raced it there.<br>
                    2. If the model has no record, your own best lap with that model is used, scaled by
                    how far your laps are from the records on the same track (or other tracks).<br>
                    3. Cars with no data rank last. Race limits (car class, car model, stock car) are
                    respected.<br><br>
                    Track records are cached for 12 h, your cars for 5 min, your laps for 15 min.
                </div>`;
            body.querySelector("#rcp-key-change").addEventListener("click", () => {
                KeyResolver.clear(); this.api.setKey(""); this.render();
            });
            body.querySelector("#rcp-cache-clear").addEventListener("click", () => {
                Cache.clear(); this.setStatus("Cache cleared."); this.page?.rescan();
            });
        }

        async _renderPicker(body) {
            body.innerHTML = `<div class="rcp-empty">Loading…</div>`;
            this.setStatus("Loading tracks…");
            const tracks = await this.data.tracks();
            const last = readJson(LS.lastRace);
            if (this.trackId == null) this.trackId = last?.trackId ?? tracks[0]?.id;
            const requirements = last && last.trackId === this.trackId ? last.requirements : null;

            this.setStatus("Loading cars and records…");
            const { rows, best, ratio } = await this.data.rankForTrack(this.trackId, requirements);
            const track = tracks.find((t) => t.id === this.trackId);

            const opts = tracks.map((t) =>
                `<option value="${t.id}" ${t.id === this.trackId ? "selected" : ""}>${escapeHtml(t.title)}</option>`).join("");
            const tableRows = rows.map((r, i) => {
                const cls = best && best.car.id === r.car.id ? "rcp-row-best" : (r.eligible ? "" : "rcp-row-blocked");
                const name = r.car.car_name ? `${r.car.car_name} (${r.car.car_item_name})` : r.car.car_item_name;
                return `<tr class="${cls}">
                    <td>${r.eligible ? i + 1 : "—"}</td>
                    <td>${escapeHtml(name)}</td>
                    <td>${escapeHtml(r.car.class)}</td>
                    <td class="rcp-num">${formatLap(r.est)}</td>
                    <td class="rcp-num">${formatLap(r.record?.lap)}</td>
                    <td class="rcp-num">${formatLap(r.ownLap)}</td>
                    <td class="rcp-sub">${escapeHtml(r.eligible ? sourceLabel(r) : "not allowed in race")}</td>
                </tr>`;
            }).join("");

            body.innerHTML = `
                <div class="rcp-controls">
                    <select id="rcp-track">${opts}</select>
                    <button class="rcp-btn" id="rcp-refresh">Refresh</button>
                </div>
                <p class="rcp-sub">${escapeHtml(track?.description || "")}</p>
                ${requirements ? `<p class="rcp-sub">Race limits from your last race on this track are applied.</p>` : ""}
                <table>
                    <thead><tr>
                        <th>#</th><th>Car</th><th>Class</th>
                        <th class="rcp-num">Est. lap</th><th class="rcp-num">Model record</th>
                        <th class="rcp-num">Your best</th><th>Source</th>
                    </tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
                <p class="rcp-sub">${ratio ? `Your laps are ${((ratio - 1) * 100).toFixed(1)}% slower than the records on average.` : ""}</p>`;
            body.querySelector("#rcp-track").addEventListener("change", (e) => {
                this.trackId = Number(e.target.value);
                this.render();
            });
            body.querySelector("#rcp-refresh").addEventListener("click", () => {
                Cache.clear();
                this.render();
                this.page?.rescan();
            });
            this.setStatus(best ? `Best for ${track?.title}: ${best.car.car_name || best.car.car_item_name}` : "No eligible car.");
        }
    }

    const RCP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
        <defs><linearGradient id="rcp_icon_grad" x1="0.5" x2="0.5" y2="1" gradientUnits="objectBoundingBox">
            <stop offset="0" stop-color="#ddd"/><stop offset="1" stop-color="#999"/>
        </linearGradient></defs>
        <path fill="url(#rcp_icon_grad)" d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11h.5a1.5 1.5 0 0 1 1.5 1.5V17h-2v1.5a1.5 1.5 0 0 1-3 0V17H8v1.5a1.5 1.5 0 0 1-3 0V17H3v-4.5A1.5 1.5 0 0 1 4.5 11H5Zm2.1 0h9.8l-1.2-3.6a.6.6 0 0 0-.6-.4H8.9a.6.6 0 0 0-.6.4L7.1 11ZM6.5 15a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm11 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"/>
    </svg>`;

    function main() {
        const api = new TornAPI(KeyResolver.resolve());
        const data = new RaceData(api);
        const isRacing = new URLSearchParams(location.search).get("sid") === "racing";
        const page = isRacing ? new RacingPage(data) : null;
        page?.start();

        const ui = new UI(data, page);
        ui.inject();

        const W = (typeof unsafeWindow !== "undefined") ? unsafeWindow : window;
        W.registerEugeneScript({
            id: "rcp",
            name: "Race Car Picker",
            color: "#1f8a4c",
            colorDark: "#0f4526",
            hoverColor: "#2ecc71",
            iconSVG: RCP_ICON_SVG,
            onClick: () => ui.toggle(true),
        });
        W.mountEugeneFooterMenu();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", main);
    } else {
        main();
    }
})();
