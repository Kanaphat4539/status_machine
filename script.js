/* ============================================================
   script.js — statusMachine LIFF App
   ============================================================ */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxOJPoSQX0lfeQUBf-LFnXq3trqpTgH7EMCCOH48C2xNHeSuvvfmtNb4iLRg7fi4gg5mg/exec';
const LIFF_ID = '2010082961-GTtjRCn3'; // ใช้ร่วมกันชั่วคราว หรือผู้ใช้เปลี่ยนทีหลัง

let rawData = [];
let groupedMachines = {};
let currentMachine = null;
let spIntervals = {};
let downtimeIntervals = {};

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', async () => {
    try {
        await liff.init({ liffId: LIFF_ID });
        if (!liff.isLoggedIn()) {
            liff.login();
            return;
        }
    } catch (e) {
        console.warn('LIFF init failed or skipped (dev mode):', e.message);
    }
    await loadMachineStatus();

    // Auto-refresh every 60s to get new real data
    setInterval(loadMachineStatus, 60000);
});

// ============================================================
// DATA FETCH
// ============================================================
async function loadMachineStatus() {
    if (!document.getElementById('app').classList.contains('hidden') === false) setLoading(true);
    try {
        const res = await fetch(GAS_URL + '?action=getMachineStatus&t=' + Date.now(), { redirect: 'follow' });
        const resData = await res.json();

        if (!resData.success) throw new Error(resData.error || resData.message || 'โหลดข้อมูลล้มเหลว');

        rawData = resData.data || [];
        processMachineData();
        renderMachineGrid();

        // If modal is open, refresh it
        if (currentMachine && !document.getElementById('sp-modal').classList.contains('hidden')) {
            openMachineDetail(currentMachine);
        }
    } catch (err) {
        showToast('❌ ไม่สามารถดึงข้อมูลได้: ' + err.message, true);
    } finally {
        setLoading(false);
    }
}

// Group data by Machine Name
function processMachineData() {
    groupedMachines = {};
    rawData.forEach(sp => {
        const mName = sp.machine || 'Unknown';
        if (!groupedMachines[mName]) {
            groupedMachines[mName] = [];
        }
        groupedMachines[mName].push(sp);
    });

    // Sort SPs by SP_No inside each machine
    Object.keys(groupedMachines).forEach(mName => {
        groupedMachines[mName].sort((a, b) => {
            const numA = parseInt(String(a.spNo).replace(/\D/g, '')) || 0;
            const numB = parseInt(String(b.spNo).replace(/\D/g, '')) || 0;
            return numA - numB;
        });
    });
}

// ============================================================
// RENDER OVERVIEW
// ============================================================
function renderMachineGrid() {
    const grid = document.getElementById('machine-grid');
    grid.innerHTML = '';

    const machines = Object.keys(groupedMachines).sort();

    if (machines.length === 0) {
        grid.innerHTML = '<div style="text-align:center; color:var(--c-muted); padding:40px;">ไม่พบข้อมูลเครื่องจักร</div>';
        return;
    }

    machines.forEach(mName => {
        const sps = groupedMachines[mName];
        const offSPs = sps.filter(s => s.status === 'OFF');

        const isError = offSPs.length > 0;
        const cardClass = isError ? 'has-error' : 'all-good';

        const statusText = isError
            ? `<span style="color:var(--c-danger)">มีหัวจ่ายหยุดทำงาน (${offSPs.length})</span>`
            : `<span style="color:var(--c-success)">ทำงานปกติทั้งหมด</span>`;

        // Build 8 little dots for visual indicator
        // Assuming max 8 SPs
        let dotsHtml = '';
        for (let i = 0; i < Math.max(8, sps.length); i++) {
            const sp = sps[i];
            const isOn = sp ? (sp.status !== 'OFF') : false;
            const dotClass = !sp ? '' : isOn ? 'on' : 'off';
            dotsHtml += `<div class="m-dot ${dotClass}"></div>`;
        }

        const card = document.createElement('div');
        card.className = `machine-card ${cardClass}`;
        card.onclick = () => openMachineDetail(mName);
        card.innerHTML = `
            <div>
                <div class="m-name">${escHtml(mName)}</div>
                <div class="m-status">${statusText}</div>
            </div>
            <div class="m-indicator">
                ${dotsHtml}
            </div>
        `;
        grid.appendChild(card);
    });
}

