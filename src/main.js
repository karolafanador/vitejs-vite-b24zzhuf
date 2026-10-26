
import './style.css';

// ==========================================
// MONITOR CARDÍACO
// Arduino UNO + MAX30102 + BLE 4.0
// Web Bluetooth: servicio FFE0, característica FFE1
// ==========================================

const SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';

const PULSO_MIN = 50;

let device = null;
let characteristic = null;
let connected = false;
let buffer = '';
let bpmData = [];
let maxBpm = 0;
let totalBpm = 0;
let samples = 0;
let threshold = 160;

const connectButton = document.getElementById('connectButton');
const bpmValue = document.getElementById('bpmValue');
const spo2Value = document.getElementById('spo2Value');
const currentBpm = document.getElementById('currentBpm');
const maxBpmElement = document.getElementById('maxBpm');
const averageBpm = document.getElementById('averageBpm');
const status = document.getElementById('status');
const alertBox = document.getElementById('alertBox');
const thresholdInput = document.getElementById('threshold');
const connectionText = document.getElementById('connectionText');
const connectionIndicator = document.getElementById('connectionIndicator');
const canvas = document.getElementById('heartChart');
const ctx = canvas.getContext('2d');

const decoder = new TextDecoder();

// ==========================================
// LÍMITE MÁXIMO DE PULSO
// ==========================================

thresholdInput.addEventListener('change', () => {
    const value = Number(thresholdInput.value);

    if (Number.isFinite(value) && value >= PULSO_MIN && value <= 220) {
        threshold = value;
        drawChart();

        if (samples > 0) {
            updateStatus(Number(bpmValue.textContent));
        }
    } else {
        thresholdInput.value = threshold;
        alert('El límite debe estar entre 50 y 220 BPM.');
    }
});

// ==========================================
// BOTÓN BLUETOOTH
// ==========================================

connectButton.textContent = '🔵 Conectar por Bluetooth';

connectButton.addEventListener('click', connectBluetooth);

async function connectBluetooth() {
    if (!navigator.bluetooth) {
        alert(
            'Este navegador no permite Web Bluetooth. ' +
            'Prueba con Google Chrome en un dispositivo compatible ' +
            'y abre la página mediante HTTPS.'
        );
        return;
    }

    if (connected) {
        disconnectBluetooth();
        return;
    }

    try {
        connectionText.textContent = 'Buscando dispositivos BLE...';
        connectButton.disabled = true;

        // Abre el selector de dispositivos Bluetooth.
        // El usuario elige el módulo de su Arduino.
        device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [SERVICE_UUID]
        });

        connectionText.textContent =
            `Conectando a ${device.name || 'dispositivo BLE'}...`;

        device.addEventListener(
            'gattserverdisconnected',
            onDisconnected
        );

        const server = await device.gatt.connect();

        const service = await server.getPrimaryService(SERVICE_UUID);

        characteristic = await service.getCharacteristic(
            CHARACTERISTIC_UUID
        );

        await characteristic.startNotifications();

        characteristic.addEventListener(
            'characteristicvaluechanged',
            handleBluetoothData
        );

        connected = true;
        buffer = '';

        connectionText.textContent =
            `Conectado: ${device.name || 'dispositivo BLE'}`;

        connectionIndicator.classList.remove('offline');
        connectionIndicator.classList.add('online');

        connectButton.textContent = '🔴 Desconectar Bluetooth';
        connectButton.disabled = false;

    } catch (error) {
        console.error('Error Bluetooth:', error);

        connected = false;
        characteristic = null;

        connectionText.textContent = 'Bluetooth desconectado';
        connectionIndicator.classList.remove('online');
        connectionIndicator.classList.add('offline');

        connectButton.textContent = '🔵 Conectar por Bluetooth';
        connectButton.disabled = false;

        if (error.name !== 'NotFoundError') {
            alert(
                'No se pudo conectar al módulo BLE. ' +
                'Comprueba que esté encendido y que utilice ' +
                'el servicio FFE0 y la característica FFE1.'
            );
        }
    }
}

// ==========================================
// RECIBIR DATOS POR BLUETOOTH
// ==========================================

function handleBluetoothData(event) {
    const value = event.target.value;

    const bytes = new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength
    );

    buffer += decoder.decode(bytes, { stream: true });

    // El Arduino termina cada mensaje con una nueva línea.
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
        processSerialData(line.trim());
    }
}

// ==========================================
// INTERPRETAR LOS MENSAJES DEL ARDUINO
// Ejemplo:
// Ritmo Cardiaco: 78 BPM | Oxigeno: 98 %
// ==========================================

