const BROKER_URL = 'ws://' + window.location.hostname + ':9001';
const client = mqtt.connect(BROKER_URL, {
    protocolVersion: 5, // Use MQTT 5.0
    clientId: 'dashboard-' + Math.random().toString(16).substr(2, 8)
});

const screens = new Map();
const logEl = document.getElementById('event-log');
const screenGrid = document.getElementById('screen-grid');
const statusBadge = document.getElementById('broker-status');
const alertEl = document.getElementById('current-alert');
const activeCountEl = document.getElementById('active-screens-count');

client.on('connect', () => {
    console.log('Connected to MQTT Broker via WebSockets');
    statusBadge.classList.add('online');
    statusBadge.querySelector('span').innerText = 'Connected';
    
    // Subscribe to everything for monitoring
    client.subscribe('health/+', { qos: 1 });
    client.subscribe('alert/#', { qos: 2 });
    client.subscribe('display/+/content', { qos: 1 });
    
    addLog('System', 'Dashboard connected to fleet controller');
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
        addLog('Content', `Update sent to ${id}: ${data.content}`);
    }
});

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
            <span class="content">${data.content || 'Idle'}</span>
            <div class="mini-stats" style="font-size: 10px; margin-top: 5px; color: #94a3b8">
                ${data.temp ? `🌡️ ${data.temp}°C` : ''}
            </div>
        `;
        screenGrid.appendChild(card);
    });
    
    activeCountEl.innerText = activeCount;
}

function addLog(source, msg, type = '') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<strong>[${source}]</strong> ${msg}`;
    logEl.prepend(entry);
}

// Action Buttons
document.getElementById('btn-fire').addEventListener('click', () => {
    const payload = JSON.stringify({ message: "FIRE ALARM - EVACUATE NOW", priority: "CRITICAL", timestamp: Date.now() });
    client.publish('alert/critical', payload, { qos: 2 });
});

document.getElementById('btn-promo').addEventListener('click', () => {
    const payload = JSON.stringify({ content: "FLASH SALE - 70% OFF", timestamp: Date.now() });
    client.publish('display/zone/Lobby/content', payload, { qos: 1, retain: true });
});

document.getElementById('btn-clear').addEventListener('click', () => {
    alertEl.innerText = 'No active alerts';
    alertEl.className = 'alert-none';
    addLog('System', 'Alerts cleared locally');
});
