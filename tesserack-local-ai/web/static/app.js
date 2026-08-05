const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const gameState = document.getElementById('gameState');
const reasoning = document.getElementById('reasoning');
const action = document.getElementById('action');
const startBtn = document.getElementById('startBtn');
const turboBtn = document.getElementById('turboBtn');
const stopBtn = document.getElementById('stopBtn');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');

let ws = null;
let running = false;
let turboMode = false;

function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
        console.log('Connected to server');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };

    ws.onclose = () => {
        console.log('Disconnected from server');
        setTimeout(connect, 2000);
    };
}

function handleMessage(data) {
    if (data.type === 'started') {
        running = true;
        turboMode = false;
        updateButtons();
        return;
    }

    if (data.type === 'turbo_started') {
        running = true;
        turboMode = true;
        updateButtons();
        return;
    }

    if (data.type === 'turbo_stopped') {
        running = false;
        turboMode = false;
        updateButtons();
        return;
    }

    // Update screenshot
    if (data.screenshot) {
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = 'data:image/png;base64,' + data.screenshot;
    }

    // Update game state
    if (data.state) {
        const s = data.state;
        gameState.innerHTML = `
            <p><strong>Location:</strong> ${s.location}</p>
            <p><strong>Coordinates:</strong> (${s.coordinates[0]}, ${s.coordinates[1]})</p>
            <p><strong>Money:</strong> $${s.money}</p>
            <p><strong>Badges:</strong> ${s.badges.length > 0 ? s.badges.join(', ') : 'None'}</p>
            <p><strong>Party:</strong></p>
            ${s.party.map(p => `<p style="margin-left:10px">${p}</p>`).join('')}
        `;
    }

    // Update reasoning
    if (data.reasoning) {
        reasoning.textContent = data.reasoning;
    }

    // Update action
    if (data.action) {
        action.textContent = data.action.join(', ');
    }
}

function updateButtons() {
    startBtn.disabled = running;
    turboBtn.disabled = running;
    stopBtn.disabled = !running;
    saveBtn.disabled = !running;
    loadBtn.disabled = !running;

    // Update button text based on mode
    if (running && turboMode) {
        turboBtn.textContent = '▶ Turbo (Running)';
    } else {
        turboBtn.textContent = '▶ Turbo (Fast)';
    }

    if (running && !turboMode) {
        startBtn.textContent = '▶ LLM (Running)';
    } else {
        startBtn.textContent = '▶ LLM (Smart)';
    }
}

startBtn.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'start' }));
    }
};

turboBtn.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'turbo_start' }));
    }
};

stopBtn.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        if (turboMode) {
            ws.send(JSON.stringify({ type: 'turbo_stop' }));
        } else {
            ws.send(JSON.stringify({ type: 'stop' }));
        }
        running = false;
        turboMode = false;
        updateButtons();
    }
};

saveBtn.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'save' }));
    }
};

loadBtn.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'load' }));
    }
};

// Manual button controls
document.querySelectorAll('[data-button]').forEach(btn => {
    btn.onclick = () => {
        const button = btn.getAttribute('data-button');
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'button', button: button }));
        }
    };
});

// Turbo A button (manual hold)
let turboInterval = null;
const turboABtn = document.getElementById('turboA');

if (turboABtn) {
    turboABtn.onmousedown = () => {
        turboInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'button', button: 'a' }));
            }
        }, 100);
    };

    turboABtn.onmouseup = () => {
        if (turboInterval) {
            clearInterval(turboInterval);
            turboInterval = null;
        }
    };

    turboABtn.onmouseleave = () => {
        if (turboInterval) {
            clearInterval(turboInterval);
            turboInterval = null;
        }
    };
}

// Keyboard controls
document.addEventListener('keydown', (e) => {
    const keyMap = {
        'ArrowUp': 'up',
        'ArrowDown': 'down',
        'ArrowLeft': 'left',
        'ArrowRight': 'right',
        'z': 'a',
        'x': 'b',
        'Enter': 'start',
        'Shift': 'select'
    };
    const button = keyMap[e.key];
    if (button && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'button', button: button }));
        e.preventDefault();
    }
});

// Connect on page load
connect();