function processSerialData(data) {
    if (!data) return;

    console.log('Mensaje recibido por BLE:', data);

    // Ignorar mensajes de inicio o diagnóstico.
    if (
        data.includes('Iniciando') ||
        data.includes('ARDUINO_LISTO') ||
        data.includes('MAX30105 no encontrado') ||
        data.includes('Esperando medicion valida') ||
        data.includes('Cuenta 3 segundos')
    ) {
        return;
    }

    // Extraer BPM y oxígeno de la misma línea.
    const bpmMatch = data.match(
        /Ritmo Cardiaco:\s*(-?\d+)\s*BPM/i
    );

    const spo2Match = data.match(
        /Oxigeno:\s*(-?\d+)\s*%/i
    );

    if (bpmMatch) {
        const bpm = Number(bpmMatch[1]);

        if (Number.isFinite(bpm) && bpm >= 30 && bpm <= 220) {
            updateBpm(bpm);
        }
    }

    if (spo2Match) {
        const spo2 = Number(spo2Match[1]);

        if (Number.isFinite(spo2) && spo2 >= 0 && spo2 <= 100) {
            updateSpo2(spo2);
        }
    }

    // Mostrar el estado que envía el Arduino en la consola.
    // La alerta visual de la página depende únicamente del pulso.
    if (data.includes('ALERTA: PULSO FUERA DEL RANGO')) {
        console.log('Arduino: alerta de pulso');
    } else if (data.includes('PULSO DENTRO DEL RANGO')) {
        console.log('Arduino: pulso dentro del rango');
    }
}

// ==========================================
// ACTUALIZAR PULSO Y ESTADÍSTICAS
// ==========================================

function updateBpm(bpm) {
    bpmValue.textContent = bpm;
    currentBpm.textContent = bpm;

    if (bpm > maxBpm) {
        maxBpm = bpm;
    }

    totalBpm += bpm;
    samples++;

    maxBpmElement.textContent = maxBpm;
    averageBpm.textContent = Math.round(totalBpm / samples);

    bpmData.push({
        time: new Date(),
        bpm
    });

    // Conservar las últimas 60 mediciones para la gráfica.
    if (bpmData.length > 60) {
        bpmData.shift();
    }

    updateStatus(bpm);
    drawChart();
}

// ==========================================
// ACTUALIZAR OXÍGENO
// No activa ni desactiva la alarma.
// ==========================================

function updateSpo2(spo2) {
    spo2Value.textContent = spo2;
}

// ==========================================
// ALERTA VISUAL SEGÚN EL PULSO
// ==========================================

function updateStatus(bpm) {
    const fueraDeRango =
        bpm < PULSO_MIN || bpm > threshold;

    if (fueraDeRango) {
        showAlert();
    } else {
        showNormal();
    }
}

function showNormal() {
    status.textContent = '🟢 PULSO DENTRO DEL RANGO';

    status.classList.remove('high');
    status.classList.add('normal');

    alertBox.classList.add('hidden');
}

function showAlert() {
    status.textContent = '🔴 PULSO FUERA DEL RANGO';

    status.classList.remove('normal');
    status.classList.add('high');

    alertBox.classList.remove('hidden');
}

// ==========================================
// DESCONECTAR
// ==========================================

function disconnectBluetooth() {
    if (device?.gatt?.connected) {
        device.gatt.disconnect();
    } else {
        onDisconnected();
    }
}

function onDisconnected() {
    connected = false;
    characteristic = null;
    buffer = '';

    connectionText.textContent = 'Bluetooth desconectado';

    connectionIndicator.classList.remove('online');
    connectionIndicator.classList.add('offline');

    connectButton.textContent = '🔵 Conectar por Bluetooth';
    connectButton.disabled = false;
}

// ==========================================
// GRÁFICA
// ==========================================

function drawChart() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (!width || !height) return;

    const ratio = window.devicePixelRatio || 1;

    canvas.width = width * ratio;
    canvas.height = height * ratio;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (bpmData.length === 0) return;

    const min = 40;
    const max = 180;

    // Líneas horizontales.
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.font = '12px Arial';

    for (let bpm = min; bpm <= max; bpm += 20) {
        const y =
            height - ((bpm - min) / (max - min)) * height;

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();

        ctx.fillStyle = '#9ca3af';
        ctx.fillText(String(bpm), 5, Math.max(12, y - 4));
    }

    // Línea del límite máximo.
    if (threshold >= min && threshold <= max) {
        const thresholdY =
            height - ((threshold - min) / (max - min)) * height;

        ctx.strokeStyle = '#ef4444';
        ctx.setLineDash([8, 5]);

        ctx.beginPath();
        ctx.moveTo(0, thresholdY);
        ctx.lineTo(width, thresholdY);
        ctx.stroke();

        ctx.setLineDash([]);
    }

    // Línea de frecuencia cardíaca.
    ctx.beginPath();

    bpmData.forEach((point, index) => {
        const x =
            (index / Math.max(bpmData.length - 1, 1)) * width;

        const y =
            height - ((point.bpm - min) / (max - min)) * height;

        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Puntos de las mediciones.
    bpmData.forEach((point, index) => {
        const x =
            (index / Math.max(bpmData.length - 1, 1)) * width;

        const y =
            height - ((point.bpm - min) / (max - min)) * height;

        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    });
}

window.addEventListener('resize', drawChart);
