// ==UserScript==
// @name         Torn Race Car Picker
// @namespace    https://github.com/eugene-torn-scripts/race-car-picker
// @version      2.1.0
// @description  Shows the fastest car model for the current race track, picked from the global lap records.
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

    const VERSION = "2.1.0";

    const API_BASE = "https://api.torn.com/v2";
    const API_DELAY_MS = 700;
    const PDA_TIMEOUT_MS = 20_000;
    const RATE_LIMIT_COOLDOWN_MS = 60_000;
    const RATE_LIMIT_ERROR_CODE = 5;
    const CAR_CLASSES = ["A", "B", "C", "D", "E"];
    const KEY_RE = /^[A-Za-z0-9]{16}$/;

    const TRACK_PLAN = [
        { track: "Commerce", car: "Edomondo NSX", build: "TS2" },
        { track: "Sewage", car: "Edomondo NSX", build: "TS2" },
        { track: "Underdog", car: "Edomondo NSX", build: "TS2" },
        { track: "Industrial", car: "Edomondo NSX", build: "TS3" },
        { track: "Meltdown", car: "Edomondo NSX", build: "TS3" },
        { track: "Vector", car: "Edomondo NSX", build: "TS3" },
        { track: "Hammerhead", car: "Edomondo NSX", build: "DS2" },
        { track: "Parkland", car: "Edomondo NSX", build: "DS3" },
        { track: "Two Islands", car: "Edomondo NSX", build: "DL3" },
        { track: "Speedway", car: "Veloria LFA", build: "TL3" },
        { track: "Uptown", car: "Veloria LFA", build: "TL3" },
        { track: "Withdrawal", car: "Veloria LFA", build: "TL3" },
        { track: "Stone Park", car: "Echo R8", build: "DS3" },
        { track: "Mudpit", car: "Colina Tanprice", build: "DL3" },
        { track: "Docks", car: "Volt GT", build: "TL3" },
        { track: "Convict", car: "Mercia SLR", build: "TL3" },
    ];

    const BUILD_SURFACE = {
        T: { name: "Tarmac", parts: ["Track Tires", "Adjustable Coilover Suspension"], gearbox: "Paddle Shift Gearbox" },
        D: { name: "Dirt", parts: ["Rally Tires", "Group N Rally Suspension"], gearbox: "Rally Gearbox" },
    };
    const BUILD_RATIO = { S: "Short Ratio", L: "Long Ratio" };
    const BUILD_TURBO = { 2: "Stage Two Turbo kit", 3: "Stage Three Turbo Kit" };

    const BASE_PARTS = [
        "Strip Out", "Racing Steering Wheel", "Lightweight Flocked Dash", "Polycarbonate Windows",
        "Carbon Fiber Roof", "Carbon Fiber Trunk", "Carbon Fiber Hood", "Ultra-Lightweight Alloys",
        "Air Forced Engine Cooling", "Air Cooling Ducts for Brakes", "Adjustable Rear Spoiler",
        "Front Diffuser", "Rear Diffuser", "Fast Road Brake Fluid", "Braided Brake Hoses",
        "Grooved and Drilled Brake Discs", "Competition Racing Brake Pads", "Brake Balance Bias Control",
        "6 Pot Uprated Brakes", "Ported and Polished Head", "Competition Racing Fuel Pump",
        "Competition Polished Throttle Body", "Bored Out Engine + Forged Pistons", "Front Mounted Intercooler",
        "Stage Three Remap", "Competition Racing Camshaft", "Full Exhaust System", "Stainless Steel 4-1 Manifold",
        "Custom Forced Induction Kit", "Super Octane Fuel Plus Nitrous", "Polyurethane Bushings Front",
        "Polyurethane Bushings Rear", "Upper Front Strut Brace", "Lower Front Strut Brace", "Rear Strut Brace",
        "Front Adjustable Tie Rods", "Adjustable Rear Control arms", "Quick Shift", "4 Pin Differential",
        "Competition Racing Clutch", "Ultra-Light Flywheel",
    ];

    const TTL = {
        tracks: 7 * 24 * 3600_000,
        records: 12 * 3600_000,
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

        race(raceId) {
            return this._cached(`race_${raceId}`, TTL.race, async () => (await this.api.get(`/racing/${raceId}/race`)).race);
        }

        async fastestForTrack(trackId, requirements) {
            const byClass = fastestByClass(await this.trackRecords(trackId), requirements);
            return { best: fastestCar(byClass), byClass };
        }

        activeRace() {
            return this._cached("activeRace", TTL.activeRace, async () => {
                const d = await this.api.get("/user/races", { limit: 5, sort: "DESC" });
                return (d.races || []).find((r) => r.status !== "finished") || null;
            });
        }
    }

    function fastestByClass(records, requirements) {
        const out = [];
        for (const cls of CAR_CLASSES) {
            if (requirements?.car_class && cls !== requirements.car_class) continue;
            const list = (records?.[cls] || [])
                .filter((r) => !requirements?.car_item_id || r.model === requirements.car_item_id);
            if (!list.length) continue;
            const top = list.reduce((a, b) => (b.lap < a.lap ? b : a));
            out.push({ ...top, cls });
        }
        return out;
    }

    function fastestCar(byClass) {
        return byClass.reduce((a, b) => (!a || b.lap < a.lap ? b : a), null);
    }

    function bestRowState(best, currentModelName) {
        if (!best || !currentModelName) return "unknown";
        return best.name === currentModelName.trim() ? "current" : "change";
    }

    function buildParts(build) {
        const [surface, ratio, turbo] = build;
        const s = BUILD_SURFACE[surface];
        return [...s.parts, `${s.gearbox} (${BUILD_RATIO[ratio]})`, BUILD_TURBO[turbo]];
    }

    function planForTrack(trackTitle) {
        const wanted = (trackTitle || "").trim().toLowerCase();
        return TRACK_PLAN.find((p) => p.track.toLowerCase() === wanted) || null;
    }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = {
            fastestByClass, fastestCar, formatLap, bestRowState, buildParts, planForTrack,
            TRACK_PLAN, BUILD_SURFACE, BUILD_RATIO, BUILD_TURBO,
        };
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
.rcp-row{clear:both;margin:8px 0;padding:8px 10px;border-radius:5px;font-size:12px;line-height:1.5;color:#ddd;
    background:#2a2213;border:1px solid #5a4a1a}
.rcp-row.rcp-current{background:#16301c;border-color:#2e6b3c}
.rcp-row b{color:#fff}
.rcp-row .rcp-dim{color:#999}
.rcp-row .rcp-verdict{font-weight:600;color:#e6c27a}
.rcp-row .rcp-info{display:inline-block;width:18px;height:18px;margin-left:6px;padding:0;border-radius:50%;
    border:1px solid #888;background:transparent;color:#ddd;font:italic 700 12px/16px Georgia,serif;cursor:pointer;vertical-align:middle}
.rcp-row .rcp-info:hover{background:#444}
.rcp-row.rcp-current .rcp-verdict{color:#8fe08f}
`;

    function injectPageCss() {
        if (document.getElementById("rcp-page-style")) return;
        const s = document.createElement("style");
        s.id = "rcp-page-style";
        s.textContent = PAGE_CSS;
        document.head.appendChild(s);
    }

    function bestRowHtml(trackTitle, best, byClass, state) {
        const verdict = state === "current" ? "✓ you use it"
            : state === "change" ? "change to it"
            : "";
        let html = `Fastest car for ${escapeHtml(trackTitle)}: <b>${escapeHtml(best.name)}</b> (class ${best.cls})`
            + ` · lap <b>${formatLap(best.lap)}</b> <span class="rcp-dim">(record by ${escapeHtml(best.driver)})</span>`
            + (verdict ? ` — <span class="rcp-verdict">${verdict}</span>` : "")
            + `<button type="button" class="rcp-info" title="Car plan for all tracks">i</button>`;
        if (byClass.length > 1) {
            const perClass = byClass
                .map((r) => `${r.cls}: ${escapeHtml(r.name)} ${formatLap(r.lap)}`)
                .join(" · ");
            html += `<br><span class="rcp-dim">Per class — ${perClass}</span>`;
        }
        return html;
    }

    class RacingPage {
        constructor(data) {
            this.data = data;
            this._timer = null;
            this._closedRaces = new Set();
            this._busy = new WeakSet();
            this.onInfo = null;
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
            document.querySelectorAll(".rcp-row").forEach((el) => el.remove());
            this.scan();
        }

        scan() {
            if (!this.data.api.key) return;
            const carBox = document.querySelector(".car-selected .cont-black");
            if (carBox && !carBox.querySelector(".rcp-row")) this._run(carBox, () => this.handleRacePage(carBox));
            const list = document.querySelector(".enlist-list");
            const wrap = list?.closest(".enlist-wrap");
            if (wrap && !wrap.querySelector(".rcp-row") && list.querySelector('a[step-value="changeRacingCar"]')) {
                this._run(wrap, () => this.handleChangePage(wrap, list));
            }
        }

        _run(host, fn) {
            if (this._busy.has(host)) return;
            this._busy.add(host);
            fn().catch((e) => console.warn("[RCP]", e)).finally(() => this._busy.delete(host));
        }

        _showRow(anchor, position, html, state, trackTitle) {
            const row = document.createElement("div");
            row.className = "rcp-row" + (state === "current" ? " rcp-current" : "");
            row.innerHTML = html;
            row.querySelector(".rcp-info")?.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.onInfo?.(trackTitle);
            });
            anchor.insertAdjacentElement(position, row);
        }

        _raceIdFromPage() {
            const fromUrl = new URLSearchParams(location.search).get("raceID");
            if (fromUrl) return fromUrl;
            const dataId = document.querySelector("#leaderBoard li[data-id]")?.getAttribute("data-id") || "";
            const m = /^(\d+)-/.exec(dataId);
            return m ? m[1] : null;
        }

        async handleRacePage(carBox) {
            const raceId = this._raceIdFromPage();
            if (raceId && this._closedRaces.has(raceId)) return;
            const race = raceId
                ? await this.data.race(raceId).catch(() => null)
                : await this.data.activeRace().catch(() => null);
            if (!race) return;
            if (race.status !== "open") { this._closedRaces.add(String(race.id)); return; }

            writeJson(LS.lastRace, {
                raceId: race.id, trackId: race.track_id, requirements: race.requirements, ts: Date.now(),
            });

            const [{ best, byClass }, tracks] = await Promise.all([
                this.data.fastestForTrack(race.track_id, race.requirements),
                this.data.tracks(),
            ]);
            if (!best || carBox.querySelector(".rcp-row")) return;
            const trackTitle = tracks.find((t) => t.id === race.track_id)?.title || "this track";
            const currentModel = carBox.querySelector(".model-wrap .img[title]")?.getAttribute("title");
            const state = bestRowState(best, currentModel);
            this._showRow(carBox, "beforeend", bestRowHtml(trackTitle, best, byClass, state), state, trackTitle);
        }

        _currentRaceBlock(wrap) {
            for (const title of wrap.querySelectorAll(".title-black")) {
                if (title.textContent.trim().toLowerCase() === "current race") return title.nextElementSibling;
            }
            return null;
        }

        async _requirementsFor(trackId) {
            const last = readJson(LS.lastRace);
            if (last && last.trackId === trackId && Date.now() - last.ts < TTL.lastRace) return last.requirements;
            const active = await this.data.activeRace().catch(() => null);
            if (active && active.track_id === trackId) return active.requirements;
            return null;
        }

        async handleChangePage(wrap, list) {
            const block = this._currentRaceBlock(wrap);
            const title = (block?.querySelector(".enlisted-btn-wrap")?.textContent || "").split(" - ")[0];
            const track = await this.data.trackByTitle(title);
            if (!track) return;

            const requirements = await this._requirementsFor(track.id);
            const { best, byClass } = await this.data.fastestForTrack(track.id, requirements);
            if (!best || wrap.querySelector(".rcp-row")) return;

            const currentLi = [...list.querySelectorAll(":scope > li")].find((li) => li.querySelector(".icon-in-race"));
            const currentModel = currentLi?.querySelector(".model .bold")?.textContent.trim();
            const state = bestRowState(best, currentModel);
            this._showRow(block || list, block ? "afterend" : "beforebegin", bestRowHtml(track.title, best, byClass, state), state, track.title);
        }
    }

    const UI_CSS = `
#rcp-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:2147483646;display:none}
#rcp-overlay.rcp-open{display:flex;align-items:flex-start;justify-content:center;padding:40px 16px 16px}
#rcp-panel{background:#1b1b1b;color:#ddd;border:1px solid #333;border-radius:8px;
    width:min(620px,100%);max-height:calc(100vh - 56px);display:flex;flex-direction:column;
    font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,0.5)}
#rcp-panel h2{margin:0;padding:12px 16px;border-bottom:1px solid #333;display:flex;align-items:center;gap:8px;font-size:15px;flex-wrap:wrap}
#rcp-panel .rcp-close{margin-left:auto;background:none;border:0;color:#aaa;font-size:20px;cursor:pointer}
#rcp-body{flex:1;overflow:auto;padding:12px 16px}
.rcp-btn{background:#2a2a2a;color:#ddd;border:1px solid #444;padding:6px 12px;border-radius:4px;cursor:pointer}
.rcp-btn:hover{background:#333}
.rcp-btn.rcp-primary{background:#1f8a4c;border-color:#1f8a4c;color:#fff}
.rcp-auth{max-width:520px;margin:12px auto;text-align:center}
.rcp-auth h3{margin:0 0 8px;color:#fff}
.rcp-auth p{color:#bbb;margin:8px 0}
.rcp-auth input{width:100%;box-sizing:border-box;background:#141414;color:#ddd;border:1px solid #333;padding:8px 10px;border-radius:4px;margin:8px 0}
.rcp-err{color:#e08f8f;min-height:16px;font-size:12px}
.rcp-note{color:#888;font-size:11px;margin-top:12px;text-align:left;background:#141414;border:1px solid #2a2a2a;border-radius:4px;padding:10px}
.rcp-msg{color:#8fe08f;font-size:12px;min-height:16px;margin-top:8px}
.rcp-plan{width:100%;border-collapse:collapse;font-size:12px}
.rcp-plan th,.rcp-plan td{text-align:left;padding:5px 8px;border-bottom:1px solid #2a2a2a}
.rcp-plan th{color:#999;font-weight:600}
.rcp-plan tr.rcp-here td{background:#16301c;color:#fff}
.rcp-plan .rcp-build{font-family:ui-monospace,Menlo,monospace;color:#e6c27a}
.rcp-legend{margin-top:12px;font-size:12px;color:#bbb}
.rcp-legend b{color:#ddd}
`;

    class UI {
        constructor(data, page) {
            this.data = data;
            this.api = data.api;
            this.page = page;
            this._el = null;
            this._view = "settings";
            this._planTrack = null;
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
                    <div id="rcp-body"></div>
                </div>`;
            overlay.addEventListener("click", (e) => { if (e.target === overlay) this.toggle(false); });
            overlay.querySelector(".rcp-close").addEventListener("click", () => this.toggle(false));
            document.body.appendChild(overlay);
            this._el = overlay;
        }

        toggle(open) {
            const should = open ?? !this._el.classList.contains("rcp-open");
            this._el.classList.toggle("rcp-open", should);
            if (should) this.render();
        }

        open(view, planTrack = null) {
            this._view = view;
            this._planTrack = planTrack;
            this.toggle(true);
        }

        render() {
            const body = this._el.querySelector("#rcp-body");
            if (this._view === "plan") return this._renderPlan(body);
            if (!this.api.key) return this._renderAuth(body);
            return this._renderSettings(body);
        }

        _renderAuth(body) {
            body.innerHTML = `
                <div class="rcp-auth">
                    <h3>Connect your Torn account</h3>
                    <p>Paste an API key to read the track lap records.</p>
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
                <button class="rcp-btn" id="rcp-cache-clear">Refresh data</button>
                <button class="rcp-btn" id="rcp-plan-open">Car plan</button>
                <div class="rcp-msg" id="rcp-msg"></div>
                <div class="rcp-note">
                    While a race is open, a row on the race page and on the Change Car page shows
                    the fastest car model for the track. It is the model with the best lap in the
                    track's top-5 lap records. The race class and car model limits are respected.
                    The row also shows the fastest model in each class.
                </div>`;
            body.querySelector("#rcp-key-change").addEventListener("click", () => {
                KeyResolver.clear(); this.api.setKey(""); this.page?.rescan(); this.render();
            });
            body.querySelector("#rcp-plan-open").addEventListener("click", () => this.open("plan"));
            body.querySelector("#rcp-cache-clear").addEventListener("click", () => {
                Cache.clear();
                this.page?.rescan();
                body.querySelector("#rcp-msg").textContent = "Data refreshed.";
            });
        }

        _renderPlan(body) {
            const here = planForTrack(this._planTrack);
            const rows = TRACK_PLAN.map((p) => `
                <tr class="${p === here ? "rcp-here" : ""}">
                    <td>${escapeHtml(p.track)}</td>
                    <td>${BUILD_SURFACE[p.build[0]].name}</td>
                    <td>${escapeHtml(p.car)}</td>
                    <td class="rcp-build">${p.build}</td>
                </tr>`).join("");
            const surfaces = Object.entries(BUILD_SURFACE)
                .map(([code, sf]) => `<b>${code}</b> = ${sf.name}: ${sf.parts.join(", ")}, ${sf.gearbox}`)
                .join("<br>");
            const hereHtml = here
                ? `<p>${escapeHtml(here.track)}: <b>${escapeHtml(here.car)}</b> <span class="rcp-build">${here.build}</span>
                    — ${buildParts(here.build).map(escapeHtml).join(", ")}, and all base parts below.</p>`
                : "";
            body.innerHTML = `
                ${hereHtml}
                <table class="rcp-plan">
                    <thead><tr><th>Track</th><th>Surface</th><th>Car</th><th>Build</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
                <div class="rcp-legend">
                    One car for each different car + build pair.<br><br>
                    <b>Build code</b><br>
                    ${surfaces}<br>
                    <b>S</b> / <b>L</b> = gearbox ${BUILD_RATIO.S} / ${BUILD_RATIO.L}<br>
                    <b>2</b> / <b>3</b> = ${BUILD_TURBO[2]} / ${BUILD_TURBO[3]}<br><br>
                    <b>Base parts (all builds):</b> ${BASE_PARTS.map(escapeHtml).join(", ")}.
                </div>
                <div style="margin-top:12px"><button class="rcp-btn" id="rcp-plan-back">Back</button></div>`;
            body.querySelector("#rcp-plan-back").addEventListener("click", () => this.open("settings"));
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
        if (page) page.onInfo = (trackTitle) => ui.open("plan", trackTitle);

        const W = (typeof unsafeWindow !== "undefined") ? unsafeWindow : window;
        W.registerEugeneScript({
            id: "rcp",
            name: "Race Car Picker",
            color: "#1f8a4c",
            colorDark: "#0f4526",
            hoverColor: "#2ecc71",
            iconSVG: RCP_ICON_SVG,
            onClick: () => ui.open("settings"),
        });
        W.mountEugeneFooterMenu();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", main);
    } else {
        main();
    }
})();
