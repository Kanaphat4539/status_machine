/* ============================================================
   script.js — statusMachine LIFF App
   ============================================================ */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxOJPoSQX0lfeQUBf-LFnXq3trqpTgH7EMCCOH48C2xNHeSuvvfmtNb4iLRg7fi4gg5mg/exec';
const LIFF_ID = '2010082961-A6MMdNxg'; 

let machineData = []; // Array of machines from backend
let currentMachineObj = null;
let playbackInterval = null;

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
    
    // Auto-refresh every 60s
    setInterval(loadMachineStatus, 60000); 
});

// ============================================================
// DATA FETCH
// ============================================================
async function loadMachineStatus() {
    if(!document.getElementById('app').classList.contains('hidden') === false) setLoading(true);
    try {
        const res = await fetch(GAS_URL + '?action=getMachineStatus&t=' + Date.now(), { redirect: 'follow' });
        const resData = await res.json();
        
        if (!resData.success) throw new Error(resData.error || resData.message || 'โหลดข้อมูลล้มเหลว');
        
        machineData = resData.data || [];
        renderMachineGrid();
        
        // If modal is open, refresh data and restart playback
        if (currentMachineObj && !document.getElementById('sp-modal').classList.contains('hidden')) {
            const updatedObj = machineData.find(m => m.machine === currentMachineObj.machine);
            if(updatedObj) {
                openMachineDetail(updatedObj.machine);
            }
        }
    } catch (err) {
        showToast('❌ ไม่สามารถดึงข้อมูลได้: ' + err.message, true);
    } finally {
        setLoading(false);
    }
}

// ============================================================
// RENDER OVERVIEW
// ============================================================
function renderMachineGrid() {
    const grid = document.getElementById('machine-grid');
    grid.innerHTML = '';
    
    if(machineData.length === 0) {
        grid.innerHTML = '<div style="text-align:center; color:var(--c-muted); padding:40px;">ไม่พบข้อมูลเครื่องจักร</div>';
        return;
    }
    
    machineData.forEach(m => {
        const avg = m.avg ? m.avg.toFixed(2) : '0.00';
        const std = m.std ? m.std.toFixed(3) : '0.000';
        
        const history = m.history || [];
        const lastRow = history.length > 0 ? history[history.length - 1] : null;
        
        let offCount = 0;
        let dotsHtml = '';
        
        if (lastRow && lastRow.sps) {
            for (let i = 0; i < 8; i++) {
                const sp = lastRow.sps[i];
                const isOn = sp ? (sp.status !== 'OFF' && sp.status !== '') : false;
                if (!isOn && sp && sp.status !== '') offCount++;
                const dotClass = sp && sp.status !== '' ? (isOn ? 'on' : 'off') : '';
                dotsHtml += `<div class="m-dot ${dotClass}"></div>`;
            }
        }
        
        const isError = offCount > 0;
        const cardClass = isError ? 'has-error' : 'all-good';
        const statusText = isError 
            ? `<span style="color:var(--c-danger)">มีหัวจ่ายหยุดทำงาน (${offCount})</span>` 
            : `<span style="color:var(--c-success)">ทำงานปกติทั้งหมด</span>`;
            
        const card = document.createElement('div');
        card.className = `machine-card ${cardClass}`;
        card.onclick = () => openMachineDetail(m.machine);
        card.innerHTML = `
            <div class="m-left">
                <div class="m-name">${escHtml(m.machine)}</div>
                <div class="m-status">${statusText}</div>
                <div class="m-stats">
                    <span class="stat-badge">AVG: <strong>${avg}</strong></span>
                    <span class="stat-badge">STD: <strong>${std}</strong></span>
                </div>
            </div>
            <div class="m-indicator">
                ${dotsHtml}
            </div>
        `;
        grid.appendChild(card);
    });
}

// ============================================================
// SP DETAIL MODAL & PLAYBACK
// ============================================================
function openMachineDetail(mName) {
    const mObj = machineData.find(m => m.machine === mName);
    if (!mObj) return;
    
    currentMachineObj = mObj;
    document.getElementById('modal-machine-title').textContent = mName;
    
    const history = mObj.history || [];
    if (history.length === 0) {
        showToast('ไม่มีข้อมูลการทำงานสำหรับเครื่องนี้', true);
        return;
    }
    
    const grid = document.getElementById('sp-grid');
    grid.innerHTML = '';
    
    // Stop any existing playback
    if (playbackInterval) clearInterval(playbackInterval);
    
    // Initial DOM creation (Empty containers for 8 SPs)
    for (let i = 0; i < 8; i++) {
        grid.innerHTML += `
            <div class="sp-card" id="sp-card-${i}">
                <div class="sp-header">
                    <div class="sp-name">SP ${i + 1}</div>
                    <div class="sp-status" id="sp-status-${i}">-</div>
                </div>
                <div class="sp-body">
                    <div class="sp-weight" id="sp-weight-${i}">0.00 kg</div>
                    <div class="sp-bag" id="sp-bag-${i}">-</div>
                </div>
            </div>
        `;
    }
    
    document.getElementById('sp-modal').classList.remove('hidden');
    
    // Start Playback from row 0 to history.length - 1
    let playIndex = 0;
    
    playbackInterval = setInterval(() => {
        if (playIndex >= history.length) {
            // Reached the end, stop playback (shows the latest data)
            clearInterval(playbackInterval);
            return;
        }
        
        const rowData = history[playIndex];
        const sps = rowData.sps || [];
        
        for (let i = 0; i < 8; i++) {
            const sp = sps[i];
            const cardEl = document.getElementById(`sp-card-${i}`);
            const statusEl = document.getElementById(`sp-status-${i}`);
            const weightEl = document.getElementById(`sp-weight-${i}`);
            const bagEl = document.getElementById(`sp-bag-${i}`);
            
            if (!sp || sp.status === '') {
                cardEl.className = 'sp-card';
                statusEl.textContent = '-';
                continue;
            }
            
            const isOn = (sp.status !== 'OFF');
            cardEl.className = `sp-card ${isOn ? 'on' : 'off'}`;
            statusEl.textContent = sp.textStatus || sp.status;
            
            // Format weight (if it's 0 or empty, display 0.00)
            const weightVal = Number(sp.weight) || 0;
            weightEl.textContent = weightVal.toFixed(2) + ' kg';
            
            // Use bag number directly from the Sheet (Column C)
            const displayBag = rowData.bag ? `ถุงที่ ${rowData.bag}` : `ถุงที่ ${playIndex + 1}`;
            
            bagEl.textContent = displayBag;
        }
        
        playIndex++;
        
    }, 200); // Playback speed: 200ms per row (adjust if needed)
}

function closeModal() {
    if (playbackInterval) clearInterval(playbackInterval);
    document.getElementById('sp-modal').classList.add('hidden');
    currentMachineObj = null;
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