// ============================================================
// SP DETAIL MODAL & ANIMATION
// ============================================================
function openMachineDetail(mName) {
    currentMachine = mName;
    const sps = groupedMachines[mName] || [];

    document.getElementById('modal-machine-title').textContent = mName;
    const grid = document.getElementById('sp-grid');
    grid.innerHTML = '';

    // Clear old intervals
    clearAllIntervals();

    // Generate 8 boxes (Even if data has less, show 8 empty or filled)
    for (let i = 0; i < 8; i++) {
        const sp = sps[i]; // Might be undefined

        const spNoText = sp ? (sp.spNo || `SP ${i + 1}`) : `SP ${i + 1}`;
        const isOn = sp ? (sp.status !== 'OFF') : false;
        const isOff = sp ? (sp.status === 'OFF') : true;
        const boxClass = sp ? (isOn ? 'on' : 'off') : '';
        const statusLabel = sp ? sp.status : 'N/A';

        const targetBag = sp ? (sp.currentBag || 0) : 0;
        const targetWeight = sp ? (sp.currentWeight || 0.0) : 0.0;

        // Initial HTML
        grid.innerHTML += `
            <div class="sp-card ${boxClass}" id="sp-card-${i}">
                <div class="sp-header">
                    <div class="sp-name">${escHtml(spNoText)}</div>
                    ${sp ? `<div class="sp-status">${escHtml(statusLabel)}</div>` : ''}
                </div>
                <div class="sp-body">
                    <div class="sp-weight" id="sp-weight-${i}">${isOff ? targetWeight.toFixed(2) : '0.00'} kg</div>
                    <div class="sp-bag" id="sp-bag-${i}">${isOff ? `ถุงที่ ${targetBag}` : 'กำลังโหลด...'}</div>
                </div>
                ${isOff && sp && sp.stopTime ? `
                <div class="sp-timer">
                    <span>หยุดทำงานแล้ว</span>
                    <div id="sp-timer-${i}">00:00:00</div>
                </div>
                ` : ''}
            </div>
        `;
    }

    // Start Logic for each SP
    for (let i = 0; i < 8; i++) {
        const sp = sps[i];
        if (!sp) continue;

        if (sp.status !== 'OFF') {
            // GREEN SP: Loop animation to target bag and weight
            startCountingAnimation(i, sp.currentBag, sp.currentWeight);
        } else {
            // RED SP: Calculate Downtime Timer
            if (sp.stopTime) {
                startDowntimeTimer(i, sp.stopTime);
            }
        }
    }

    document.getElementById('sp-modal').classList.remove('hidden');
}

function closeModal() {
    clearAllIntervals();
    document.getElementById('sp-modal').classList.add('hidden');
    currentMachine = null;
}

// ---------------------------------
// ANIMATION: Simulate Bag Counting
// ---------------------------------
function startCountingAnimation(index, targetBag, targetWeight) {
    let currentAnimatedBag = Math.max(0, targetBag - 10); // Start 10 bags behind for animation effect
    let currentAnimatedWeight = 0;

    const weightEl = document.getElementById(`sp-weight-${index}`);
    const bagEl = document.getElementById(`sp-bag-${index}`);

    spIntervals[index] = setInterval(() => {
        // Increment Bag
        if (currentAnimatedBag < targetBag) {
            currentAnimatedBag++;
            // Randomize weight while counting up
            currentAnimatedWeight = targetWeight * (0.95 + Math.random() * 0.1);
        } else {
            // Reached Target Bag
            currentAnimatedBag = targetBag;
            currentAnimatedWeight = targetWeight;
            // Stop animation because it reached the actual bag.
            // If the user meant "loop continuously no matter what", we'd reset.
            // But user said: "เขียวก็นับวนไปเรื่อยๆจนถึงถุงสุดท้าย ถ้าไม่มีถุงอื่นเพิ่มเข้าก็จะหยุดที่ถุงสุดท้ายที่เจอ" 
            // -> (Green counts to last bag, stops if no new bags)
            clearInterval(spIntervals[index]);
        }

        weightEl.textContent = currentAnimatedWeight.toFixed(2) + ' kg';
        bagEl.textContent = `ถุงที่ ${currentAnimatedBag}`;

    }, 150); // Speed of animation
}

// ---------------------------------
// TIMER: Calculate Downtime
// ---------------------------------
function startDowntimeTimer(index, stopTimeStr) {
    const stopTime = new Date(stopTimeStr).getTime();
    if (isNaN(stopTime)) return;

    const timerEl = document.getElementById(`sp-timer-${index}`);
    if (!timerEl) return;

    const tick = () => {
        const now = Date.now();
        const diff = Math.max(0, now - stopTime);
        timerEl.textContent = formatDuration(diff);
    };

    tick(); // initial tick
    downtimeIntervals[index] = setInterval(tick, 1000);
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

function clearAllIntervals() {
    Object.values(spIntervals).forEach(clearInterval);
    Object.values(downtimeIntervals).forEach(clearInterval);
    spIntervals = {};
    downtimeIntervals = {};
}

// ============================================================
// UTILS
// ============================================================
function setLoading(isLoading) {
    const loader = document.getElementById('loading-screen');
    const app = document.getElementById('app');
    if (isLoading) {
        loader.style.display = 'flex';
        setTimeout(() => loader.style.opacity = '1', 10);
    } else {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.style.display = 'none';
            app.classList.remove('hidden');
        }, 400);
    }
}
function showToast(msg, isError = false) {
    const div = document.createElement('div');
    div.className = 'toast' + (isError ? ' error' : '');
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; div.style.transition = 'opacity 0.5s'; setTimeout(() => div.remove(), 500); }, 3000);
}
function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
