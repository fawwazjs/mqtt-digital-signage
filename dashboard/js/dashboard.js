const BROKER_URL = 'ws://' + window.location.hostname + ':9001';
const client = mqtt.connect(BROKER_URL, {
    protocolVersion: 5,
    clientId: 'dashboard-' + Math.random().toString(16).substr(2, 8)
});

const screens = new Map();
const analyticsData = new Map();

const logEl = document.getElementById('event-log');
const screenGrid = document.getElementById('screen-grid');
const statusBadge = document.getElementById('broker-status');
const alertEl = document.getElementById('current-alert');
const activeCountEl = document.getElementById('active-screens-count');
const viewersCountEl = document.getElementById('total-viewers');

client.on('connect', () => {
    console.log('Connected to MQTT Broker via WebSockets');
    statusBadge.classList.add('online');
    statusBadge.querySelector('span').innerText = 'System Online';
    
    client.subscribe('health/+', { qos: 1 });
    client.subscribe('alert/#', { qos: 2 });
    client.subscribe('display/+/content', { qos: 1 });
    client.subscribe('analytics/+', { qos: 0 });
    client.subscribe('environment/+/weather', { qos: 1 });
    
    addLog('SYS', 'Dashboard uplink established');
});

client.on('message', (topic, payload, packet) => {
    const data = JSON.parse(payload.toString());
    
    if (topic.startsWith('health/')) {
        const id = topic.split('/')[1];
        screens.set(id, { ...screens.get(id), ...data, lastSeen: Date.now() });
        updateUI();
    } else if (topic.startsWith('alert/')) {
        alertEl.innerText = data.message;
        alertEl.className = 'alert-active';
        addLog('ALERT', data.message, 'critical');
    } else if (topic.includes('/content')) {
        const id = topic.split('/')[1];
        if (screens.has(id)) {
            screens.get(id).content = data.content;
            updateUI();
        }
        addLog('PUB', `[${id}] Content Update: ${data.content}`);
    } else if (topic.startsWith('analytics/')) {
        const zone = topic.split('/')[1];
        analyticsData.set(data.screen_id, data.viewer_count);
        updateViewers();
    } else if (topic.startsWith('environment/')) {
        const zone = topic.split('/')[1];
        addLog('WTH', `[${zone}] ${data.temperature}°C, ${data.condition}`);
    }
});

function updateViewers() {
    let total = 0;
    analyticsData.forEach(v => total += v);
    viewersCountEl.innerHTML = `${total} <span class="subtitle">Current Viewers</span>`;
}

function updateUI() {
    screenGrid.innerHTML = '';
    let activeCount = 0;
    
    screens.forEach((data, id) => {
        const isOffline = data.status === 'offline' || (Date.now() - data.lastSeen > 30000);
        if (!isOffline) activeCount++;
        
        const card = document.createElement('div');
        card.className = `screen-item ${isOffline ? 'offline' : ''}`;
        card.innerHTML = `
            <span class="id">${id}</span>
            <span class="content">${data.content || 'Awaiting Sync...'}</span>
            <div class="mini-stats">
                <span>🌡️ ${data.temp || '--'}°C</span>
                <span>⚙️ CPU ${data.cpu || '--'}%</span>
            </div>
        `;
        screenGrid.appendChild(card);
    });
    
    activeCountEl.innerHTML = `${activeCount} <span class="subtitle">Online Screens</span>`;
}

function addLog(source, msg, type = '') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString([], {hour12:false});
    entry.innerHTML = `<span style="color:#8b9bb4">[${time}]</span> <strong>[${source}]</strong> ${msg}`;
    logEl.prepend(entry);
    
    // Keep max 50 logs
    if(logEl.children.length > 50) {
        logEl.lastChild.remove();
    }
}

// Action Buttons
document.getElementById('btn-fire').addEventListener('click', () => {
    const payload = JSON.stringify({ message: "FIRE ALARM - EVACUATE NOW", priority: "CRITICAL", timestamp: Date.now() });
    client.publish('alert/critical', payload, { qos: 2 });
    addLog('CMD', 'Evacuation order transmitted', 'critical');
});

document.getElementById('btn-promo').addEventListener('click', () => {
    const payload = JSON.stringify({ content: "FLASH SALE - 70% OFF 🎉", timestamp: Date.now() });
    client.publish('display/zone/Lobby/content', payload, { qos: 1, retain: true });
    addLog('CMD', 'Flash promo broadcasted to Lobby');
});

document.getElementById('btn-clear').addEventListener('click', () => {
    alertEl.innerText = 'All Systems Nominal';
    alertEl.className = 'alert-none';
    addLog('SYS', 'Alerts cleared by operator');
});

// Periodic cleanup of offline screens
setInterval(updateUI, 10000);
