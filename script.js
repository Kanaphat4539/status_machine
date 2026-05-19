/* ============================================================
   script.js — statusMachine LIFF App
   ============================================================ */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbx6tPYtQ2z3EmQ-fN9vYXdkd-SexHh2MBdqIHXzPUT4V6Biq29MIUPrQJG_5iMFsD2Yzg/exec';
const LIFF_ID = '2010082961-A6MMdNxg';
const FIRST_BAG_DELAY_MS = 15000;
const NEXT_BAG_INTERVAL_MS = 1000;

let machineData = []; // Array of machines from backend
let activeJobs = []; // Array of active jobs
let currentMachineObj = null;
let playbackInterval = null;
let playbackTimers = [];
let shownSevereAlerts = new Set();
let frozenBags = {}; // To freeze bag numbering for SPs

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
    if (!document.getElementById('app').classList.contains('hidden') === false) setLoading(true);
    try {
        const res = await fetch(GAS_URL + '?action=getMachineStatus&t=' + Date.now(), { redirect: 'follow' });
        const resData = await res.json();

        if (!resData.success) throw new Error(resData.error || resData.message || 'โหลดข้อมูลล้มเหลว');

        machineData = resData.data || [];
        activeJobs = resData.activeJobs || [];
        renderMachineGrid();

        // Keep playback running while the detail modal is open; restarting here
        // would reset the count every auto-refresh cycle.
        if (currentMachineObj && !document.getElementById('sp-modal').classList.contains('hidden')) {
            const updatedObj = machineData.find(m => m.machine === currentMachineObj.machine);
            if (updatedObj) {
                currentMachineObj = updatedObj;
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
function getProcessStatus_(sp) {
    const raw = String(sp?.textStatus || sp?.displayStatus || sp?.status || '').trim();
    if (!raw || raw === 'ON' || raw === 'OFF' || raw === 'HOLD') return '';
    return raw;
}

function hasProcessStatus_(sp) {
    return Boolean(getProcessStatus_(sp));
}

function isWarningStatus_(sp) {
    return getProcessStatus_(sp).toLowerCase() === 'warning';
}

function isSevereStatus_(sp) {
    return /^(critical\s+)?(over|under)$/i.test(getProcessStatus_(sp)) || sp?.status === 'CRITICAL';
}

function hasProblemForSp_(history, spIndex) {
    return (history || []).some(row => {
        const sp = row?.sps?.[spIndex];
        return Boolean(sp?.problem || sp?.problemHold || isSevereStatus_(sp));
    });
}

function getDatabaseBagNo_(rowData, rowIndex, spIndex) {
    const roundNo = Number(rowData?.round) || rowIndex + 1;
    return ((roundNo - 1) * 8) + spIndex + 1;
}

function renderMachineGrid() {
    const grid = document.getElementById('machine-grid');
    grid.innerHTML = '';

    if (machineData.length === 0) {
        grid.innerHTML = '<div style="text-align:center; color:var(--c-muted); padding:40px;">ไม่พบข้อมูลเครื่องจักร</div>';
        return;
    }

    machineData.forEach(m => {
        const avg = m.avg ? m.avg.toFixed(2) : '0.00';
        const std = m.std ? m.std.toFixed(3) : '0.000';

        const history = m.history || [];
        const lastRow = history.length > 0 ? history[history.length - 1] : null;

        let offCount = 0;
        let criticalCount = 0;
        let warningCount = 0;
        let dotsHtml = '';

        if (lastRow && lastRow.sps) {
            for (let i = 0; i < 8; i++) {
                const sp = lastRow.sps[i];
                if (sp) {
                    if (isSevereStatus_(sp)) criticalCount++;
                    else if (isWarningStatus_(sp)) warningCount++;
                    else if (sp.status === 'OFF' || sp.status === 'HOLD') offCount++;
                }
                const dotClass = sp && sp.status !== ''
                    ? (isSevereStatus_(sp) ? 'critical' : (isWarningStatus_(sp) ? 'warning' : (sp.status === 'ON' ? 'on' : 'off')))
                    : '';
                dotsHtml += `<div class="m-dot ${dotClass}"></div>`;
            }
        }

        let isBreakdown = m.machineState === 'OFF';
        let cardClass = isBreakdown ? 'is-breakdown' : (criticalCount > 0 ? 'has-critical' : (warningCount > 0 ? 'has-warning' : (offCount > 0 ? 'has-error' : 'all-good')));

        let statusText = `<span style="color:var(--c-success)">ทำงานปกติทั้งหมด</span>`;
        if (isBreakdown) {
            let breakdownTimeStr = 'กำลังโหลด...';
            if (m.breakdownStartTime) {
                const minutes = Math.floor((Date.now() - m.breakdownStartTime) / 60000);
                breakdownTimeStr = `หยุดทำงานมา ${minutes} นาที`;
            }
            statusText = `<span style="color:var(--c-danger); font-weight:bold;">BREAKDOWN (${breakdownTimeStr})</span>`;
        } else if (criticalCount > 0) {
            statusText = `<span style="color:var(--c-danger); font-weight:bold;">เครื่องไม่หยุด แต่แจ้งเตือนรุนแรง (${criticalCount} หัว)</span>`;
        } else if (warningCount > 0) {
            statusText = `<span style="color:var(--c-warning); font-weight:bold;">เครื่องไม่หยุด แต่มีแจ้งเตือน (${warningCount} หัว)</span>`;
        } else if (offCount > 0) {
            statusText = `<span style="color:var(--c-danger)">มีหัวจ่ายหยุดทำงาน (${offCount})</span>`;
        }

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
    clearPlayback();

    // Initial DOM creation (Empty containers for 8 SPs)
    const machineJobs = activeJobs.filter(j => j.machine === mName);

    for (let i = 0; i < 8; i++) {
        const spNo = i + 1;
        const job = machineJobs.find(j => isSameSp_(j.spNo, spNo));

        let detailHtml = '';
        if (job) {
            let timeStr = '-';
            if (job.startProblem) {
                const d = new Date(job.startProblem);
                timeStr = !isNaN(d) ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : job.startProblem;
            }
            const techName = job.technician || 'ยังไม่มีช่างรับงาน';
            const rStatus = job.repairStatus;
            const note = job.note || 'ไม่มีระบุ';

            detailHtml = `
                <div class="repair-detail">
                    <div class="rd-title">⚠️ ข้อมูลการแจ้งซ่อม</div>
                    <div class="rd-row"><span>เวลา:</span> ${timeStr}</div>
                    <div class="rd-row"><span>ช่าง:</span> ${escHtml(techName)}</div>
                    <div class="rd-row"><span>สถานะ:</span> ${escHtml(rStatus)}</div>
                    <div class="rd-row"><span>อาการ:</span> ${escHtml(note)}</div>
                </div>
            `;
        }

        grid.innerHTML += `
            <div class="sp-card" id="sp-card-${i}" data-sp-index="${i}" data-machine="${escHtml(mName)}">
                <div class="sp-header">
                    <div class="sp-name">SP ${i + 1}</div>
                    <div class="sp-status" id="sp-status-${i}">-</div>
                </div>
                <div class="sp-body">
                    <div class="sp-weight" id="sp-weight-${i}">0.00 kg</div>
                    <div class="sp-bag" id="sp-bag-${i}">-</div>
                    <div class="sp-consec-err" id="sp-err-${i}" style="display:none;"></div>
                </div>
                ${detailHtml}
            </div>
        `;
    }

    renderStaticOffSps(history);
    renderPrecomputedProblems(history);

    grid.querySelectorAll('.sp-card').forEach(card => {
        card.addEventListener('click', () => {
            showSPDetails(Number(card.dataset.spIndex), card.dataset.machine || mName);
        });
    });

    document.getElementById('sp-modal').classList.remove('hidden');

    // Start playback: first bag after 15s, every next active SP/bag after 1s.
    frozenBags = {}; // reset freeze states

    buildPlaybackEvents(history).forEach((event, eventIndex) => {
        const timer = setTimeout(() => {
            renderSpPlaybackStep(event.rowData, event.playIndex, event.spIndex);
        }, FIRST_BAG_DELAY_MS + (eventIndex * NEXT_BAG_INTERVAL_MS));
        playbackTimers.push(timer);
    });
}

function buildPlaybackEvents(history) {
    const events = [];

    history.forEach((rowData, playIndex) => {
        const sps = rowData.sps || [];
        for (let i = 0; i < 8; i++) {
            const sp = sps[i];
            if (!sp) continue;
            if (hasProblemForSp_(history, i)) continue;
            if (sp.problemHold && hasEarlierProblemForSp(history, playIndex, i)) continue;
            events.push({ rowData, playIndex, spIndex: i });
        }
    });

    return events;
}

function hasEarlierProblemForSp(history, currentRowIndex, spIndex) {
    for (let rowIdx = 0; rowIdx < currentRowIndex; rowIdx++) {
        const rowData = history[rowIdx];
        const sp = rowData && rowData.sps ? rowData.sps[spIndex] : null;
        if (sp && sp.problemHold) return true;
    }
    return false;
}

function renderPrecomputedProblems(history) {
    for (let i = 0; i < 8; i++) {
        const problem = findLatestProblemForSp(history, i);
        if (problem) {
            setProblemDetail(i, problem);
        }
    }
}

function renderStaticOffSps(history) {
    const latestRow = history[history.length - 1];
    const sps = latestRow && latestRow.sps ? latestRow.sps : [];

    for (let i = 0; i < 8; i++) {
        const sp = sps[i];
        if (sp && (sp.status === 'OFF' || sp.disabledOnly) && !sp.problemHold && !hasProblemForSp_(history, i)) {
            setOffOnlyDetail(i);
        }
    }
}

function findLatestProblemForSp(history, spIndex) {
    for (let rowIdx = history.length - 1; rowIdx >= 0; rowIdx--) {
        const rowData = history[rowIdx];
        const sp = rowData && rowData.sps ? rowData.sps[spIndex] : null;
        if (sp && sp.problem) {
            return {
                ...sp.problem,
                displayBag: getDatabaseBagNo_(rowData, rowIdx, spIndex),
                displayRound: rowData.round || sp.problem.round
            };
        }
    }
    return null;
}

function findProblemRowForSp(history, spIndex, problem) {
    if (!problem) return null;

    for (let rowIdx = history.length - 1; rowIdx >= 0; rowIdx--) {
        const rowData = history[rowIdx];
        const sp = rowData && rowData.sps ? rowData.sps[spIndex] : null;
        if (!sp || !sp.problem) continue;
        if (String(sp.problem.bag) === String(problem.bag) && String(sp.problem.round) === String(problem.round)) {
            return { rowData, sp };
        }
    }

    return null;
}

function renderSpPlaybackStep(rowData, playIndex, i) {
    const sps = rowData.sps || [];
    const sp = sps[i];
    const cardEl = document.getElementById(`sp-card-${i}`);
    const statusEl = document.getElementById(`sp-status-${i}`);
    const weightEl = document.getElementById(`sp-weight-${i}`);
    const bagEl = document.getElementById(`sp-bag-${i}`);

    if (!cardEl || !statusEl || !weightEl || !bagEl) return;
    if (cardEl.classList.contains('locked')) return;

    if (!sp || sp.status === '') {
        cardEl.className = 'sp-card';
        statusEl.textContent = '-';
        return;
    }

    const hasProblemInHistory = currentMachineObj
        ? hasProblemForSp_(currentMachineObj.history || [], i)
        : false;
    const isHold = sp.status === 'HOLD' || ((sp.status === 'OFF' || sp.disabledOnly) && !hasProcessStatus_(sp) && !hasProblemInHistory);
    const isCritical = isSevereStatus_(sp) || sp.problemHold;
    const isWarning = isWarningStatus_(sp);

    let cardClassName = 'sp-card';
    if (isCritical) cardClassName += ' critical';
    else if (isWarning) cardClassName += ' warning';
    else if (isHold) cardClassName += ' off';
    else cardClassName += ' on';

    cardEl.className = cardClassName;

    let statusLabel;
    if (isHold) statusLabel = 'OFF';
    else statusLabel = getProcessStatus_(sp) || (sp.status === 'OFF' ? 'OFF' : 'ON');
    statusEl.textContent = statusLabel;

    if (isHold && !sp.problemHold) {
        setOffOnlyDetail(i);
        return;
    }

    const weightVal = Number(sp.weight) || 0;
    weightEl.textContent = weightVal.toFixed(2) + ' kg';

    const bagNo = getDatabaseBagNo_(rowData, playIndex, i);
    const currentBagNo = `รอบ ${rowData.round || playIndex + 1} / ถุง ${bagNo}`;
    if (sp.problemHold) {
        if (!frozenBags[i]) frozenBags[i] = currentBagNo;
        bagEl.textContent = frozenBags[i];
    } else {
        frozenBags[i] = null;
        bagEl.textContent = currentBagNo;
    }

    const errEl = document.getElementById(`sp-err-${i}`);
    if (!errEl) return;
    if (sp.problemHold) {
        errEl.textContent = `${getProcessStatus_(sp) || 'Error'} | พลาดที่ถุง ${bagNo}`;
        errEl.style.display = 'block';
        if (sp.problem) {
            setProblemDetail(i, {
                ...sp.problem,
                displayBag: bagNo,
                displayRound: rowData.round || playIndex + 1
            });
        }
    } else if (sp.consecError > 0) {
        errEl.textContent = `พลาดต่อเนื่อง: ${sp.consecError} ถุง`;
        errEl.style.display = 'block';
    } else {
        errEl.style.display = 'none';
    }

    maybeShowSevereProblemPopup(rowData, sp, i);
}

function setProblemDetail(i, problem) {
    const cardEl = document.getElementById(`sp-card-${i}`);
    const statusEl = document.getElementById(`sp-status-${i}`);
    const weightEl = document.getElementById(`sp-weight-${i}`);
    const bagEl = document.getElementById(`sp-bag-${i}`);
    const errEl = document.getElementById(`sp-err-${i}`);
    if (!cardEl || !statusEl || !weightEl || !bagEl || !problem) return;

    cardEl.className = 'sp-card critical locked';
    statusEl.textContent = 'OFF';
    const problemBag = problem.displayBag || problem.bag || '-';
    const problemRound = problem.displayRound || problem.round || '-';
    weightEl.innerHTML = `
        <span class="sp-error-type">พบ ${escHtml(problem.type || 'Error')}</span>
        <span class="sp-error-weight">${Number(problem.weight || 0).toFixed(2)} kg</span>
    `;
    bagEl.textContent = `รอบ ${problemRound} / ถุง ${problemBag}`;
    if (errEl) {
        errEl.textContent = `SP OFF | ค้างที่ถุง ${problemBag}`;
        errEl.style.display = 'block';
    }
}

function setOffOnlyDetail(i) {
    const cardEl = document.getElementById(`sp-card-${i}`);
    const statusEl = document.getElementById(`sp-status-${i}`);
    const weightEl = document.getElementById(`sp-weight-${i}`);
    const bagEl = document.getElementById(`sp-bag-${i}`);
    const errEl = document.getElementById(`sp-err-${i}`);
    if (!cardEl || !statusEl || !weightEl || !bagEl) return;

    cardEl.className = 'sp-card off disabled';
    statusEl.textContent = 'OFF';
    weightEl.textContent = '-';
    bagEl.textContent = '-';
    if (errEl) {
        errEl.textContent = '';
        errEl.style.display = 'none';
    }
}

function clearPlayback() {
    if (playbackInterval) clearInterval(playbackInterval);
    playbackInterval = null;
    playbackTimers.forEach(timer => clearTimeout(timer));
    playbackTimers = [];
}

function maybeShowSevereProblemPopup(rowData, sp, i) {
    if (!currentMachineObj || !sp || !sp.requiresPopup) return;
    if (currentMachineObj.machineState === 'OFF') return;

    const key = [
        currentMachineObj.machine,
        rowData.round || '',
        sp.spNo || i + 1,
        sp.bag || '',
        sp.displayStatus || sp.textStatus || sp.status || ''
    ].join('|');

    if (shownSevereAlerts.has(key)) return;
    shownSevereAlerts.add(key);
    const bagNo = getDatabaseBagNo_(rowData, Number(rowData.round) ? Number(rowData.round) - 1 : 0, i);

    Swal.fire({
        icon: 'error',
        title: 'ปัญหาร้ายแรง',
        html: `
            <div style="text-align:left; line-height:1.6">
                <div><b>เครื่อง:</b> ${escHtml(currentMachineObj.machine)}</div>
                <div><b>SP:</b> ${escHtml(String(sp.spNo || i + 1))}</div>
                <div><b>สถานะ:</b> ${escHtml(sp.problem?.type || getProcessStatus_(sp) || sp.status)}</div>
                <div><b>น้ำหนัก:</b> ${Number(sp.problem?.weight || sp.weight || 0).toFixed(2)} kg</div>
                <div><b>รอบ/ถุง:</b> รอบ ${escHtml(String(rowData.round || '-'))} / ถุง ${escHtml(String(bagNo))}</div>
                <div><b>ผิดพลาดต่อเนื่อง:</b> ${escHtml(String(sp.consecError || 0))} ครั้ง</div>
            </div>
        `,
        background: '#161b22',
        color: '#fff',
        confirmButtonColor: '#ff4f6d',
        confirmButtonText: 'รับทราบ',
        showCloseButton: true
    });
}

function closeModal() {
    clearPlayback();
    document.getElementById('sp-modal').classList.add('hidden');
    currentMachineObj = null;
}

function showSPDetails(index, mName) {
    if (!currentMachineObj) return;
    const history = currentMachineObj.history || [];
    if (history.length === 0) return;

    const latestRow = history[history.length - 1];
    const problem = findLatestProblemForSp(history, index);
    const problemRow = problem ? findProblemRowForSp(history, index, problem) : null;
    const sp = problemRow?.sp || latestRow.sps[index];
    const spNo = index + 1;
    if (!sp) {
        showToast('ไม่พบข้อมูล SP นี้', true);
        return;
    }

    const machineJobs = activeJobs.filter(j => j.machine === mName);
    const job = machineJobs.find(j => isSameSp_(j.spNo, spNo));
    const latestBag = getDatabaseBagNo_(latestRow, history.length - 1, index);
    const detailStatus = getProcessStatus_(sp) || sp.displayStatus || sp.status;
    const detailProblemBag = problem?.displayBag || latestBag;
    const detailProblemRound = problem?.displayRound || problem?.round || latestRow.round || '-';

    let html = `
        <div style="text-align:left; font-size:14px; line-height:1.6;">
            <div><b>สถานะ:</b> ${detailStatus}</div>
            <div><b>น้ำหนักล่าสุด:</b> ${Number(sp.weight || 0).toFixed(2)} kg</div>
            <div><b>ข้อมูลรอบ:</b> รอบที่ ${latestRow.round || '-'} / ถุงที่ ${latestBag}</div>
    `;

    if (problem || sp.problemHold || sp.status === 'HOLD' || ((sp.status === 'OFF' || sp.disabledOnly) && !hasProblemForSp_(history, index) && !hasProcessStatus_(sp))) {
        html = `
            <div style="text-align:left; font-size:14px; line-height:1.6;">
                <div><b>สถานะ:</b> OFF</div>
                <div><b>ปัญหา:</b> พบ ${escHtml(problem?.type || getProcessStatus_(sp) || 'Error')}</div>
                <div><b>น้ำหนัก:</b> ${Number(problem?.weight || sp.weight || 0).toFixed(2)} kg</div>
                <div><b>ข้อมูลรอบ:</b> รอบที่ ${escHtml(String(detailProblemRound))} / ถุงที่ ${escHtml(String(detailProblemBag))}</div>
                <div style="color:var(--c-danger); font-weight:bold; margin-top:8px;">SP OFF | ค้างที่ถุง ${escHtml(String(detailProblemBag))}</div>
        `;
    }

    if (sp.consecError > 0) {
        html += `<div style="color:var(--c-danger); font-weight:bold; margin-top:8px;">⚠️ พลาดต่อเนื่อง: ${sp.consecError} ถุง</div>`;
    }

    if (job) {
        let timeStr = '-';
        if (job.startProblem) {
            const d = new Date(job.startProblem);
            timeStr = !isNaN(d) ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : job.startProblem;
        }
        html += `
            <hr style="border-color:#333; margin:12px 0;">
            <div style="color:var(--c-warning); font-weight:bold; margin-bottom:4px;">🛠️ ข้อมูลการซ่อมบำรุง</div>
            <div><b>เวลา:</b> ${timeStr}</div>
            <div><b>ช่าง:</b> ${job.technician || 'ยังไม่มีผู้รับงาน'}</div>
            <div><b>สถานะ:</b> ${job.repairStatus}</div>
            <div><b>อาการ:</b> ${job.note || '-'}</div>
        `;
    }
    html += `</div>`;

    Swal.fire({
        title: `รายละเอียด SP ${spNo}`,
        html: html,
        background: '#161b22',
        color: '#fff',
        confirmButtonColor: '#00d2b4',
        confirmButtonText: 'ปิด',
        showCloseButton: true
    });
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

function normalizeSpNo_(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (raw === 'ALL') return 'ALL';
    return raw.replace(/^SP\s*/i, '').replace(/^SPOUT\s*/i, '');
}

function isSameSp_(jobSpNo, spNo) {
    const normalized = normalizeSpNo_(jobSpNo);
    return normalized === 'ALL' || normalized === String(spNo);
}
